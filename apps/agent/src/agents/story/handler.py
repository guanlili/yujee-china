"""V3 chapter-chat 逐 turn 分发器(§4.2,issue #185 / WP2.1)。

V3 章节创作不是 pipeline —— §4.2(2) 让引导/写/改成为 *turn* 的自由穿插。每次
`/v3/chapter-chat` 调用是一个 turn;Agent 按用户【本轮】的意图分发(不是固定顺序)。
章节内部的「state」就是 turn 本身;跨章节的顺序 state(一章一确定 → 解锁导出,§4.2(1))
归 Web(§8.3 stage 推进权在 Web)—— Agent 保持无状态。

Turn 种类(V3ChapterChatKind,镜像 packages/contracts/src/v3.ts):

  * talk  — 引导:AI 提问/引导,把故事引出来。无 patch。
  * write — 写:模型自行判断聊够了就主动撰写(不必等用户开口),一次性填满本章
            pagesTexts 的【每一页】(§4.2(2))。写完后由 Web 出满意/想改确认卡。
  * edit  — 改:重写聚焦页(§4.2(3))。DeepSeek 判定编辑目标(`editTarget`):
            纯文字 vs 涉及图片(换图/挪图/改图文配比)。
            - editTarget=="text"(默认)→ DeepSeek 重写那页的文字
              (作为一条 layoutPatch 返回)。纯文字编辑【绝不】调用识图(vision)模型
              (图文分流,WP2.3 #187)。
            - editTarget=="image" → 经 `chat_edit_v3.run_image_edit` 把识图模型升级进来:
              它产出一个结构化的 photoId INTENT(绝不出 templateId/pageIndex);确定性 V3
              引擎(pick_template_v3 / assign_images_v3)把它执行成一份整页 layoutPatch。
              模型/引擎无法满足的图片编辑降级为一句 talk 回复(绝不杜撰版式)。

每个 turn 一次 DeepSeek 调用同时完成分发(它返回 `kind`)和该 turn 的内容
(reply / pagesTexts / page texts)。把分类 + 创作放进同一次调用,避免在 60s 同步预算内
再来一次往返,也让模型同时权衡 history + userMessage + focusedPageIndex。代码会按模板槽位
规格对结果钳/校验,使漂移的模型绝无法注入非法槽位或撑爆 maxChars。
"""

from __future__ import annotations

import json
import re
import time
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from ...engine import templates as registry
from ...schemas import (
    Page,
    V3ChapterChatKind,
    V3ChapterChatRequest,
    V3ChapterChatResponse,
    V3LayoutPatchEntry,
    V3Models,
    V3PageTextsPatch,
    V3Usage,
)
from ...settings import get_settings
from ...skills import SKILLS_DIR, load_prompt, load_replies
from ... import ai_client
from ..tools import image_edit as chat_edit_v3
from . import guides as writing_guides

CompleteFn = Callable[..., Awaitable[dict[str, Any]]]

# 角色 + 输入范围 + 输出 JSON 形状:固定结构,co-located 在本 cap 目录,按显式
# 路径加载(对照 theme_recommend/recommend_theme.md)。人为可调的分发/文风规则另放 src/skills/。
_PROMPT_DIR = Path(__file__).resolve().parent

_VALID_KINDS: tuple[str, ...] = ("talk", "write", "edit")
_BRACKET_KEY_RE = re.compile(r"^([A-Za-z0-9_-]+)\[(\d+)\](?:\..*)?$")


class ChapterChatV3Error(Exception):
    """chapter-chat 模型调用或 JSON 响应不可用时抛。

    路由把它映射成 HTTP 错误码(§8.3 同步端点走 HTTP 错误码);前端可重试而不污染 stage。"""


# ---------- prompt 组装 ---------------------------------------------------


