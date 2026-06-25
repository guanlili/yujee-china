"""V3 页级编辑:两段式 dispatch(意图路由 → 专门执行),只作用于聚焦页。

设计 spec:docs/superpowers/specs/2026-06-25-page-edit-agent-loop-design.md。
chapter-chat(per-turn 分类器)把「判意图」和「写文案」揉在一次调用里,难调、易崩,且
编辑时不喂当前 texts(蒙眼重写)。本环节把两件事拆开:

  * 段一 · 意图路由(一次「轻」调用):输入 userMessage + history + 聚焦页摘要 + 完成度,
    输出 STRICT JSON `{"intent":"edit_text|change_layout|advance|talk","reply"?:str}`。
    不产出页面内容。换图意图归 talk(去现有 chapter-chat 的 image-edit 路径)。
  * 段二 · 专门执行:
      - edit_text → 一次专门「写作」调用(写作风格 prompt,输入含【当前 texts】),按槽
        校验/钳 maxChars 后落一条 `{pageIndex, texts}` 补丁。
      - change_layout → 纯确定性(无模型调用):`legal_candidates` 选模板、`assign_images_v3`
        按序重排图,落一条 `{pageIndex, templateId, images}` 补丁。换版丢弃旧 imagePos。
      - advance → 置 advanceIntent=True + 确认 reply(无执行调用)。
      - talk → 用段一 reply。

完成度(`page_filled` / `chapter_completion`)由 Agent 代码确定性算 —— 复用
writing/handler 的 `_page_slot_specs` + `_missing_required_texts`,按 page.images 当前键
展开 grid 槽,不另写判定。派生计算、不落库;作为段一的上下文。

健壮性(§2.3 预算 <60s,§8.3 模型出意图、引擎保合法):整体 `asyncio.wait_for` <60s;任一
段失败 / 解析错 / provider 缺失 / 超时 → 安全兜底,回保守 assistantReply、零 layoutPatch、
草稿零改动。change_layout 只能选 legal_candidates、edit_text 受限槽位校验 —— 非法即拒,绝不
写坏草稿。无状态 / 隐私(§3):只发文字(当前 texts + 照片 scene/orientation),无 base64 /
GPS;V3Chapter/Page 已 strict,拒任何 place/坐标 key。
"""

from __future__ import annotations

import asyncio
import json
import time
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from ...logging_config import get_logger
from ...schemas import (
    Page,
    V3Chapter,
    V3LayoutPatchEntry,
    V3Models,
    V3PageEditIntent,
    V3PageEditRequest,
    V3PageEditResponse,
    V3Usage,
)
from ...settings import get_settings
from ...prompts import RULES_DIR, load_prompt
from ... import ai_client
from ...engine import skeleton_v3
from ..writing import handler as writing

_PROMPT_DIR = Path(__file__).resolve().parent

log = get_logger("page_edit")

CompleteFn = Callable[..., Awaitable[dict[str, Any]]]

# 本环节只编辑正文页(interior);change_layout 候选池始终是 interior 类别。
_INTERIOR: skeleton_v3.Category = "interior"

# 整步硬上限(§2.3 预算 <60s);段内各调用沿用 chapter-chat 的 per-call DeepSeek 超时。
_OVERALL_BUDGET_SECONDS = 58.0

_VALID_INTENTS: tuple[str, ...] = ("edit_text", "change_layout", "advance", "talk")


class PageEditError(Exception):
    """page-edit 模型调用 / 响应不可用时抛 —— 路由把它映射成 HTTP 错误码(§8.3 同步端点)。

    注意:`run` 自身对所有内部失败做安全兜底(回保守 talk),不抛此错;它存在是为对齐
    chapter-chat 的路由错误码契约(502 AGENT_PLANNING_FAILED),并供未来需要硬失败的路径用。"""


# ---------- 完成度工具(确定性,复用 writing 判定)----------------------------


def page_filled(page: Page) -> bool:
    """该页是否「填满」:其模板所有 authored 文字槽都有非空文案。

    复用 writing/handler 的 `_page_slot_specs`(按 page.images 当前键展开 grid/items 槽、
    丢 decoration 代码槽)+ `_missing_required_texts` —— 不另写判定。无 authored 槽的模板
    (如 mag-03)恒为 filled。"""
    return not _missing_required_for_page(page)


