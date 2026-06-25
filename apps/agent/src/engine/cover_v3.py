"""V3 cover/ending —— Stage5 async orchestration for optional 封面/封尾 pages.

Issue #192 / WP4.1。V3 引擎里没有「page0 必须是 cover」这条约束:
`finalize_v3.validate_v3` 没有 page0-cover 规则,`skeleton_v3.build_skeleton_v3`
只建正文页、cover 作为可选追加项。本模块只负责追加可选的 cover/ending 页。

端点是 `POST /v3/cover`(§8.1 / 4.4:Web 同步等待 / 可选)。它消费
`V3CoverRequest` DTO(schemas.py ↔ packages/contracts/src/v3.ts —— 单一真相源,
由 WP0.1/0.3 预定义,此处不改)。

cover 做什么(§4.4(a)(b)「选封面/封尾系统模板 → 自动填充成稿;封面可跳过」):

  用户(可选地)挑了一个 封面 系统模板(category=cover)和/或一个
  封尾 系统模板(category=ending)。浏览器发来 相关页 —— 为 cover 和 ending
  预留的页 slot —— 加上这些模板 id。cover-v3:

    * 对每个所选模板,校验它是一个 KNOWN 模板且其 V3 `category` 匹配
      (cover / ending)。未知 id 或 category 不符时抛
      `CoverV3Error`(路由把它映射成 HTTP 错误;§8.3 同步端点走 HTTP 错误码)。
    * 确定性地把页自动填充成成稿(§4.4(b)):cover/ending 模板通常只有 ONE
      hero 图片 slot —— 我们把页的第一张可用照片塞进去(确定性 assign,无
      quality/hero/orientation 匹配,与 `skeleton_v3.assign_images_v3` 一致;比例不符
      是 renderer 的 center-cover 关切)。通用装饰文字(`folio` 页码、`date`
      来自照片 code-filled 的 takenAt)按 generic_copy 给正文页的同样方式 code-fill。
      Stage5 5a 可写 authored cover 文案,但必须经 public writing slot specs +
      clean_texts 清洗;地点/位置值保持空。
    * 对每个设计好的页返回一个 `V3LayoutPatchEntry`(templateId + images +
      texts),挂在页原有的 `pageIndex` 上(§3 树边界:仍是 页级,不加树形
      render 字段)。

  **可跳过 (§4.4 「跳过=空」)**:当 coverTemplateId 和 endingTemplateId BOTH
  缺失(null/省略)时,用户不要 cover/ending —— 我们返回 EMPTY patch 且
  不抛错。空 patch 是合法的成功。

无状态(§3 数据归属):Agent 不持 draft/stage。它只返回页级
`layoutPatch`;Web 负责持久化 patch + 推进 `stage` cover→ready(stage 推进权
在 Web)。base64 thumbnail 只允许进入本地 accent extraction seam,绝不进入
5a copy 或 5b color prompt payload。

cover/ending 页选取(§8.3「③④传相关页」):扁平 render 契约里页不带 chapterId/role,
所以规范流程 = Web 恰好把它为 cover(第一页)和 ending(最后一页)预留的页 slot
发来。我们把 cover 设计到 FIRST 给定页、把 ending 设计到 LAST 给定页 —— 当只选了一个模板
且只给了一页时,该页采用所选设计。我们绝不凭空造页;选了模板却没有落地页
是调用方错误,与显式跳过有别。
"""

from __future__ import annotations

import inspect
import json
import time
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import Any

from . import templates
from .accent_color import accent_from_photo
from .apply_theme_v3 import apply_page
from .finalize_color import finalize_color
from ..agents.writing.handler import clean_texts, page_slot_specs
from .. import ai_client
from ..logging_config import get_logger
from ..schemas import (
    Page,
    THEME_ACCENT_CARRIER_SUFFIX,
    THEME_FONT_CARRIER_SUFFIX,
    THEME_USER_PROSE_ROLES,
    V3CoverRequest,
    V3CoverResponse,
    V3LayoutPatchEntry,
    V3Models,
    V3Usage,
)
from ..settings import get_settings
from . import generic_copy
from . import skeleton_v3

log = get_logger("cover_v3")