def _page_slot_specs_by_index(pages: list[Page]) -> dict[int, list[dict[str, Any]]]:
    """逐页的创作槽规格(model-facing:id/lang[/hint][/repeatIndex])。

    例驱动:role/maxChars 不进 model-facing 规格(角色由「输出示例」表达,字数由服务端钳裁)。

    复用 `writing_guides.page_slot_specs`(只读,与 v2 共享 —— 调用它不会破坏 v2)。它已
    丢掉 decoration 槽(代码自动填充那些)并只暴露 LM 必须撰写的槽。WP2.2 (#186):
    `page_slot_specs` 现在原样带上每个槽的模板撰写的 `hint`,于是逐槽 hint 经这同一接缝
    到达写作 LM(§4.2(4) 逐槽 hint 透传)。"""
    return {page.pageIndex: page_slot_specs(page) for page in pages}


def page_slot_specs(page: Page) -> list[dict[str, Any]]:
    """一个具体页的创作文字槽。

    普通槽按声明保持。repeat 槽被展开成渲染器能为本页实际图片槽寻址的 bracket key,例如
    一个有 ``cells[0].image`` 和 ``cells[1].image`` 的 mag-10 页会暴露 ``cells[0]`` 和
    ``cells[1]``。当未来某模板只有 V3 ``items.texts`` 声明时,用相同的图片索引把那些 item
    key 暴露为 ``caption[0]`` 等。
    """
    tpl = registry.get(page.templateId)
    if not tpl:
        return []

    base_specs = writing_guides.page_slot_specs(page.templateId)
    indices_by_base = _bracket_indices_by_base(page.images.keys())
    all_indices = sorted({idx for indices in indices_by_base.values() for idx in indices})

    # `base_specs` 来自 writing_guides(带 role/maxChars,供代码过滤);model-facing 槽规格
    # 一律经 `_slot_spec` 归一 —— 只留 id/lang/hint(+repeatIndex),不外泄 role/maxChars。
    specs: list[dict[str, Any]] = []
    expanded_bases: set[str] = set()
    for spec in base_specs:
        slot_id = str(spec["id"])
        if spec.get("repeat") is True:
            indices = indices_by_base.get(slot_id, [])
            if indices:
                expanded_bases.add(slot_id)
                for idx in indices:
                    specs.append(_slot_spec(spec, slot_id=f"{slot_id}[{idx}]", repeat_index=idx))
                continue
        specs.append(_slot_spec(spec, slot_id=slot_id))

    # V3 items.texts 以 itemId[index] 寻址。若模板已有一个创作的顶层 repeat 槽
    # (mag-10 的遗留 `cells`),本 WP 以那条路径作为渲染器兼容的真相源;否则 items.texts
    # 成为每个页 item 的必填创作槽。
    item_texts = tpl.get("items", {}).get("texts", [])
    has_authored_repeat = bool(expanded_bases)
    if all_indices:
        for slot in item_texts:
            if slot["role"] not in writing_guides.AUTHORED_ROLES:
                continue
            if has_authored_repeat:
                continue
            for idx in all_indices:
                specs.append(_slot_spec(slot, slot_id=f"{slot['id']}[{idx}]", repeat_index=idx))
    return specs


_page_slot_specs = page_slot_specs


def _bracket_indices_by_base(keys: Any) -> dict[str, list[int]]:
    indices: dict[str, set[int]] = {}
    for key in keys:
        if not isinstance(key, str):
            continue
        match = _BRACKET_KEY_RE.fullmatch(key)
        if not match:
            continue
        indices.setdefault(match.group(1), set()).add(int(match.group(2)))
    return {base: sorted(values) for base, values in indices.items()}


def _slot_spec(slot: dict[str, Any], *, slot_id: str, repeat_index: int | None = None) -> dict[str, Any]:
    # 例驱动(example-driven):模型靠逐页「输出示例」+ 逐槽 hint 写作,不再靠规则约束。
    # 故 model-facing 的槽规格只留 id/lang(语言所需)/hint(写什么)/repeatIndex;
    # 不再带 maxChars(无字数约束进 prompt)与 role(示例已表达每槽的性质)。
    spec: dict[str, Any] = {
        "id": slot_id,
        "lang": slot["lang"],
    }
    if slot.get("hint"):
        spec["hint"] = slot["hint"]
    if repeat_index is not None:
        spec["repeatIndex"] = repeat_index
    return spec


