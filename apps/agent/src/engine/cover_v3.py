"""V3 cover/ending — deterministic auto-fill of the optional 封面/封尾 pages (§4.4).

Issue #192 / WP4.1. The "page0-must-cover" constraint is absent from the V3 engine:
`finalize_v3.validate_v3` has no page0-cover rule, and `skeleton_v3.build_skeleton_v3`
builds body-only pages with cover as an optional add. This module only adds the
optional cover/ending pages.

The endpoint is `POST /v3/cover` (§8.1 / 4.4: 同步 / 确定性 / 可选). It consumes the
`V3CoverRequest` DTO (schemas.py ↔ packages/contracts/src/v3.ts — single truth source,
predefined by WP0.1/0.3, NOT modified here).

What cover does (§4.4(a)(b) "选封面/封尾系统模板 → 自动填充成稿;封面可跳过"):

  The user has (optionally) picked a 封面 system template (category=cover) and/or a
  封尾 system template (category=ending). The browser sends the 相关页 — the page
  slot(s) reserved for the cover and ending — plus those template ids. cover-v3:

    * For each chosen template, validates it is a KNOWN template whose V3 `category`
      matches (cover / ending). An unknown id or a category mismatch raises
      `CoverV3Error` (the route maps it to an HTTP error; §8.3 同步端点走 HTTP 错误码).
    * Deterministically AUTO-FILLS the page into a finished spread (§4.4(b)): the
      cover/ending template typically holds ONE hero image slot — we slot the page's
      first available photo into it (确定性 assign, no quality/hero/orientation match,
      mirroring `skeleton_v3.assign_images_v3`; aspect mismatch is the renderer's
      center-cover concern). Generic decoration text (`folio` page number, `date`
      from the photo's code-filled takenAt) is code-filled the same way generic_copy
      does for body pages — user-prose slots (title/body/explain) stay EMPTY (no
      invented copy; §4.1 不生成正式文案 / §3 隐私: never a place/location value).
    * Returns one `V3LayoutPatchEntry` per designed page (templateId + images +
      texts), at the page's existing `pageIndex` (§3 树边界: still 页级, no tree-shaped
      render field).

  **可跳过 (§4.4 「跳过=空」)**: when BOTH coverTemplateId and endingTemplateId are
  absent (null/omitted), the user wants no cover/ending — we return an EMPTY patch and
  do NOT raise. Empty patch is a valid success.

Stateless (§3 数据归属): the Agent holds no draft/stage. It returns a page-level
`layoutPatch` only; Web persists the patch + advances `stage` cover→ready (stage 推进权
在 Web). No model call, no base64, no network (pure structural transform).

Cover/ending page selection (§8.3 "③④传相关页"): pages carry no chapterId/role in the
flat render contract, so the canonical flow is Web sending exactly the page slot(s) it
reserved for the cover (first) and ending (last). We design the cover onto the FIRST
given page and the ending onto the LAST given page — when only one template is chosen
and one page is given, that page takes the chosen design. We never invent pages; a
chosen template with no landing page is a caller error, distinct from an explicit skip.
"""

from __future__ import annotations

import time
from collections.abc import Mapping, Sequence
from typing import Any

from . import templates
from ..logging_config import get_logger
from ..schemas import (
    Page,
    V3CoverRequest,
    V3CoverResponse,
    V3LayoutPatchEntry,
    V3Models,
    V3Usage,
)
from . import generic_copy
from . import skeleton_v3

log = get_logger("cover_v3")


class CoverV3Error(Exception):
    """Raised when a chosen cover/ending template cannot be rendered.

    The route maps this to an HTTP error code (§8.3 同步端点走 HTTP 错误码); the front
    end may retry without polluting stage. NOTE: a *skip* (no template chosen) is NOT
    an error — it returns an empty patch."""


def _require_category(template_id: str, expected: str) -> templates.TemplateDef:
    """The known template for `template_id`, asserted to be the expected V3 category.

    Raises `CoverV3Error` when the id is unknown or its category does not match
    (`cover` vs `ending`) — picking an interior template as the cover is a caller bug,
    not a renderable spread."""
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
    """The photo ids already placed on a page, in slot-declaration order.

    The cover/ending auto-fill reuses the page's own photos (the 相关页 Web sent carry
    the hero candidate); we never reach outside the given page for an image."""
    return list(page.images.values())