MAX_COVER_CLARIFY_ROUNDS = 2
# Current cover request contracts do not carry an artFont source. Cover pages also
# lack chapter ownership, so use a closed-set safe default for text font carriers.
_DEFAULT_ART_FONT = "serif-classic"
_NEUTRAL_ACCENT = "#8A8174"


@dataclass(frozen=True)
class CoverCopyPayload:
    """Text-only payload for the 5a copy seam.

    The request base64 fields are intentionally absent. Tests assert this boundary.
    """

    language: str
    coverTemplateId: str | None
    endingTemplateId: str | None
    coverPhotoDesc: str | None
    hint: str | None
    userMessage: str
    history: list[dict[str, str]]
    pageSlotSpecs: dict[str, list[dict[str, Any]]]
    clarifyRounds: int


@dataclass(frozen=True)
class CoverCopyResult:
    needs_user_input: bool = False
    assistant_reply: str | None = None
    cover_texts: Mapping[str, Any] = field(default_factory=dict)
    ending_texts: Mapping[str, Any] = field(default_factory=dict)
    usage: V3Usage | None = None


@dataclass(frozen=True)
class CoverColorPayload:
    """Text/extracted-hex-only payload for 5b color design."""

    language: str
    extractedAccent: str
    coverPhotoDesc: str | None
    hint: str | None
    userMessage: str
    history: list[dict[str, str]]
    coverTexts: dict[str, str]
    endingTexts: dict[str, str]


@dataclass(frozen=True)
class CoverColorResult:
    color: str | None = None
    usage: V3Usage | None = None


CoverCopyFn = Callable[[CoverCopyPayload], Awaitable[CoverCopyResult] | CoverCopyResult]
CoverColorDesignFn = Callable[
    [CoverColorPayload],
    Awaitable[str | None | CoverColorResult] | str | None | CoverColorResult,
]
AccentFromPhotoFn = Callable[[Any], str]
FinalizeColorFn = Callable[[str], str]


class CoverV3Error(Exception):
    """所选 cover/ending 模板无法渲染时抛。

    路由把它映射成 HTTP 错误码(§8.3 同步端点走 HTTP 错误码);前端可重试而不污染 stage。
    注意:*跳过*(没选模板)NOT 是错误 —— 它返回一个空 patch。"""


def _require_category(template_id: str, expected: str) -> templates.TemplateDef:
    """`template_id` 对应的已知模板,且断言它是期望的 V3 category。

    当 id 未知或其 category 不匹配(`cover` vs `ending`)时抛 `CoverV3Error` ——
    把 interior 模板当 cover 选是调用方 bug,不是可渲染的 spread。"""
    template = templates.get(template_id)
    if template is None:
        raise CoverV3Error(f"unknown {expected} template id: {template_id!r}")
    actual = skeleton_v3.template_category(template)
    if actual != expected:
        raise CoverV3Error(
            f"template {template_id!r} is category={actual!r}, not {expected!r}"
        )
    return template


def _photo_ids(page: Page) -> list[str]:
    """页上已放置的照片 id,按 slot 声明顺序。

    cover/ending 自动填充复用页自己的照片(Web 发来的 相关页 携带 hero 候选);
    我们绝不到给定页之外去取图。"""
    return list(page.images.values())