def _scene_background(chapter: Any) -> dict[str, Any]:
    """画面背景 (§4.2(4)):逐照片 sceneDescription,取自请求承载的 §4.1 analysis 树。
    章节 description 是目录(TOC)占位、分析期留空,不进写作上下文(省 token)。
    在构造上隐私干净 —— `V3ChapterPhoto`(`_V3Strict`)在解析时就禁止任何 GPS/place 字段。"""
    return {
        "photos": [
            {"photoId": p.photoId, "sceneDescription": p.sceneDescription}
            for p in chapter.photos
        ],
    }


def _page_images_by_index(pages: list[Page]) -> dict[int, dict[str, str]]:
    """页面结构 (§4.2(4)) 的「每页放了哪些图」:每页的 slot→photoId 映射,好让写作 LM
    知道哪些照片放在哪一页,并能写出真正指向它们的文案。`Page.images` 的只读回显。"""
    return {page.pageIndex: dict(page.images) for page in pages}


def _authored_slot_ids(specs: list[dict[str, Any]]) -> set[str]:
    return {str(spec["id"]) for spec in specs}


def _page_output_example(page: Page, specs: list[dict[str, Any]]) -> dict[str, str]:
    """本页的「输出示例」(例驱动):模板的示例文案,裁到这页实际要写的创作槽。

    示例文案是静态模板串(无用户数据),给写作 LM 看「好的输出长什么样」—— 让它照样式与
    篇幅写、把示例内容换成用户的真实故事。键按 slot id 对齐;repeat-group 示例本就以
    ``explain[0]`` 这样的 bracket key 入键,与逐页展开出的槽 id 直接对得上。无示例文件的
    模板返回空 dict,调用方据此优雅降级(omit 本页示例,仍发 hint+lang)。"""
    example = registry.copy_example(page.templateId)
    if not example:
        return {}
    allowed = _authored_slot_ids(specs)
    return {slot_id: example[slot_id] for slot_id in allowed if slot_id in example}


def _page_output_examples_by_index(
    pages: list[Page], slot_specs: dict[int, list[dict[str, Any]]]
) -> dict[int, dict[str, str]]:
    """逐页输出示例。无示例或无创作槽(纯图页)的页不入字典 —— 优雅省略,绝不崩。"""
    out: dict[int, dict[str, str]] = {}
    for page in pages:
        specs = slot_specs.get(page.pageIndex, [])
        example = _page_output_example(page, specs)
        if example:
            out[page.pageIndex] = example
    return out


def _template_max_chars(template_id: str) -> dict[str, int]:
    """模板各创作槽的 maxChars(按 base slot id),从 registry 直接取 —— 服务端钳长护栏的
    真相源。maxChars 已从 model-facing 槽规格里移除(例驱动,prompt 不带字数),但服务端
    仍据此钳裁防溢出;两件事解耦,各取所需。repeat / items.texts 的 base id 也收进来,
    bracket key(``explain[0]``)按其 base(``explain``)查表。"""
    tpl = registry.get(template_id)
    if not tpl:
        return {}
    out: dict[str, int] = {}
    for slot in tpl.get("texts", []):
        max_chars = slot.get("maxChars")
        if isinstance(max_chars, int) and max_chars > 0:
            out[str(slot["id"])] = max_chars
    for slot in tpl.get("items", {}).get("texts", []):
        max_chars = slot.get("maxChars")
        if isinstance(max_chars, int) and max_chars > 0:
            out[str(slot["id"])] = max_chars
    return out


def _max_chars_for_key(key: str, by_base: dict[str, int]) -> int | None:
    """槽 key 的 maxChars:先按整 key 查(普通槽),再按 bracket base 查(repeat / item 槽)。"""
    if key in by_base:
        return by_base[key]
    match = _BRACKET_KEY_RE.fullmatch(key)
    if match:
        return by_base.get(match.group(1))
    return None