def chapter_completion(chapter_id: str, pages: list[Page]) -> dict[str, Any]:
    """整章完成度:`{chapterId, filled: all(page_filled), pages:[{pageIndex, filled}]}`。

    派生计算、不落库;作为段一的上下文喂给意图路由。"""
    per_page = [{"pageIndex": p.pageIndex, "filled": page_filled(p)} for p in pages]
    return {
        "chapterId": chapter_id,
        "filled": all(item["filled"] for item in per_page),
        "pages": per_page,
    }


def _missing_required_for_page(page: Page) -> list[str]:
    """单页缺失的 authored 槽 id —— 复用 writing 的 per-page slot 判定(单一实现)。

    `_missing_required_texts` 以 req + pages_texts 工作;这里把单页的当前 texts 包成它要的
    形状(V3PageTextsPatch),从而复用同一判定,绝不另写。"""
    from ...schemas import V3PageTextsPatch

    req = _SinglePageReq(pages=[page])
    patch = V3PageTextsPatch(pageIndex=page.pageIndex, texts=dict(page.texts))
    return writing._missing_required_texts(req, [patch])


class _SinglePageReq:
    """`_missing_required_texts` / `_coerce_edit_patch` 只读 `.pages` 的最小 duck-type 载体。"""

    __slots__ = ("pages",)

    def __init__(self, pages: list[Page]) -> None:
        self.pages = pages


# ---------- 段一 · 意图路由 ---------------------------------------------------


def _focused_page(req: V3PageEditRequest) -> Page | None:
    return next((p for p in req.pages if p.pageIndex == req.focusedPageIndex), None)


def _page_summary(page: Page | None) -> dict[str, Any]:
    """聚焦页精简摘要给段一:模板、当前 texts、各槽位规格(含 hint)、放了哪些图。"""
    if page is None:
        return {}
    specs = writing._page_slot_specs(page)
    return {
        "pageIndex": page.pageIndex,
        "templateId": page.templateId,
        "currentTexts": dict(page.texts),
        "slots": specs,
        "images": dict(page.images),
    }


def _scene_summary(chapter: V3Chapter, page: Page | None) -> list[dict[str, str]]:
    """聚焦页照片的场景概要(photoId | orientation | scene);无 base64 / GPS(§3)。"""
    if page is None:
        return []
    used = set(page.images.values())
    return [
        {"photoId": p.photoId, "orientation": p.orientation, "scene": p.sceneDescription}
        for p in chapter.photos
        if p.photoId in used
    ]


def _build_intent_messages(req: V3PageEditRequest, completion: dict[str, Any]) -> list[dict[str, str]]:
    page = _focused_page(req)
    system = load_prompt(_PROMPT_DIR / "intent_router.md", common=("json_only",))
    payload = {
        "language": req.language,
        "userMessage": req.userMessage,
        "history": [turn.model_dump() for turn in req.history],
        "focusedPage": _page_summary(page),
        "photos": _scene_summary(req.chapter, page),
        "chapterCompletion": completion,
    }
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
    ]


async def _route_intent(
    req: V3PageEditRequest, completion: dict[str, Any], *, complete: CompleteFn | None
) -> tuple[V3PageEditIntent, str]:
    """段一:判意图。返回 (intent, reply)。失败 / 解析错 / 未知意图 → ('talk', 默认引导)。"""
    messages = _build_intent_messages(req, completion)
    raw = await _complete(messages, complete=complete, max_tokens=400, temperature=0.2)
    parsed = _parse_json(raw)
    intent = parsed.get("intent")
    intent = intent if isinstance(intent, str) and intent in _VALID_INTENTS else "talk"
    reply = _text(parsed.get("reply"))
    return intent, reply  # type: ignore[return-value]


# ---------- 段二 · edit_text(一次专门写作调用)------------------------------