def _design_page(
    page: Page,
    template: templates.TemplateDef,
    template_id: str,
    *,
    authored_texts: Mapping[str, Any] | None = None,
    accent_color: str | None = None,
    art_font: str | None = None,
) -> V3LayoutPatchEntry:
    """把 `page` 在 `template` 上自动填充成成稿 cover/ending spread(§4.4(b))。

    确定性,与 V3 正文路径一致:
      ① 把页已有照片按声明顺序塞进模板的 image slot
         (`skeleton_v3.assign_images_v3`)—— 截到模板容量(cover 通常只有 ONE
         hero;多出的照片被丢弃,绝不复用/编造);
      ② 按 generic_copy 给正文页的同样方式 code-fill 通用装饰(`folio`/`date`);
         用户正文 slot(title/body/explain)保持 EMPTY(§4.1 不生成正式文案;
         §3 隐私:绝不写地点值)。

    返回一个携带 templateId + images + texts 的 `V3LayoutPatchEntry`,挂在页自己的
    `pageIndex` 上(§3 树边界:页级)。"""
    capacity = skeleton_v3.image_capacity(template)
    photos = _photo_ids(page)[:capacity]
    images = skeleton_v3.assign_images_v3(template_id, photos)

    # 通用装饰(folio/date)走正文页用的 SAME 确定性 helper。
    # 页最早照片的 takenAt 驱动 date;缺失 → 无 date(不编造日期)。
    # 用户正文 slot 由 fill_page_generic_copy 按构造留空。
    page_dict: dict[str, Any] = {
        "pageIndex": page.pageIndex,
        "templateId": template_id,
        "images": images,
        "texts": {},
    }
    page_date = _earliest_taken_at_for_page(images, page)
    texts = generic_copy.fill_page_generic_copy(page_dict, page_date)
    planned_page = Page(
        pageIndex=page.pageIndex,
        templateId=template_id,
        images=images,
        texts=texts,
        imagePos=page.imagePos,
    )

    if authored_texts:
        texts.update(_clean_authored_texts(planned_page, authored_texts))
        planned_page = planned_page.model_copy(update={"texts": texts})

    if accent_color:
        texts = _apply_cover_page_theme(
            planned_page,
            template,
            accent_color=accent_color,
            art_font=art_font,
        )

    return V3LayoutPatchEntry(
        pageIndex=page.pageIndex,
        templateId=template_id,
        images=images,
        texts=texts,
    )


def _earliest_taken_at_for_page(
    images: Mapping[str, str], page: Page
) -> str | None:
    """cover/ending 页的 date 来源。

    扁平 cover 请求不带逐照片 takenAt(树不发到这个端点 —— §8.3 只有 finalize 拿到
    整棵树),所以这里没有 EXIF 可推导 date。我们返回 None:`date` 装饰直接留空
    而非编造(§4.1 / §3)。保留为一处 seam,让未来带 takenAt 的 cover 请求
    能点亮 date 而不动填充逻辑。"""
    return None


def _clean_authored_texts(
    page: Page, raw_texts: Mapping[str, Any]
) -> dict[str, str]:
    specs = page_slot_specs(page)
    cleaned = clean_texts(dict(raw_texts), specs)
    return {
        key: value
        for key, value in cleaned.items()
        if not _is_location_text_slot(key)
    }


def _is_location_text_slot(slot_id: str) -> bool:
    lowered = slot_id.lower()
    return lowered in {"location", "place", "gps"} or lowered.endswith(".location")


def _apply_cover_page_theme(
    page: Page,
    template: templates.TemplateDef,
    *,
    accent_color: str,
    art_font: str | None,
) -> dict[str, str]:
    texts = dict(page.texts)

    if _has_variable_svg(template):
        try:
            themed = apply_page(
                page.model_copy(update={"texts": texts}),
                SimpleNamespace(
                    chapterId="cover",
                    subject=_first_title_text(texts, template),
                    accentColor=accent_color,
                    artFont=art_font,
                ),
            )
            if themed is not None and themed.texts is not None:
                texts = dict(themed.texts)
        except Exception:
            # Theme application is best-effort here; page-level carriers below are
            # the durable cover/ending styling path because these pages lack chapters.
            texts = dict(page.texts)

    _remove_empty_authored_slots_added_by_theme(texts, template)
    _add_page_level_text_theme_carriers(texts, template, accent_color, art_font)
    return texts


def _has_variable_svg(template: templates.TemplateDef) -> bool:
    return any(svg.get("variableDecor") for svg in (template.get("svgs") or []))


def _first_title_text(
    texts: Mapping[str, str], template: templates.TemplateDef
) -> str:
    for slot in templates.text_slots(template):
        if slot.get("role") == "title":
            value = texts.get(str(slot.get("id")))
            if value:
                return value
    return ""


def _remove_empty_authored_slots_added_by_theme(
    texts: dict[str, str], template: templates.TemplateDef
) -> None:
    for slot in templates.text_slots(template):
        slot_id = str(slot.get("id") or "")
        if not slot_id:
            continue
        if slot.get("role") in THEME_USER_PROSE_ROLES and texts.get(slot_id) == "":
            texts.pop(slot_id, None)


