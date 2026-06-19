"""V3 apply-theme — deterministic one-click 刷 variableDecor 槽 (含 SVG, §4.3 / §9).

Issue #190 / WP3.2. The endpoint is `POST /v3/apply-theme`
(§8.1: 同步 / 确定性 / 无模型调用); it consumes the
`V3ApplyThemeRequest` DTO (schemas.py ↔ packages/contracts/src/v3.ts — single truth
source, predefined by WP0.1/0.3, NOT modified here).

What apply-theme does (§4.3(b) / §9 `variableDecor`):

  The user has already picked, per chapter, one `{accentColor, artFont}` (§6 第 1 条
  章级粒度: one color + one font per chapter, no per-slot customization). apply-theme
  takes the current flat pages and 一键批量刷 every slot the template marks
  `variableDecor:true` — and ONLY those slots — with that chapter's theme:

    * variableDecor **svg** slots (花饰/分隔线/图标, e.g. mag-13 `divider`): the slot's
      content IS the decoration, so it is set to the chapter `accentColor` (the vector
      is rendered in the accent color). This is the "含 SVG 图层填充" acceptance.
    * variableDecor **decoration** text slots are NOT content carriers for color:
      existing values (`date`/`dateNum`/`folio`) and empty values both stay exactly
      as-is. Styling rides the chapter node in the tree; color strings only travel
      through SVG decoration carriers.
    * variableDecor **title** text slots hold USER prose (the chapter title authored in
      章节故事). apply-theme MUST NOT rewrite that content — its color/font is carried by
      the chapter node in the tree (`V3Chapter.accentColor/artFont`, written by Web) and
      baked into the flat page at finalize (§3 树边界: 渲染契约不新增树形字段, so the
      per-page color does NOT ride the flat Page — it stays in the tree until finalize).

  普通正文槽 (`body`/`explain`, and any slot WITHOUT `variableDecor`) is never touched.

Stateless (§3 数据归属): the Agent holds no draft/stage. It returns a page-level
`layoutPatch` (§3 树边界: still 页级, no tree-shaped field added to the render
contract). Web persists — it writes the per-chapter `accentColor/artFont` into the
tree's `V3Chapter` nodes AND merges this patch into the pages, then advances
`stage` story→… No model call, no base64, no network (pure structural transform).

Page→chapter mapping (§8.3 layout 树流转: "③④传相关页"): pages carry no chapterId in
the flat render contract, so a request with pages and several chapter choices is
ambiguous and is rejected. Web must call apply-theme one chapter at a time (single
chapter choice + that chapter's pages), or otherwise provide only one chapter choice.
"""

from __future__ import annotations

import time
from collections.abc import Mapping, Sequence

from .. import templates
from ..logging_config import get_logger
from ..schemas import (
    THEME_USER_PROSE_ROLES,
    Page,
    V3ApplyThemeRequest,
    V3ApplyThemeResponse,
    V3ChapterThemeChoice,
    V3LayoutPatchEntry,
    V3Models,
    V3Usage,
)

log = get_logger("apply_theme_v3")


class ApplyThemeV3Error(Exception):
    """Raised when apply-theme cannot produce a valid patch (e.g. an empty plan).

    The route maps this to an HTTP error code (§8.3 同步端点走 HTTP 错误码); the front
    end may retry without polluting stage."""


# Text-slot roles whose CONTENT is user prose — apply-theme never overwrites these
# (their styling rides the tree's chapter accent/font, baked at finalize). `title`
# variableDecor slots are recolored via the tree, NOT via a content rewrite here.
# 约定是 `packages/contracts` 单一真相源(theme-carrier.ts ↔ schemas.py);此处 import
# 共享定义,消除与 finalize_v3 的重复(行为不变)。
_USER_PROSE_ROLES = THEME_USER_PROSE_ROLES


def _resolve_page_chapter(
    chapters: Sequence[V3ChapterThemeChoice],
) -> V3ChapterThemeChoice:
    """The chapter theme applied to the given pages.

    Canonical §8.3 flow = one chapter's pages per call, so the first (and only)
    chapter choice governs every page. Ambiguous multi-choice page requests are
    rejected by `apply_theme` before this helper is called. `chapters` is `min(1)`,
    so this never indexes empty."""
    return chapters[0]