def build_messages(req: V3ChapterChatRequest) -> list[dict[str, str]]:
    """仅从这一章切片构建逐 turn 的分发+创作 prompt。

    单章作用域(§8.3 Web 每次传单章切片):模型从不看到另一章或整本相册。system prompt
    固定 STRICT JSON 契约和分发规则;user payload 承载章节树切片、逐页槽位规格、history、
    用户的消息,以及聚焦页(若有)。
    """
    slot_specs = _page_slot_specs_by_index(req.pages)
    page_images = _page_images_by_index(req.pages)
    page_examples = _page_output_examples_by_index(req.pages, slot_specs)
    focused = req.focusedPageIndex

    # STRICT JSON 契约 + 本轮 dispatch 规则。固定结构(JSON 契约)外置
    # 在 story.md(co-located,显式路径加载);分发/创作/引导规则另放 src/skills/
    # (writing_style / guidance_style)。旧的 `writing_guides.ROLE_GUIDES` 创作话术
    # (`guides_block()`)在 V3 路径上刻意不使用;V3 文风来自 writing_style(v2 仍留
    # ROLE_GUIDES,#197 整删)。
    system = load_prompt(
        _PROMPT_DIR / "story.md",
        skills=("chapter_chat_turns",),
    )
    # §4.2(4): 写作风格(creative style)+ 引导风格(guidance style),都作为 prompt
    # 资产按路径加载(外置在 src/skills/)。语言由槽位的 lang 标记 + 文风资产自身
    # 决定(跟随用户语言),不再由 {LANGUAGE} 占位符强制。
    # 段落分隔标题(=== 写作风格 === / === 引导风格 ===)已并入各 fragment 文件顶部,
    # 这里只做拼接,不再注入字符串字面量。
    system += "\n\n" + load_prompt(
        SKILLS_DIR / "writing_style.md", skills=("grounding",)
    )
    system += "\n\n" + load_prompt(SKILLS_DIR / "guidance_style.md")

    # §4.2(4) 写作 LM 的输入组装。需求点名的每一项都在这里:
    #   用户信息  → history + userMessage(+ 章节上下文里带的 promptHint)
    #   写作 Skill → system(write_chapter),引导 Skill → system(guide_chapter)
    #   逐槽 hint  → pageSlots[].hint(经 page_slot_specs 从模板透传)
    #   输出示例  → pageOutputExamples(每页模板示例文案,例驱动写作的核心)
    #   画面背景  → sceneBackground(逐照片 sceneDescription)
    #   页面结构  → pageSlots(每页 id/lang/hint)+ pageImages(每页放哪些图)
    payload: dict[str, Any] = {
        "language": req.language,
        # 画面背景 (§4.1 analysis 树):逐照片场景。
        "sceneBackground": _scene_background(req.chapter),
        # 页面结构:逐页的创作槽规格(id/lang/hint;无 role/maxChars —— 例驱动)……
        "pageSlots": {str(idx): specs for idx, specs in slot_specs.items()},
        # 输出示例(例驱动):逐页模板示例文案(slotId→示例串),裁到本页创作槽。模型照样式
        # 与篇幅写、把示例内容换成用户真实故事。无示例文件的模板那页缺省省略(仍有 hint+lang)。
        "pageOutputExamples": {str(idx): ex for idx, ex in page_examples.items()},
        # ……以及每页放了哪些照片(slot→photoId)。
        "pageImages": {str(idx): imgs for idx, imgs in page_images.items()},
        # 用户信息:到目前为止的对话 + 本轮消息。
        "history": [turn.model_dump() for turn in req.history],
        "userMessage": req.userMessage,
        "focusedPageIndex": focused,
    }
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
    ]


# ---------- model call --------------------------------------------------------


async def run(
    req: V3ChapterChatRequest,
    *,
    complete: CompleteFn | None = None,
    call_intent: Callable[[str], Awaitable[list[str]]] | None = None,
) -> V3ChapterChatResponse:
    started = time.monotonic()
    messages = build_messages(req)
    response = await _complete(messages, complete=complete, max_tokens=1800, temperature=0.35)
    parsed = _parse_model_json(response)
    duration_ms = int((time.monotonic() - started) * 1000)
    usage = _usage_from_response(response, duration_ms)
    # `call_intent` 注入 WP2.3 图片编辑意图调用(识图模型),镜像 `complete` 注入 DeepSeek
    # 分发的方式 —— 两者都默认走真实 provider,只在测试里被覆盖。
    return await _coerce_response(req, parsed, usage, call_intent=call_intent)


