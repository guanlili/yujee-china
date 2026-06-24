"""统一创作 agent loop —— harness 驱动的 JSON-action 自主创作(第一刀:统一 chapter-chat edit)。

模型自主决定改版式 / 换图 / 改文案,不再 `editTarget=text/image` 二分。每轮模型回一个
``{"thought","action","args"}``;本模块执行确定性工具、把结果喂回对话,直到模型 `finish` 或
触达步数上限。所有工具产出都过确定性护栏(legal candidates / assign_images_v3 / maxChars 钳),
漂移的模型无法注入非法版式、越界文案,或本章之外的照片。

无状态 / 隐私(§3):loop 只吃文字(本章照片的 sceneDescription、聚焦页当前结构、用户消息),
无 base64。`describe_photo` 在改图场景只回照片 analyze 时已写的 sceneDescription(本章照片都有);
"换入一张全新照片"的真 vision 需要单独的 base64 通道,留待后续。

harness 引导(system prompt + 工具语义)在 `author_page.md`,可单独打磨;本模块只管协议、状态机、
护栏、终止。`complete` 注入让测试不打真实 provider(镜像 chapter-chat handler)。

分阶段(路线见 docs/agent/unified-authoring-agent.md):
  * 第一刀(本模块当前作用域):**编辑(改页)的 harness** —— `author_page.md` 是「改某一页」
    的引导,接入 chapter-chat 的 edit 分支。
  * 后续:**整个创作 agent 的 harness** —— 把初排(选版式 + 写文案)和写整章 write 也收编进
    同一个 loop,让「初排 / 写章 / 改图」走一套代码(unified 方案第三刀)。届时 harness 会从
    「改一页」扩到「创作一页/一章」,工具集复用本模块这套。
"""

from __future__ import annotations

import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ... import ai_client
from ...engine import skeleton_v3
from ...engine import templates as registry
from ...prompts import load_prompt
from ...schemas import Page, V3Chapter, V3LayoutPatchEntry, V3Models, V3Usage
from ...settings import get_settings
from . import page_text_slots as slots

_PROMPT_DIR = Path(__file__).resolve().parent
_INTERIOR: skeleton_v3.Category = "interior"

# loop 步数硬上限(评审 N1):每步一次 DeepSeek 往返,改图正常 2–4 步够;上限兜底防不收敛。
MAX_STEPS = 6

CompleteFn = Callable[..., Awaitable[dict[str, Any]]]


class AuthorLoopError(Exception):
    """loop 模型调用 / 响应不可用时抛。路由映射成可重试的 HTTP 错误(不污染 stage)。"""


# ---------- 工作态 -----------------------------------------------------------


@dataclass
class WorkingPage:
    """聚焦页的可变工作态。工具逐步改它,finish 时拍成一份整页 layoutPatch。"""

    page_index: int
    template_id: str
    photo_order: list[str]
    texts: dict[str, str]
    dirty: bool = False

    @classmethod
    def from_page(cls, page: Page) -> "WorkingPage":
        tpl = registry.get(page.templateId)
        slot_keys = skeleton_v3.image_slot_keys(tpl) if tpl else []
        order = [page.images[k] for k in slot_keys if page.images.get(k)]
        # 容错:images 里有未在声明槽序中的项(理论不该)也按出现顺序带上,保证不丢图。
        for value in page.images.values():
            if value and value not in order:
                order.append(value)
        return cls(
            page_index=page.pageIndex,
            template_id=page.templateId,
            photo_order=order,
            texts=dict(page.texts),
        )

    def to_patch(self) -> V3LayoutPatchEntry:
        """拍平成整页 patch。先确保版式装得下当前照片(兜底),再 assign + 钳文字。"""
        self._ensure_fit()
        images = _safe_assign(self.template_id, self.photo_order)
        specs = slots.slot_specs_for_page(
            Page(pageIndex=self.page_index, templateId=self.template_id, images=images, texts={})
        )
        clean = slots.clean_texts(self.texts, specs)
        return V3LayoutPatchEntry(
            pageIndex=self.page_index,
            templateId=self.template_id,
            images=images,
            texts=clean,
        )

    def _ensure_fit(self) -> None:
        """finish 兜底:若当前版式装不下照片数,选一个能装下的合法版式(评审防崩)。
        正常路径模型会自己 pick_layout;这里只防模型漏 pick 时产出非法 patch。"""
        cap = _capacity(self.template_id)
        if cap < len(self.photo_order):
            cands = skeleton_v3.legal_candidates(_INTERIOR, len(self.photo_order))
            if cands:
                self.template_id = cands[0]["templateId"]


