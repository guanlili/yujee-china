"""V3 偏图片的聚焦页编辑:识图模型产出一个结构化 INTENT(哪些照片放在这页、按什么
顺序);确定性引擎(`skeleton_v3.pick_template_v3` / `assign_images_v3`)来执行
(WP2.3 / #187)。

只有当本轮 DeepSeek dispatch 把聚焦页编辑判定为涉及图片(换图 / 挪图 / 改图文配比)时,
`chapter_chat_v3` 才会调用本模块。V3 图片编辑就建在这里的 V3 确定性引擎之上。

图文分流 (§4.2(3) / architecture §6.8 第 2 条):

  * 纯文字 turn → DeepSeek 重写聚焦页的文字。绝不会进到本模块,所以纯文字编辑从不
    调用识图(vision)模型。那条路径归 `chapter_chat_v3` 管(`_coerce_edit_patch`)。
  * 涉及图片 turn → 识图模型被升级进来,但它【只】产出一个结构化意图:应占据聚焦页的
    `photoId` 有序列表(严格取自【本章】的照片)。它绝不产出 `templateId` 或
    `pageIndex`。随后确定性引擎:
      - 为该照片数挑一个合法模板(`pick_template_v3`,优先恰好容量、否则最接近的更大),
      - 按声明顺序把选中的照片摆进槽(`assign_images_v3`)。
    本章之外的 photoId 被丢弃;空的 / 不可用的意图返回 None,于是调用方降级为 talk turn,
    而不是杜撰一份版式。

触发权在用户 (§4.2(3)):本模块只在响应【本轮】用户消息时运行 —— 绝不主动重新排版。识图
模型在构造上就防幻觉:它既无法注入非法 templateId(由引擎来挑),也无法动到别的页(它
只看见 / 只为聚焦页作答)。

无状态 / 隐私 (§3):意图调用【只】发送文字 —— 聚焦页当前的照片摆放 + 本章的照片场景
句子 + 用户的消息。无 base64,无 GPS/place。场景句子在 WP1.3 已由识图模型写好;像素本身
没有任何新信息被往返传递。
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

from ...logging_config import get_logger
from ...schemas import Page, V3Chapter, V3LayoutPatchEntry
from ...settings import get_settings
from ...skills import load_prompt
from ... import ai_client
from ...engine import skeleton_v3
from ...vision_provider import (
    VisionSlot,
    VisionSlotError,
    ark_vision_slot,
    openai_vision_slot,
)

_PROMPT_DIR = Path(__file__).resolve().parent

log = get_logger("chat_edit_v3")

# 章节故事里每个聚焦页都是内页正文页;因此合法候选池始终是 interior 类别
# (cover/toc/ending 归后续环节所有,从不在这里编辑)。
_INTERIOR: skeleton_v3.Category = "interior"


class ChatEditV3Error(Exception):
    """图片编辑意图步骤以一种必须降级为 talk turn 的方式失败时抛。

    绝不作为硬错误外抛 —— 模型/引擎无法满足的图片编辑返回不出 patch,于是
    `chapter_chat_v3` 用一句 talk 回复请用户澄清(绝不杜撰版式)。"""


# ---------- 意图槽(vision provider)------------------------------------


def _intent_slot(settings: Any) -> VisionSlot:
    """复用 describe-content 的 provider 策略:OpenAI (GPT-5.5 Mini) 为主,
    火山 doubao 为 failover(architecture §6.8 第 2 条)。意图调用是纯文字,
    所以哪个 slot 都行;配了主就用主,否则用 ark。两者都没配时抛
    ChatEditV3Error(调用方降级为 talk)。"""
    try:
        return openai_vision_slot(
            settings,
            timeout_seconds=settings.describe_openai_timeout_seconds,
            model=settings.describe_openai_model,
        )
    except VisionSlotError:
        pass
    try:
        return ark_vision_slot(settings)
    except VisionSlotError as exc:
        raise ChatEditV3Error(f"no image-edit intent slot configured: {exc}") from exc


# ---------- prompt 组装 ---------------------------------------------------


def _max_interior_capacity() -> int:
    """任一 interior 模板能容纳的最大照片数 —— 在引擎看到之前,模型意图被钳到的硬上限。"""
    return skeleton_v3.max_capacity(_INTERIOR)


def _build_user_content(
    chapter: V3Chapter, page: Page, user_message: str
) -> str:
    """意图调用的紧凑文字清单。带上本章的照片(id + 场景句子)、当前聚焦页上有哪些照片
    (好让挪图 / 换图有依据)、容量上限,以及用户的诉求。无 base64,无 GPS/place ——
    只有识图模型早已写好的文字(§3 隐私)。"""
    photo_lines = "\n".join(
        f"    - {p.photoId}: {p.sceneDescription or '(无描述)'}"
        for p in chapter.photos
    )
    current_ids = list(page.images.values())
    current = ", ".join(current_ids) if current_ids else "(无)"
    capacity = _max_interior_capacity()
    # 仅数据:本章可用照片(id+场景)+ 当前页照片 + 本页容量上限(动态值)+ 用户诉求。
    # 章节 description 是目录占位、分析期留空,不进编辑上下文。怎么改、硬性约束、输出 JSON
    # 形状由 edit_image_intent.md(系统指令)统一拥有。
    return (
        f"本章可用的照片(photoId | 场景):\n"
        f"{photo_lines}\n\n"
        f"当前页照片(按顺序):{current}\n\n"
        f"本页照片容量上限:{capacity} 张\n\n"
        f"用户对【这一页】的要求:\n{user_message}"
    )


def _parse_intent(parsed: Any) -> list[str]:
    """从模型 JSON 里取出有序的 photoId 列表。宽容处理:忽略非字符串 / 空 id 并去重
    (一张照片只能占一个槽)。调用方会按本章真实 photoId 过滤并钳到容量,所以漂移的
    模型既无法摆上一张幻觉照片,也无法把这页撑爆。"""
    if not isinstance(parsed, dict):
        raise ChatEditV3Error("image-edit intent response is not a JSON object")
    raw = parsed.get("photoIds")
    if not isinstance(raw, list):
        raise ChatEditV3Error("image-edit intent response missing photoIds[] array")
    seen: set[str] = set()
    out: list[str] = []
    for item in raw:
        if not isinstance(item, str):
            continue
        pid = item.strip()
        if not pid or pid in seen:
            continue
        seen.add(pid)
        out.append(pid)
    return out


async def _call_model(slot: VisionSlot, manifest: str) -> list[str]:
    messages = [
        {
            "role": "system",
            "content": (
                load_prompt(
                    _PROMPT_DIR / "edit_image_intent.md",
                    skills=("image_edit_selection",),
                )
            ),
        },
        {"role": "user", "content": manifest},
    ]
    try:
        response = await ai_client.chat_completion(
            base_url=slot.base_url,
            api_key=slot.api_key,
            model=slot.model,
            messages=messages,
            timeout_seconds=slot.timeout_seconds,
            temperature=0.2,
            max_tokens=512,
            response_format=slot.response_format,
            extra_body=slot.extra_body,
        )
    except ai_client.AIRequestError as exc:
        raise ChatEditV3Error(f"image-edit intent upstream call failed: {exc}") from exc
    try:
        raw_text = ai_client.extract_text(response)
        parsed = ai_client.parse_json_loose(raw_text)
    except ValueError as exc:
        raise ChatEditV3Error(f"image-edit intent response unparseable: {exc}") from exc
    return _parse_intent(parsed)


# ---------- 确定性执行 ------------------------------------------


def _ground_intent(chapter: V3Chapter, photo_ids: list[str]) -> list[str]:
    """只保留确实属于【本章】的 photoId,按模型的顺序,去重(一张照片只能占一个槽)
    并钳到 interior 容量上限。丢掉幻觉 id(模型臆造)、合并重复、裁掉溢出。引擎从不
    看到非法或重复的照片 —— 在这里强制,使真实的意图调用与注入的意图调用都被 grounded。"""
    chapter_ids = {p.photoId for p in chapter.photos}
    grounded: list[str] = []
    seen: set[str] = set()
    for pid in photo_ids:
        if pid in chapter_ids and pid not in seen:
            seen.add(pid)
            grounded.append(pid)
    capacity = _max_interior_capacity()
    return grounded[:capacity] if capacity > 0 else []


def _execute_intent(page: Page, photo_ids: list[str]) -> V3LayoutPatchEntry | None:
    """在 grounded 后的 photoId 列表上跑确定性引擎 → 一份整页 patch。

    为照片数挑一个合法的 interior 模板(`pick_template_v3`:优先恰好容量,否则最接近的
    更大),并按顺序把照片摆进槽(`assign_images_v3`)。模型从未提供 templateId —— 它
    在构造上就合法。文字原样带过(改图不重写文案;纯文字编辑走那条路径)。没有可摆的
    东西时返回 None。"""
    if not photo_ids:
        return None
    try:
        template_id = skeleton_v3.pick_template_v3(_INTERIOR, len(photo_ids))
        images = skeleton_v3.assign_images_v3(template_id, photo_ids)
    except ValueError as exc:
        # 没有 interior 模板能容纳请求的张数 → 降级为 talk。
        log.warning("chat_edit_v3.no_template", reason=str(exc), count=len(photo_ids))
        return None
    return V3LayoutPatchEntry(
        pageIndex=page.pageIndex,
        templateId=template_id,
        images=images,
        # 带过在新模板上仍有归宿的现有文字。改图保留用户的文字;文案重写归纯文字编辑路径。
        texts=_carried_texts(page.texts, template_id),
    )


def _carried_texts(old_texts: dict[str, str], template_id: str) -> dict[str, str]:
    """只保留旧页中槽位 id 在新模板上仍存在的文字(换模板会改变槽位集合)。镜像 v2 的
    reflow 守卫,但不带 v2 那套机制:被丢掉的槽位文字就直接不带过。"""
    from src.engine import templates

    template = templates.get(template_id)
    if template is None:
        return {}
    allowed = set(templates.text_slot_ids(template))
    return {key: value for key, value in old_texts.items() if key in allowed}


# ---------- 公开 API --------------------------------------------------------


async def run_image_edit(
    chapter: V3Chapter,
    page: Page,
    user_message: str,
    *,
    call_intent: Any = None,
) -> V3LayoutPatchEntry | None:
    """把偏图片的聚焦页编辑解析成一份确定性的 layout patch。

    识图模型产出有序的 photoId 意图;确定性引擎挑一个合法模板并把照片摆进槽。绝不抛错:
    失败/缺失的 provider、无法解析的响应、纯幻觉的意图、超量的请求,统统返回 None,于是
    `chapter_chat_v3` 降级为 talk turn(绝不杜撰版式)。

    `call_intent` 让测试注入意图调用(`async (manifest) -> list[str]`),从而不打到真实
    vision 模型;生产路径解析 slot + provider 策略。
    """
    manifest = _build_user_content(chapter, page, user_message)
    try:
        if call_intent is not None:
            photo_ids = await call_intent(manifest)
        else:
            settings = get_settings()
            slot = _intent_slot(settings)
            # 用 describe 预算给调用设界,免得慢模型把 60s 同步 turn 卡死;超时则降级为 talk。
            photo_ids = await asyncio.wait_for(
                _call_model(slot, manifest),
                timeout=settings.describe_batch_deadline_seconds,
            )
    except (ChatEditV3Error, asyncio.TimeoutError) as exc:
        log.warning("chat_edit_v3.degrade", reason=str(exc))
        return None
    except Exception as exc:  # noqa: BLE001 —— 绝不让这一 turn 硬失败
        log.warning("chat_edit_v3.degrade_unhandled", reason=str(exc))
        return None

    grounded = _ground_intent(chapter, photo_ids)
    patch = _execute_intent(page, grounded)
    if patch is not None:
        log.info(
            "chat_edit_v3.ok",
            page_index=page.pageIndex,
            template_id=patch.templateId,
            photo_count=len(grounded),
        )
    return patch