async def _complete(
    messages: list[dict[str, str]],
    *,
    complete: CompleteFn | None,
    max_tokens: int,
    temperature: float,
) -> dict[str, Any]:
    if complete is not None:
        return await complete(messages=messages, max_tokens=max_tokens, temperature=temperature)

    settings = get_settings()
    if not settings.deepseek_api_key:
        raise ChapterChatV3Error("DEEPSEEK_API_KEY missing; cannot run chapter-chat")
    try:
        return await ai_client.chat_completion(
            base_url=settings.deepseek_base_url,
            api_key=settings.deepseek_api_key,
            model=settings.deepseek_model,
            messages=messages,
            timeout_seconds=settings.deepseek_timeout_seconds,
            response_format=(
                {"type": "json_object"} if settings.deepseek_use_json_object else None
            ),
            max_tokens=max_tokens,
            temperature=temperature,
            extra_body=(
                {"thinking": {"type": "disabled"}} if settings.deepseek_disable_thinking else None
            ),
        )
    except ai_client.AIRequestError as exc:
        raise ChapterChatV3Error(f"chapter-chat model call failed: {exc}") from exc


def _parse_model_json(response: dict[str, Any]) -> dict[str, Any]:
    try:
        parsed = ai_client.parse_json_loose(ai_client.extract_text(response))
    except ValueError as exc:
        raise ChapterChatV3Error(
            f"chapter-chat model response was not valid JSON: {exc}"
        ) from exc
    if not isinstance(parsed, dict):
        raise ChapterChatV3Error(
            f"chapter-chat model response must be an object, got {type(parsed).__name__}"
        )
    return parsed


def _usage_from_response(response: dict[str, Any], duration_ms: int) -> V3Usage:
    settings = get_settings()
    prompt_tokens, completion_tokens = ai_client.extract_usage(response)
    return V3Usage(
        durationMs=duration_ms,
        planningInputTokens=prompt_tokens,
        planningOutputTokens=completion_tokens,
        models=V3Models(planning=settings.deepseek_model),
    )


# ---------- 响应矫正 -------------------------------------------------


async def _coerce_response(
    req: V3ChapterChatRequest,
    parsed: dict[str, Any],
    usage: V3Usage,
    *,
    call_intent: Callable[[str], Awaitable[list[str]]] | None = None,
) -> V3ChapterChatResponse:
    kind = _resolve_kind(req, parsed.get("kind"))
    # 可选的 V3 响应字段是带「缺失哨兵」默认值的 strict-typed 列表 —— 显式传 None 会过不了
    # strict 校验。构建 kwargs,仅在字段真有值时才包含它。
    name_options = _coerce_name_options(parsed.get("nameOptions"))
    extra: dict[str, Any] = {}
    if name_options is not None:
        extra["nameOptions"] = name_options

    if kind == "write":
        pages_texts = _coerce_pages_texts(req, parsed.get("pagesTexts"))
        if _missing_required_texts(req, pages_texts):
            reply = _default_reply(req.language, "talk")
            return V3ChapterChatResponse(
                kind="talk",
                assistantReply=reply[:500],
                usage=usage,
                **extra,
            )
        reply = _text(parsed.get("assistantReply")) or _default_reply(req.language, "write")
        return V3ChapterChatResponse(
            kind="write",
            assistantReply=reply[:500],
            pagesTexts=pages_texts,
            usage=usage,
            **extra,
        )

    if kind == "edit":
        # 图文分流 (WP2.3 #187):偏图片的编辑把识图模型升级进来产出意图;文字编辑留在
        # DeepSeek。纯文字编辑【绝不】调用识图模型。
        if _is_image_edit(parsed.get("editTarget")):
            patch = await _coerce_image_edit_patch(req, call_intent=call_intent)
            if patch is not None:
                reply = _text(parsed.get("assistantReply")) or _default_reply(
                    req.language, "edit"
                )
                return V3ChapterChatResponse(
                    kind="edit",
                    assistantReply=reply[:500],
                    layoutPatch=[patch],
                    usage=usage,
                    **extra,
                )
            # 模型/引擎无法满足的图片编辑 → talk(绝不杜撰)。
        else:
            patch = _coerce_edit_patch(req, parsed.get("pageTexts"))
            if patch is not None:
                reply = _text(parsed.get("assistantReply")) or _default_reply(
                    req.language, "edit"
                )
                return V3ChapterChatResponse(
                    kind="edit",
                    assistantReply=reply[:500],
                    layoutPatch=[patch],
                    usage=usage,
                    **extra,
                )
        # 模型判定为 edit 但没产出可用的 patch(纯文字编辑却无可用文字、引擎摆不下的图片
        # 编辑,或聚焦页缺失 / 不在切片内)。降级为 talk turn,而不是发出一份空/非法 patch
        # —— 绝不杜撰版式。

    # talk — 引导:只回复,绝不出 patch(Frame 4 红线)。也是无可应用内容的 edit turn 的
    # 兜底落点。
    reply = _text(parsed.get("assistantReply")) or _default_reply(req.language, "talk")
    return V3ChapterChatResponse(
        kind="talk",
        assistantReply=reply[:500],
        usage=usage,
        **extra,
    )