def _build_edit_messages(req: V3PageEditRequest, page: Page) -> list[dict[str, str]]:
    """段二写作 prompt:写作风格 + 聚焦页全貌(槽位+逐槽 hint + slot→photoId + 照片 scene +
    【当前 texts】)+ userMessage。沿用 chapter-chat 的写作风格资产(grounding)。"""
    system = (
        writing.writing_guides.persona_block()
        + "\n\n"
        + load_prompt(_PROMPT_DIR / "edit_text.md", common=("json_only",))
        + "\n\n=== 写作风格(WRITING STYLE)===\n"
        + load_prompt(RULES_DIR / "writing_style.md", common=("grounding",))
    )
    payload = {
        "language": req.language,
        "userMessage": req.userMessage,
        "focusedPage": _page_summary(page),
        "photos": _scene_summary(req.chapter, page),
    }
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
    ]


async def _execute_edit_text(
    req: V3PageEditRequest, page: Page, *, complete_edit: CompleteFn | None
) -> V3LayoutPatchEntry | None:
    """段二:重写聚焦页文字。按槽校验 + 钳 maxChars(复用 writing 的清洗护栏)。无可用文字
    时返回 None(→ talk)。模型调用失败时抛 PageEditError,由 run 捕获兜底为 talk。"""
    messages = _build_edit_messages(req, page)
    raw = await _complete(messages, complete=complete_edit, max_tokens=1200, temperature=0.4)
    parsed = _parse_json(raw)
    raw_texts = parsed.get("texts")
    if not isinstance(raw_texts, dict):
        return None
    specs = writing._page_slot_specs(page)
    texts = writing._clean_texts(raw_texts, specs)
    if not texts:
        return None
    return V3LayoutPatchEntry(pageIndex=page.pageIndex, texts=texts)


# ---------- 段二 · change_layout(纯确定性,零模型调用)-----------------------


def _execute_change_layout(page: Page) -> V3LayoutPatchEntry | None:
    """段二:确定性重排版。从聚焦页照片数的 legal_candidates 里选一个【不同于当前】的合法
    模板(过滤掉当前模板后确定性挑首个),`assign_images_v3` 按序重排图。模型无法注入非法
    templateId(§8.3)。换版【丢弃旧 imagePos】(显式预期):补丁不含 imagePos 字段。

    排除当前模板是关键:用户要"换"版,挑回同一个等于没换(no-op 补丁),不合预期。

    无照片 / 没有【其它】能容纳的合法模板(该照片数只有当前这一个版式)→ None
    (→ talk 明说换不了;绝不杜撰版式、也绝不回与现状相同的 no-op 补丁)。"""
    photo_ids = list(page.images.values())
    if not photo_ids:
        return None
    candidates = skeleton_v3.legal_candidates(_INTERIOR, len(photo_ids))
    template_id = next(
        (c["templateId"] for c in candidates if c["templateId"] != page.templateId),
        None,
    )
    if template_id is None:
        return None
    try:
        images = skeleton_v3.assign_images_v3(template_id, photo_ids)
    except ValueError:
        return None
    return V3LayoutPatchEntry(pageIndex=page.pageIndex, templateId=template_id, images=images)


# ---------- 编排 -------------------------------------------------------------


async def run(
    req: V3PageEditRequest,
    *,
    complete: CompleteFn | None = None,
    complete_edit: CompleteFn | None = None,
) -> V3PageEditResponse:
    """两段式编排,整体 <60s,绝不抛(对所有内部失败安全兜底为保守 talk)。

    `complete`(段一意图)/ `complete_edit`(段二写作)默认走真实 DeepSeek,测试里注入覆盖
    (镜像 chapter-chat / group-pages 的 `complete=` 注入)。"""
    started = time.monotonic()
    try:
        return await _run_guarded(req, started, complete=complete, complete_edit=complete_edit)
    except Exception as exc:  # noqa: BLE001 —— 永不崩:任何失败回安全兜底 talk
        log.warning("page_edit.fallback", error=str(exc))
        return _safe_talk(req, started)