def _add_page_level_text_theme_carriers(
    texts: dict[str, str],
    template: templates.TemplateDef,
    accent_color: str,
    art_font: str | None,
) -> None:
    for slot in templates.text_slots(template):
        if not slot.get("variableDecor"):
            continue
        slot_id = str(slot.get("id") or "")
        if not slot_id:
            continue
        texts[f"{slot_id}{THEME_ACCENT_CARRIER_SUFFIX}"] = accent_color
        if art_font:
            texts[f"{slot_id}{THEME_FONT_CARRIER_SUFFIX}"] = art_font


async def build_cover(
    req: V3CoverRequest,
    *,
    copy_fn: CoverCopyFn | None = None,
    color_design_fn: CoverColorDesignFn | None = None,
    accent_from_photo_fn: AccentFromPhotoFn = accent_from_photo,
    finalize_color_fn: FinalizeColorFn = finalize_color,
) -> V3CoverResponse:
    """设计可选的 封面/封尾 页,并执行 Stage5 cover orchestration。

    行为:
      * 跳过(两个 template id 都缺失)→ 空 patch,不报错(§4.4 跳过=空)。
      * 选了 cover → 设计到 FIRST 给定页。
      * 选了 ending → 设计到 LAST 给定页。
      * 两个都选且页数 ≥2 → cover 在第一页、ending 在最后一页(不同页)。
      * 任何选了模板却没有落地页的情况都抛 CoverV3Error;不可与跳过混淆。
      * 5a/5b prompt seams are text-only; coverPhoto base64 is only read by
        the local accent extraction seam.

    在模板无效或缺落地页时抛 `CoverV3Error`。"""
    started = time.monotonic()

    cover_id = req.coverTemplateId
    ending_id = req.endingTemplateId

    if not cover_id and not ending_id:
        # §4.4 「跳过=空」:用户不要 cover/ending。空 patch,NOT 错误。
        log.info("cover_v3.skipped", album_id=req.albumId, pages=len(req.pages))
        return V3CoverResponse(
            layoutPatch=[],
            usage=V3Usage(
                durationMs=int((time.monotonic() - started) * 1000),
                models=V3Models(),
            ),
        )

    # 先校验所选模板(设计任何页之前 fail fast)。
    cover_template = _require_category(cover_id, "cover") if cover_id else None
    ending_template = _require_category(ending_id, "ending") if ending_id else None

    pages = list(req.pages)
    if not pages:
        raise CoverV3Error("chosen cover/ending template has no landing page")
    if (
        cover_template is not None
        and ending_template is not None
        and pages[0].pageIndex == pages[-1].pageIndex
    ):
        raise CoverV3Error(
            "cover and ending templates require distinct landing pages"
        )

    copy_payload = _build_copy_payload(
        req,
        pages,
        cover_template_id=cover_id,
        ending_template_id=ending_id,
    )
    try:
        copy_result = await _run_copy(copy_payload, copy_fn=copy_fn)
    except Exception as exc:
        log.warning(
            "cover_v3.copy_failed",
            album_id=req.albumId,
            error=type(exc).__name__,
        )
        return _needs_input_response(started, req.language)

    if not isinstance(copy_result, CoverCopyResult):
        log.warning(
            "cover_v3.copy_invalid",
            album_id=req.albumId,
            result_type=type(copy_result).__name__,
        )
        return _needs_input_response(started, req.language)

    clarify_rounds = _clarify_rounds(req.history)
    if copy_result.needs_user_input:
        if clarify_rounds < MAX_COVER_CLARIFY_ROUNDS:
            return _needs_input_response(
                started,
                req.language,
                reply=copy_result.assistant_reply,
                usage=copy_result.usage,
            )
        copy_result = CoverCopyResult(usage=copy_result.usage)

    extracted_accent = _extract_cover_accent(req, accent_from_photo_fn)
    color_payload = CoverColorPayload(
        language=req.language,
        extractedAccent=extracted_accent,
        coverPhotoDesc=req.coverPhotoDesc,
        hint=req.hint,
        userMessage=req.userMessage,
        history=_history_dicts(req.history),
        coverTexts=_string_texts(copy_result.cover_texts),
        endingTexts=_string_texts(copy_result.ending_texts),
    )
    try:
        color_result = await _run_color_design(
            color_payload,
            color_design_fn=color_design_fn,
        )
    except Exception as exc:
        log.warning(
            "cover_v3.color_failed",
            album_id=req.albumId,
            error=type(exc).__name__,
        )
        color_result = CoverColorResult(color=_NEUTRAL_ACCENT)
    final_accent = _finalize_cover_color(color_result.color, finalize_color_fn)

    patches: list[V3LayoutPatchEntry] = []
    used_indices: set[int] = set()

    if cover_template is not None and pages:
        first = pages[0]
        patches.append(
            _design_page(
                first,
                cover_template,
                cover_id,  # type: ignore[arg-type]
                authored_texts=copy_result.cover_texts,
                accent_color=final_accent,
                art_font=_DEFAULT_ART_FONT,
            )
        )
        used_indices.add(0)

    if ending_template is not None and pages:
        # 把 ending 落到 LAST 页;如果那一页已被 cover 占用(只给了一页),
        # 就没有独立的 ending slot —— 跳过,而非覆盖 cover 或凭空造页。
        last_pos = len(pages) - 1
        if last_pos not in used_indices:
            patches.append(
                _design_page(
                    pages[last_pos],
                    ending_template,
                    ending_id,  # type: ignore[arg-type]
                    authored_texts=copy_result.ending_texts,
                    accent_color=final_accent,
                    art_font=_DEFAULT_ART_FONT,
                )
            )
            used_indices.add(last_pos)

    duration_ms = int((time.monotonic() - started) * 1000)
    log.info(
        "cover_v3.done",
        album_id=req.albumId,
        pages=len(pages),
        cover=bool(cover_id),
        ending=bool(ending_id),
        patched=len(patches),
    )
    return V3CoverResponse(
        layoutPatch=patches,
        usage=_merge_usage(duration_ms, copy_result.usage, color_result.usage),
    )