def _decor_value_for_text_slot(slot: Mapping[str, object], existing: str | None) -> str | None:
    """Themed value for one variableDecor TEXT slot, or None to leave it untouched.

    * `title`/`body`/`explain` (user prose) → None: content is never rewritten; the
      color/font lives on the chapter node in the tree (baked at finalize).
    * `decoration` text slots → existing or empty content is never rewritten with a
      color string. SVG variableDecor slots are the only flat-page accent carriers.

    Never returns a place/location value or a color token, so §3 隐私 (no place) and
    text-content preservation both hold by construction."""
    role = str(slot.get("role") or "")
    if role in _USER_PROSE_ROLES:
        return None
    return existing if existing is not None else None


def _apply_page(page: Page, choice: V3ChapterThemeChoice) -> V3LayoutPatchEntry | None:
    """One page's variableDecor patch, or None when the page has NO themable slot.

    Reads the page's template to find which slots are `variableDecor:true`, brushes
    the svg slots + eligible decoration text slots with the chapter accent color, and
    leaves everything else (user prose, non-variableDecor slots) exactly as-is.

    Returns a `V3LayoutPatchEntry` carrying the merged `texts` whenever the page has
    AT LEAST ONE variableDecor slot — even if this application changed nothing (the
    slot was already brushed). That makes apply-theme idempotent: re-applying the same
    theme re-emits the identical `texts` rather than dropping the page. A page whose
    template has no variableDecor slot at all returns None (it is not themable)."""
    template = templates.get(page.templateId)
    if template is None:
        # Unknown template: nothing to brush (apply-theme never hard-fails a page).
        return None

    texts = dict(page.texts)
    themable = False

    # variableDecor SVG slots (花饰/分隔线): content IS the decoration → accent color.
    for svg in template.get("svgs") or []:
        if not svg.get("variableDecor"):
            continue
        slot_id = svg.get("id")
        if not slot_id:
            continue
        themable = True
        texts[slot_id] = choice.accentColor

    # variableDecor TEXT slots are never color carriers; user prose and decoration
    # text values are preserved (styling rides the tree).
    for slot in templates.text_slots(template):
        if not slot.get("variableDecor"):
            continue
        slot_id = slot.get("id")
        if not slot_id:
            continue
        themable = True
        value = _decor_value_for_text_slot(slot, texts.get(slot_id))
        if value is not None:
            texts[slot_id] = value

    if not themable:
        return None
    return V3LayoutPatchEntry(pageIndex=page.pageIndex, texts=texts)


def apply_theme(req: V3ApplyThemeRequest) -> V3ApplyThemeResponse:
    """Deterministically brush every variableDecor slot of the given pages (§4.3/§9).

    Pure function (no LLM/network/DB/base64). The chapter's `{accentColor, artFont}`
    paint the page's svg + decoration variableDecor slots; user prose and
    non-variableDecor slots are untouched (普通正文不碰). The chapter color/font
    themselves are written to the TREE by Web (§3 树边界) — this returns a page-level
    `layoutPatch` only.

    Raises `ApplyThemeV3Error` when no page carried a themable slot, so the
    `layoutPatch` (contract `min(1)`) is always non-empty on success."""
    started = time.monotonic()
    if len(req.chapters) > 1 and req.pages:
        raise ApplyThemeV3Error(
            "ambiguous multi-chapter apply-theme request: pages carry no chapterId; "
            "send one chapter choice with that chapter's pages"
        )
    choice = _resolve_page_chapter(req.chapters)

    patches: list[V3LayoutPatchEntry] = []
    for page in req.pages:
        entry = _apply_page(page, choice)
        if entry is not None:
            patches.append(entry)

    if not patches:
        # Every page is either an unknown template or carries no variableDecor slot,
        # so there is nothing to brush. The contract requires layoutPatch.min(1); a
        # no-op apply is a caller bug (recommend always produced per-chapter colors).
        raise ApplyThemeV3Error("no variableDecor slot to apply theme to")

    duration_ms = int((time.monotonic() - started) * 1000)
    log.info(
        "apply_theme_v3.done",
        album_id=req.albumId,
        pages=len(req.pages),
        patched=len(patches),
        font=choice.artFont,
    )
    return V3ApplyThemeResponse(
        layoutPatch=patches,
        usage=V3Usage(durationMs=duration_ms, models=V3Models()),
    )