async def _run_guarded(
    req: V3PageEditRequest,
    started: float,
    *,
    complete: CompleteFn | None,
    complete_edit: CompleteFn | None,
) -> V3PageEditResponse:
    completion = chapter_completion(req.chapter.chapterId, req.pages)
    page = _focused_page(req)

    async def _work() -> V3PageEditResponse:
        intent, reply = await _route_intent(req, completion, complete=complete)

        if intent == "advance":
            return _respond(req, started, "advance", reply or _default_reply(req.language, "advance"),
                            advance_intent=True)

        if intent == "edit_text":
            if page is None:
                return _respond(req, started, "talk", _default_reply(req.language, "talk"))
            try:
                patch = await _execute_edit_text(req, page, complete_edit=complete_edit)
            except (PageEditError, ai_client.AIRequestError) as exc:
                log.info("page_edit.edit_text_fallback", error=str(exc))
                patch = None
            if patch is None:
                return _respond(req, started, "talk", _default_reply(req.language, "talk"))
            return _respond(req, started, "edit_text",
                            reply or _default_reply(req.language, "edit_text"), patch=patch)

        if intent == "change_layout":
            patch = _execute_change_layout(page) if page is not None else None
            if patch is None:
                # 没有【其它】合法版式可换(该照片数只有当前这一个)→ 明说换不了,不回 no-op。
                return _respond(req, started, "talk", _default_reply(req.language, "change_layout_none"))
            return _respond(req, started, "change_layout",
                            reply or _default_reply(req.language, "change_layout"), patch=patch)

        # talk(含换图引导、filled 时主动问推进、未知意图安全兜底)。
        return _respond(req, started, "talk", reply or _default_reply(req.language, "talk"))

    return await asyncio.wait_for(_work(), timeout=_OVERALL_BUDGET_SECONDS)


# ---------- model call 帮手(对齐 chapter-chat per-call 超时)-----------------


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
        raise PageEditError("DEEPSEEK_API_KEY missing; cannot run page-edit")
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
        raise PageEditError(f"page-edit model call failed: {exc}") from exc


def _parse_json(response: dict[str, Any]) -> dict[str, Any]:
    try:
        parsed = ai_client.parse_json_loose(ai_client.extract_text(response))
    except ValueError as exc:
        raise PageEditError(f"page-edit model response was not valid JSON: {exc}") from exc
    if not isinstance(parsed, dict):
        raise PageEditError(
            f"page-edit model response must be an object, got {type(parsed).__name__}"
        )
    return parsed


# ---------- 响应组装 ---------------------------------------------------------


def _respond(
    req: V3PageEditRequest,
    started: float,
    intent: V3PageEditIntent,
    reply: str,
    *,
    patch: V3LayoutPatchEntry | None = None,
    advance_intent: bool = False,
) -> V3PageEditResponse:
    kwargs: dict[str, Any] = {}
    if patch is not None:
        kwargs["layoutPatch"] = [patch]
    if advance_intent:
        kwargs["advanceIntent"] = True
    return V3PageEditResponse(
        assistantReply=reply[:500],
        intent=intent,
        usage=_usage(started),
        **kwargs,
    )


def _safe_talk(req: V3PageEditRequest, started: float) -> V3PageEditResponse:
    return V3PageEditResponse(
        assistantReply=_default_reply(req.language, "talk"),
        intent="talk",
        usage=_usage(started),
    )


def _usage(started: float) -> V3Usage:
    settings = get_settings()
    return V3Usage(
        durationMs=int((time.monotonic() - started) * 1000),
        models=V3Models(planning=settings.deepseek_model),
    )


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) and value.strip() else ""


def _default_reply(language: str, intent: str) -> str:
    if language == "zh":
        return {
            "edit_text": "这一页我已经按你的想法改好了。",
            "change_layout": "我给这一页换了个排版。",
            "change_layout_none": "这一页按当前照片数暂时没有别的版式可换了。",
            "advance": "好的,我们继续下一章。",
        }.get(intent, "再和我说说这一页的故事吧?")
    return {
        "edit_text": "I rewrote this page the way you asked.",
        "change_layout": "I switched this page to a new layout.",
        "change_layout_none": "There's no alternative layout for this page's current number of photos.",
        "advance": "Great — let's move on to the next chapter.",
    }.get(intent, "Tell me more about the story on this page.")