def _build_copy_payload(
    req: V3CoverRequest,
    pages: list[Page],
    *,
    cover_template_id: str | None,
    ending_template_id: str | None,
) -> CoverCopyPayload:
    page_specs: dict[str, list[dict[str, Any]]] = {}
    if cover_template_id:
        page_specs["cover"] = page_slot_specs(
            _page_as_template(pages[0], cover_template_id)
        )
    if ending_template_id:
        page_specs["ending"] = page_slot_specs(
            _page_as_template(pages[-1], ending_template_id)
        )
    return CoverCopyPayload(
        language=req.language,
        coverTemplateId=cover_template_id,
        endingTemplateId=ending_template_id,
        coverPhotoDesc=req.coverPhotoDesc,
        hint=req.hint,
        userMessage=req.userMessage,
        history=_history_dicts(req.history),
        pageSlotSpecs=page_specs,
        clarifyRounds=_clarify_rounds(req.history),
    )


def _page_as_template(page: Page, template_id: str) -> Page:
    template = templates.get(template_id)
    if template is None:
        return page.model_copy(update={"templateId": template_id})
    capacity = skeleton_v3.image_capacity(template)
    images = skeleton_v3.assign_images_v3(template_id, _photo_ids(page)[:capacity])
    return Page(
        pageIndex=page.pageIndex,
        templateId=template_id,
        images=images,
        texts={},
        imagePos=page.imagePos,
    )


async def _run_copy(
    payload: CoverCopyPayload,
    *,
    copy_fn: CoverCopyFn | None,
) -> CoverCopyResult:
    fn = copy_fn or _default_copy
    return await _maybe_await(fn(payload))


async def _default_copy(payload: CoverCopyPayload) -> CoverCopyResult:
    response, usage = await _complete_deepseek(
        _copy_messages(payload),
        max_tokens=1200,
        temperature=0.35,
    )
    parsed = _parse_model_json(response, "cover copy")
    needs_input = parsed.get("needsUserInput") is True
    return CoverCopyResult(
        needs_user_input=needs_input,
        assistant_reply=_text(parsed.get("assistantReply")),
        cover_texts=_mapping_texts(parsed.get("coverTexts")),
        ending_texts=_mapping_texts(parsed.get("endingTexts")),
        usage=usage,
    )