def _design_page(
    page: Page, template: templates.TemplateDef, template_id: str
) -> V3LayoutPatchEntry:
    """Auto-fill `page` into a finished cover/ending spread on `template` (§4.4(b)).

    Deterministic, mirrors the V3 body path:
      ① slot the page's existing photos into the template's image slots in declaration
         order (`skeleton_v3.assign_images_v3`) — capped at the template capacity (a
         cover usually holds ONE hero; extra photos are dropped, never reused/invented);
      ② code-fill generic decoration (`folio`/`date`) the same way generic_copy does
         for body pages; user-prose slots (title/body/explain) stay EMPTY (§4.1 不生成
         正式文案; §3 隐私: no place value ever written).

    Returns a `V3LayoutPatchEntry` carrying templateId + images + texts at the page's
    own `pageIndex` (§3 树边界: page-level)."""
    capacity = skeleton_v3.image_capacity(template)
    photos = _photo_ids(page)[:capacity]
    images = skeleton_v3.assign_images_v3(template_id, photos)

    # Generic decoration (folio/date) via the SAME deterministic helper body pages use.
    # The page's earliest photo takenAt drives the date; absent → no date (no invented
    # dates). User-prose slots are left empty by fill_page_generic_copy by construction.
    page_dict: dict[str, Any] = {
        "pageIndex": page.pageIndex,
        "templateId": template_id,
        "images": images,
        "texts": {},
    }
    page_date = _earliest_taken_at_for_page(images, page)
    texts = generic_copy.fill_page_generic_copy(page_dict, page_date)

    return V3LayoutPatchEntry(
        pageIndex=page.pageIndex,
        templateId=template_id,
        images=images,
        texts=texts,
    )


def _earliest_taken_at_for_page(
    images: Mapping[str, str], page: Page
) -> str | None:
    """The cover/ending page's date source.

    The flat cover request carries no per-photo takenAt (the tree is not sent to this
    endpoint — §8.3 only finalize gets the whole tree), so there is no EXIF to derive a
    date from here. We return None: the `date` decoration is simply left empty rather
    than invented (§4.1 / §3). Kept as a seam so a future takenAt-bearing cover request
    can light up the date without touching the fill logic."""
    return None


def build_cover(req: V3CoverRequest) -> V3CoverResponse:
    """Deterministically design the optional 封面/封尾 pages (§4.4).

    Pure function (no LLM/network/DB/base64). Behavior:
      * Skip (both template ids absent) → empty patch, no error (§4.4 跳过=空).
      * Cover chosen → design it onto the FIRST given page.
      * Ending chosen → design it onto the LAST given page.
      * Both chosen with ≥2 pages → cover on first, ending on last (distinct pages).
      * Any chosen template with no page to land on raises CoverV3Error; this must not
        be confused with skip.

    Raises `CoverV3Error` on an invalid template or missing landing page."""
    started = time.monotonic()

    cover_id = req.coverTemplateId
    ending_id = req.endingTemplateId

    if not cover_id and not ending_id:
        # §4.4 「跳过=空」: the user wants no cover/ending. Empty patch, NOT an error.
        log.info("cover_v3.skipped", album_id=req.albumId, pages=len(req.pages))
        return V3CoverResponse(
            layoutPatch=[],
            usage=V3Usage(
                durationMs=int((time.monotonic() - started) * 1000),
                models=V3Models(),
            ),
        )

    # Validate chosen templates up front (fail fast before designing any page).
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

    patches: list[V3LayoutPatchEntry] = []
    used_indices: set[int] = set()

    if cover_template is not None and pages:
        first = pages[0]
        patches.append(_design_page(first, cover_template, cover_id))  # type: ignore[arg-type]
        used_indices.add(0)

    if ending_template is not None and pages:
        # Land the ending on the LAST page; if that page already took the cover (only
        # one page given), there is no distinct ending slot — skip rather than clobber
        # the cover or invent a page.
        last_pos = len(pages) - 1
        if last_pos not in used_indices:
            patches.append(_design_page(pages[last_pos], ending_template, ending_id))  # type: ignore[arg-type]
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
        usage=V3Usage(durationMs=duration_ms, models=V3Models()),
    )