def _resolve_kind(req: V3ChapterChatRequest, raw: Any) -> V3ChapterChatKind:
    """当模型的分发是三种 kind 之一时就信任它(是否主动写由模型在 kind 字段里表达);否则
    回退到一个安全默认值。`edit` 仅在聚焦页确实在本轮切片内时才被采纳 —— 没有它就没什么可改
    的,于是当作 talk(引导)。未知/缺失的 kind → talk(安全兜底,不臆造写/改)。"""
    kind = raw if isinstance(raw, str) else ""
    if kind == "edit":
        if req.focusedPageIndex is None:
            return "talk"
        if not any(p.pageIndex == req.focusedPageIndex for p in req.pages):
            return "talk"
        return "edit"
    if kind in ("talk", "write"):
        return kind  # type: ignore[return-value]
    return "talk"


def _coerce_pages_texts(
    req: V3ChapterChatRequest, raw: Any
) -> list[V3PageTextsPatch]:
    """Write turn:本章每页一个 V3PageTextsPatch(§4.2(2) 写整章)。每页只保留其模板的
    创作槽,每个都钳到该槽的 maxChars。模型遗漏的页返回一个空的 texts 映射(章节故事环节
    可再细化;我们绝不丢页或臆造槽位)。"""
    raw_by_index = _raw_texts_by_index(raw)
    slot_specs = _page_slot_specs_by_index(req.pages)
    out: list[V3PageTextsPatch] = []
    for page in req.pages:
        specs = slot_specs.get(page.pageIndex, [])
        texts = _clean_texts(
            raw_by_index.get(page.pageIndex, {}), specs, template_id=page.templateId
        )
        out.append(V3PageTextsPatch(pageIndex=page.pageIndex, texts=texts))
    return out


def _missing_required_texts(req: V3ChapterChatRequest, pages_texts: list[V3PageTextsPatch]) -> list[str]:
    by_index = {patch.pageIndex: patch.texts for patch in pages_texts}
    missing: list[str] = []
    for page in req.pages:
        specs = page_slot_specs(page)
        required = {str(spec["id"]) for spec in specs}
        if not required:
            continue
        present = set(by_index.get(page.pageIndex, {}).keys())
        for slot_id in sorted(required - present):
            missing.append(f"{page.pageIndex}:{slot_id}")
    return missing


def _is_image_edit(raw: Any) -> bool:
    """DeepSeek 的 edit 分发用 editTarget=="image" 标记一个偏图片的 turn(换图/挪图/改图文
    配比)。其它一切(含缺失 / "text")都是纯文字编辑,绝不能碰识图模型(图文分流,WP2.3)。"""
    return isinstance(raw, str) and raw.strip().lower() == "image"