async def _run_color_design(
    payload: CoverColorPayload,
    *,
    color_design_fn: CoverColorDesignFn | None,
) -> CoverColorResult:
    fn = color_design_fn or _default_color_design
    result = await _maybe_await(fn(payload))
    if isinstance(result, CoverColorResult):
        return result
    return CoverColorResult(color=result if isinstance(result, str) else None)


async def _default_color_design(payload: CoverColorPayload) -> CoverColorResult:
    response, usage = await _complete_deepseek(
        _color_messages(payload),
        max_tokens=300,
        temperature=0.25,
    )
    parsed = _parse_model_json(response, "cover color")
    color = (
        _text(parsed.get("accentColor"))
        or _text(parsed.get("designedColor"))
        or _text(parsed.get("color"))
        or payload.extractedAccent
    )
    return CoverColorResult(color=color, usage=usage)


def _copy_messages(payload: CoverCopyPayload) -> list[dict[str, str]]:
    system = (
        "You write short memoir cover and ending page copy. Return STRICT JSON only. "
        "Schema: {\"needsUserInput\": boolean, \"assistantReply\": string, "
        "\"coverTexts\": object, \"endingTexts\": object}. "
        "If the text context is insufficient, set needsUserInput=true and ask one "
        "brief clarification in assistantReply; leave text objects empty. "
        "If sufficient, set needsUserInput=false and fill only slot ids present in "
        "pageSlotSpecs, respecting each maxChars. Never write locations or places."
    )
    user_payload = {
        "language": payload.language,
        "coverTemplateId": payload.coverTemplateId,
        "endingTemplateId": payload.endingTemplateId,
        "coverPhotoDesc": payload.coverPhotoDesc or "",
        "hint": payload.hint or "",
        "userMessage": payload.userMessage or "",
        "history": payload.history,
        "pageSlotSpecs": payload.pageSlotSpecs,
        "templates": _template_prompt_specs(
            payload.coverTemplateId,
            payload.endingTemplateId,
        ),
        "clarifyRounds": payload.clarifyRounds,
        "maxClarifyRounds": MAX_COVER_CLARIFY_ROUNDS,
    }
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)},
    ]


def _template_prompt_specs(*template_ids: str | None) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for template_id in template_ids:
        if not template_id or template_id in out:
            continue
        template = templates.get(template_id)
        if template is None:
            continue
        out[template_id] = {
            "category": skeleton_v3.template_category(template),
            "imageSlots": [dict(slot) for slot in (template.get("images") or [])],
            "textSlots": [dict(slot) for slot in templates.text_slots(template)],
        }
    return out


def _color_messages(payload: CoverColorPayload) -> list[dict[str, str]]:
    system = (
        "You choose one final design accent color for a memoir cover. "
        "Return STRICT JSON only: {\"accentColor\":\"#RRGGBB\"}. "
        "Use the extractedAccent as grounding, adjust only if the text context "
        "suggests a better tasteful editorial color. Do not request more input."
    )
    user_payload = {
        "language": payload.language,
        "extractedAccent": payload.extractedAccent,
        "coverPhotoDesc": payload.coverPhotoDesc or "",
        "hint": payload.hint or "",
        "userMessage": payload.userMessage or "",
        "history": payload.history,
        "coverTexts": payload.coverTexts,
        "endingTexts": payload.endingTexts,
    }
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)},
    ]


async def _complete_deepseek(
    messages: list[dict[str, str]],
    *,
    max_tokens: int,
    temperature: float,
) -> tuple[dict[str, Any], V3Usage]:
    settings = get_settings()
    if not settings.deepseek_api_key:
        raise CoverV3Error("DEEPSEEK_API_KEY missing; cannot run cover orchestration")
    started = time.monotonic()
    response = await ai_client.chat_completion(
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
            {"thinking": {"type": "disabled"}}
            if settings.deepseek_disable_thinking
            else None
        ),
    )
    duration_ms = int((time.monotonic() - started) * 1000)
    return response, _usage_from_response(response, duration_ms, settings.deepseek_model)