# ---------- 工具(确定性护栏) ------------------------------------------------


def _tool_pick_layout(args: dict[str, Any], state: WorkingPage, chapter: V3Chapter) -> str:
    template_id = args.get("templateId")
    count = len(state.photo_order)
    legal = {c["templateId"] for c in skeleton_v3.legal_candidates(_INTERIOR, count)}
    if not isinstance(template_id, str) or template_id not in legal:
        return (
            f"错误:'{template_id}' 不是装 {count} 张照片的合法版式。"
            f"合法候选:{sorted(legal)}。请从中重选。"
        )
    state.template_id = template_id
    state.dirty = True
    return f"已选版式 {template_id}(容量 {_capacity(template_id)} 张)。"


def _tool_set_photos(args: dict[str, Any], state: WorkingPage, chapter: V3Chapter) -> str:
    raw = args.get("photoIds")
    chapter_ids = {p.photoId for p in chapter.photos}
    order: list[str] = []
    seen: set[str] = set()
    for pid in raw if isinstance(raw, list) else []:
        if isinstance(pid, str) and pid in chapter_ids and pid not in seen:
            seen.add(pid)
            order.append(pid)
    if not order:
        return (
            f"错误:photoIds 必须取自本章照片 {sorted(chapter_ids)},且至少保留一张。"
        )
    cap_max = skeleton_v3.max_capacity(_INTERIOR)
    if len(order) > cap_max:
        order = order[:cap_max]
    state.photo_order = order
    state.dirty = True
    cur_cap = _capacity(state.template_id)
    if len(order) > cur_cap:
        return (
            f"已设 {len(order)} 张照片(顺序 {order});当前版式只装 {cur_cap} 张,"
            f"请用 pick_layout 选一个能装 {len(order)} 张的版式。"
        )
    return f"已设 {len(order)} 张照片(顺序 {order})。"


def _tool_write_texts(args: dict[str, Any], state: WorkingPage, chapter: V3Chapter) -> str:
    raw = args.get("texts")
    if not isinstance(raw, dict):
        return "错误:texts 必须是 {槽位id: 文字} 对象。"
    images = _safe_assign(state.template_id, state.photo_order)
    specs = slots.slot_specs_for_page(
        Page(pageIndex=state.page_index, templateId=state.template_id, images=images, texts={})
    )
    allowed = {str(s["id"]) for s in specs}
    cleaned = slots.clean_texts(raw, specs)
    state.texts.update(cleaned)
    if cleaned:
        state.dirty = True
    ignored = [k for k in raw if k not in allowed]
    msg = f"已写入槽位 {sorted(cleaned.keys())}。"
    if ignored:
        msg += f" 忽略非法槽位 {ignored};本页可写槽位:{sorted(allowed)}。"
    return msg


def _tool_describe_photo(args: dict[str, Any], state: WorkingPage, chapter: V3Chapter) -> str:
    pid = args.get("photoId")
    for photo in chapter.photos:
        if photo.photoId == pid:
            return photo.sceneDescription or "(这张照片暂无场景描述)"
    return f"错误:{pid} 不在本章照片里(本章:{sorted(p.photoId for p in chapter.photos)})。"


_TOOLS: dict[str, Callable[[dict[str, Any], WorkingPage, V3Chapter], str]] = {
    "pick_layout": _tool_pick_layout,
    "set_photos": _tool_set_photos,
    "write_texts": _tool_write_texts,
    "describe_photo": _tool_describe_photo,
}


# ---------- loop -------------------------------------------------------------