async def _coerce_image_edit_patch(
    req: V3ChapterChatRequest,
    *,
    call_intent: Callable[[str], Awaitable[list[str]]] | None = None,
) -> V3LayoutPatchEntry | None:
    """涉及图片 edit (§4.2(3) / WP2.3):把聚焦页 + 本章照片 + 用户消息交给 `chat_edit_v3`,
    由它让识图模型产出一个 photoId 意图,并跑确定性引擎来执行。模型从不产出
    templateId/pageIndex —— 引擎保证版式合法。聚焦页缺失/不在切片内或没有可用结果时返回
    None(→ talk);绝不抛错(`run_image_edit` 内部自降级)。"""
    focused = req.focusedPageIndex
    if focused is None:
        return None
    page = next((p for p in req.pages if p.pageIndex == focused), None)
    if page is None:
        return None
    return await chat_edit_v3.run_image_edit(
        req.chapter, page, req.userMessage, call_intent=call_intent
    )


def _coerce_edit_patch(
    req: V3ChapterChatRequest, raw: Any
) -> V3LayoutPatchEntry | None:
    """Edit turn(纯文字):【只】重写聚焦页的文字。返回一条承载清洗后文字的 layoutPatch
    (不改 templateId/images —— 照片/版式升级是 WP2.3)。没有可应用的东西时返回 None。"""
    focused = req.focusedPageIndex
    if focused is None:
        return None
    page = next((p for p in req.pages if p.pageIndex == focused), None)
    if page is None:
        return None
    if not isinstance(raw, dict):
        return None
    raw_texts = raw.get("texts")
    if not isinstance(raw_texts, dict):
        return None
    specs = _page_slot_specs(page)
    texts = _clean_texts(raw_texts, specs, template_id=page.templateId)
    if not texts:
        return None
    return V3LayoutPatchEntry(pageIndex=focused, texts=texts)


def _raw_texts_by_index(raw: Any) -> dict[int, dict[str, Any]]:
    by_index: dict[int, dict[str, Any]] = {}
    if not isinstance(raw, list):
        return by_index
    for item in raw:
        if not isinstance(item, dict):
            continue
        try:
            page_index = int(item["pageIndex"])
        except (KeyError, TypeError, ValueError):
            continue
        texts = item.get("texts")
        if isinstance(texts, dict):
            by_index[page_index] = texts
    return by_index


def clean_texts(
    raw_texts: dict[str, Any], specs: list[dict[str, Any]], *, template_id: str | None = None
) -> dict[str, str]:
    """Public text cleaner for non-writing callers such as cover_v3.

    When a concrete template id is available, use the registry maxChars path. Older
    call sites that only have already-expanded specs still get slot filtering and
    per-spec caps.
    """
    allowed = _authored_slot_ids(specs)
    if template_id:
        max_chars = _template_max_chars(template_id)
    else:
        max_chars = {
            str(spec["id"]): int(spec["maxChars"])
            for spec in specs
            if isinstance(spec.get("id"), str)
            and isinstance(spec.get("maxChars"), int)
            and spec["maxChars"] > 0
        }
    out: dict[str, str] = {}
    for key, value in raw_texts.items():
        if not isinstance(key, str) or key not in allowed:
            continue
        text = _text(value)
        if not text:
            continue
        cap = _max_chars_for_key(key, max_chars) if template_id else max_chars.get(key)
        out[key] = text[:cap] if cap else text
    return out


_clean_texts = clean_texts


def _coerce_name_options(raw: Any) -> list[str] | None:
    """宽容解析模型的 `nameOptions`:最多 4 个非空、去重的标题。无一存活时返回 None
    (该字段保持可选)。"""
    if not isinstance(raw, list):
        return None
    seen: set[str] = set()
    names: list[str] = []
    for item in raw:
        name = _text(item)
        if not name or name in seen:
            continue
        seen.add(name)
        names.append(name[:120])
        if len(names) == 4:
            break
    return names or None


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) and value.strip() else ""


def _default_reply(language: str, kind: str) -> str:
    """从 skills/replies/writing.md 读兜底回复(`kind.语言`),按路径缓存。未知 kind 回 talk。"""
    replies = load_replies(SKILLS_DIR / "replies" / "writing.md")
    lang = "zh" if language == "zh" else "en"
    return (
        replies.get(f"{kind}.{lang}")
        or replies.get(f"talk.{lang}", "")
    )