def _parse_model_json(response: dict[str, Any], label: str) -> dict[str, Any]:
    try:
        parsed = ai_client.parse_json_loose(ai_client.extract_text(response))
    except ValueError as exc:
        raise CoverV3Error(f"{label} model response was not valid JSON: {exc}") from exc
    if not isinstance(parsed, dict):
        raise CoverV3Error(
            f"{label} model response must be an object, got {type(parsed).__name__}"
        )
    return parsed


def _usage_from_response(response: dict[str, Any], duration_ms: int, model: str) -> V3Usage:
    prompt_tokens, completion_tokens = ai_client.extract_usage(response)
    return V3Usage(
        durationMs=duration_ms,
        planningInputTokens=prompt_tokens,
        planningOutputTokens=completion_tokens,
        models=V3Models(planning=model),
    )


def _mapping_texts(raw: Any) -> dict[str, Any]:
    return dict(raw) if isinstance(raw, Mapping) else {}


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) and value.strip() else ""


async def _maybe_await(value: Awaitable[Any] | Any) -> Any:
    if inspect.isawaitable(value):
        return await value
    return value


def _extract_cover_accent(
    req: V3CoverRequest, accent_from_photo_fn: AccentFromPhotoFn
) -> str:
    photo = req.coverPhoto or req.endingPhoto
    if not photo:
        return _NEUTRAL_ACCENT
    try:
        return accent_from_photo_fn(photo)
    except Exception:
        return _NEUTRAL_ACCENT


def _finalize_cover_color(
    designed_color: str | None, finalize_color_fn: FinalizeColorFn
) -> str:
    try:
        return finalize_color_fn(designed_color or _NEUTRAL_ACCENT)
    except Exception:
        return finalize_color(_NEUTRAL_ACCENT)


def _needs_input_response(
    started: float,
    language: str,
    *,
    reply: str | None = None,
    usage: V3Usage | None = None,
) -> V3CoverResponse:
    return V3CoverResponse(
        layoutPatch=[],
        assistantReply=(reply or _default_clarification_reply(language))[:500],
        needsUserInput=True,
        usage=_merge_usage(int((time.monotonic() - started) * 1000), usage),
    )


def _merge_usage(duration_ms: int, *usages: V3Usage | None) -> V3Usage:
    present = [usage for usage in usages if usage is not None]
    if not present:
        return V3Usage(durationMs=duration_ms, models=V3Models())
    planning_model = next(
        (usage.models.planning for usage in present if usage.models.planning),
        None,
    )
    vision_model = next(
        (usage.models.vision for usage in present if usage.models.vision),
        None,
    )
    summed_duration = sum(usage.durationMs for usage in present)
    return V3Usage(
        durationMs=max(duration_ms, summed_duration),
        visionCallCount=sum(usage.visionCallCount for usage in present),
        planningInputTokens=sum(usage.planningInputTokens for usage in present),
        planningOutputTokens=sum(usage.planningOutputTokens for usage in present),
        repairAttempts=sum(usage.repairAttempts for usage in present),
        models=V3Models(
            **{
                key: value
                for key, value in {
                    "planning": planning_model,
                    "vision": vision_model,
                }.items()
                if value
            }
        ),
    )


def _default_clarification_reply(language: str) -> str:
    if language == "zh":
        return "我还需要一句封面标题、氛围词，或你想突出的人和时刻。"
    return "What title, mood, or moment should I emphasize on the cover?"


def _clarify_rounds(history: Sequence[Any]) -> int:
    rounds = 0
    for turn in history:
        role = _turn_value(turn, "role")
        content = _turn_value(turn, "content")
        if role == "assistant" and isinstance(content, str) and content.strip():
            rounds += 1
    return rounds


def _history_dicts(history: Sequence[Any]) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for turn in history:
        role = _turn_value(turn, "role")
        content = _turn_value(turn, "content")
        if isinstance(role, str) and isinstance(content, str):
            out.append({"role": role, "content": content})
    return out


def _turn_value(turn: Any, key: str) -> Any:
    if isinstance(turn, Mapping):
        return turn.get(key)
    return getattr(turn, key, None)


def _string_texts(raw: Mapping[str, Any]) -> dict[str, str]:
    return {
        key: value.strip()
        for key, value in raw.items()
        if isinstance(key, str) and isinstance(value, str) and value.strip()
    }