async def run_author_edit(
    chapter: V3Chapter,
    page: Page,
    user_message: str,
    history: list[Any] | None = None,
    *,
    complete: CompleteFn | None = None,
    max_steps: int = MAX_STEPS,
) -> tuple[V3LayoutPatchEntry | None, str, V3Usage]:
    """对聚焦页跑创作 loop。返回 (layoutPatch | None, reply, usage)。

    模型一步没动(state 未 dirty)→ patch=None,调用方降级为 talk(绝不发空 patch)。
    """
    started = time.monotonic()
    state = WorkingPage.from_page(page)
    messages: list[dict[str, str]] = [
        {"role": "system", "content": _system_prompt()},
        {"role": "user", "content": _initial_user(chapter, state, user_message, history or [])},
    ]
    reply = ""
    in_tok = 0
    out_tok = 0

    for _step in range(max_steps):
        response = await _complete(messages, complete=complete)
        p_tok, c_tok = ai_client.extract_usage(response)
        in_tok += p_tok
        out_tok += c_tok
        text = ai_client.extract_text(response)
        messages.append({"role": "assistant", "content": text})

        action = _parse_action(text)
        if action is None:
            messages.append(
                {"role": "user", "content": '[格式错误] 只回 {"thought","action","args"} 的 JSON。'}
            )
            continue
        name = action.get("action")
        args = action.get("args") if isinstance(action.get("args"), dict) else {}
        if name == "finish":
            reply = slots.as_text(args.get("reply"))
            break
        tool = _TOOLS.get(name) if isinstance(name, str) else None
        if tool is None:
            result = f"未知动作 '{name}'。可用:{sorted(_TOOLS) + ['finish']}。"
        else:
            result = tool(args, state, chapter)
        messages.append({"role": "user", "content": f"[{name} 结果] {result}"})

    usage = V3Usage(
        durationMs=int((time.monotonic() - started) * 1000),
        planningInputTokens=in_tok,
        planningOutputTokens=out_tok,
        models=V3Models(planning=get_settings().deepseek_model),
    )
    if not state.dirty:
        return None, reply, usage
    return state.to_patch(), reply, usage


# ---------- prompt 组装 ------------------------------------------------------


def _system_prompt() -> str:
    return load_prompt(_PROMPT_DIR / "author_page.md")


def _initial_user(
    chapter: V3Chapter, state: WorkingPage, user_message: str, history: list[Any]
) -> str:
    photos = "\n".join(
        f"  - {p.photoId}: {p.sceneDescription or '(无描述)'}" for p in chapter.photos
    )
    candidates = skeleton_v3.legal_candidates(_INTERIOR, len(state.photo_order))
    cand_lines = "\n".join(
        f"  - {c['templateId']}(装 {c['imageSlotCount']} 张)" for c in candidates
    )
    history_lines = _format_history(history)
    return (
        f"章节:{chapter.description or '(无描述)'}\n\n"
        f"本章全部照片(只能用这些 photoId):\n{photos}\n\n"
        f"正在编辑第 {state.page_index} 页。当前版式:{state.template_id};"
        f"当前照片(按顺序):{state.photo_order};当前文字:{state.texts or '(空)'}\n\n"
        f"当前照片数下的合法版式候选:\n{cand_lines or '  (无)'}\n\n"
        f"{history_lines}"
        f"用户对这一页的要求:\n{user_message}"
    )


def _format_history(history: list[Any]) -> str:
    lines: list[str] = []
    for turn in history[-6:]:
        role = getattr(turn, "role", None) or (turn.get("role") if isinstance(turn, dict) else None)
        content = getattr(turn, "content", None) or (
            turn.get("content") if isinstance(turn, dict) else None
        )
        if role and content:
            who = "用户" if role == "user" else "你"
            lines.append(f"  {who}: {content}")
    return ("最近对话:\n" + "\n".join(lines) + "\n\n") if lines else ""


def _parse_action(text: str) -> dict[str, Any] | None:
    try:
        parsed = ai_client.parse_json_loose(text)
    except ValueError:
        return None
    return parsed if isinstance(parsed, dict) else None


# ---------- model call -------------------------------------------------------


async def _complete(
    messages: list[dict[str, str]], *, complete: CompleteFn | None
) -> dict[str, Any]:
    if complete is not None:
        return await complete(messages=messages, max_tokens=1200, temperature=0.4)
    settings = get_settings()
    if not settings.deepseek_api_key:
        raise AuthorLoopError("DEEPSEEK_API_KEY missing; cannot run author loop")
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
            max_tokens=1200,
            temperature=0.4,
            extra_body=(
                {"thinking": {"type": "disabled"}} if settings.deepseek_disable_thinking else None
            ),
        )
    except ai_client.AIRequestError as exc:
        raise AuthorLoopError(f"author loop model call failed: {exc}") from exc


# ---------- helpers ----------------------------------------------------------


def _capacity(template_id: str) -> int:
    tpl = registry.get(template_id)
    return skeleton_v3.image_capacity(tpl) if tpl else 0


def _safe_assign(template_id: str, order: list[str]) -> dict[str, str]:
    """assign,但绝不抛:容量不足时只放下能放的(to_patch 已先 _ensure_fit,正常路径全放下)。"""
    tpl = registry.get(template_id)
    if tpl is None:
        return {}
    cap = skeleton_v3.image_capacity(tpl)
    return skeleton_v3.assign_images_v3(template_id, order[:cap])
