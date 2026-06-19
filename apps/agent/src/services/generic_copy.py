"""V3 generic copy + generic color: the preview-state layer (WP1.5 / #184).

The analyze环节 ends with a book the user can immediately see "已排好版、填了通用
文案/通用色" (v3-requirements §4.1(e) / §7.1). WP1.4 (`select_template`) produced the
flat preview pages — which template each page uses and which photo sits in each
image slot — but with EMPTY `texts`. This module layers the generic copy onto those
pages so the preview reads as a finished spread, WITHOUT generating any正式文案.

What "通用文案" means here (§4.1(e): 不生成正式文案,直接用模板自带通用文案):

  * `decoration`-role text slots are CODE-FILLED with deterministic, template-driven
    decoration — never user content (templates/README.md: decoration ids are
    function names like `folio` / `date`, "filled with code-generated decoration like
    dates/numbers/labels, never user content"):
      - `folio`  → the page number (1-based), zero-padded to the slot's maxChars.
      - `date` / `dateNum` → a compact date derived from the page's photos' earliest
        `takenAt` (code-filled EXIF, §4.1(c)); omitted when no photo on the page
        carries a takenAt (no invented dates — §3 / writing skill红线).
  * Every OTHER text slot — `title` / `body` / `explain` (lang=user), and decoration
    slots we don't own a deterministic value for (`location` / `topRight` / `sideText`
    / `numbers`) — is left EMPTY. The正式文案 for user slots is authored later by the
    章节故事环节 (§7.1: "章节故事: 覆盖成正式文案"); writing fake copy now would violate
    §4.1 "不生成正式文案". `location` in particular MUST stay empty (§3 隐私: no place).

What "通用色 / 占位 accentColor/artFont" means here (§4.1):

  * The chapter tree carries `accentColor` / `artFont` as REQUIRED-NULLABLE keys; the
    describe-content step (WP1.3) already sets them to `null` placeholders, and the
    theme环节 (WP3.x) fills the real值 by sampling each chapter's hero photo. This
    module does NOT invent a per-chapter color — `null` IS the通用占位 the renderer
    falls back to a neutral default for. Baking a fake accent now would be overwritten
    in theme and risk shipping a wrong color into the preview. So generic色 = leaving
    the null placeholders intact + the deterministic decoration above; this module
    keeps that contract explicit so later WPs know the seam.

Pure code, no LLM, no base64 (§3): this stage only reads page/template structure and
the code-filled `takenAt` the tree already carries. It NEVER hard-fails the preview —
an unknown template or a missing slot just yields fewer filled decorations.
"""

from __future__ import annotations

from typing import Any, Mapping, Sequence

from .. import templates
from ..logging_config import get_logger
from ..schemas import V3Chapter

log = get_logger("generic_copy")

# Decoration slot ids we own a deterministic generic value for. Anything else
# (location/topRight/sideText/numbers/…) is intentionally left empty — see module
# docstring. `location` MUST never be filled (§3 隐私: no place).
_FOLIO_IDS = frozenset({"folio"})
_DATE_IDS = frozenset({"date", "dateNum"})


def _photo_taken_at_index(chapters: Sequence[V3Chapter]) -> dict[str, str]:
    """photoId -> takenAt for every photo that carries one (code-filled EXIF).

    Built once from the chapter tree so the per-page date decoration can look up the
    capture time of whatever photos landed on that page. Photos without a takenAt are
    omitted (no invented dates)."""
    index: dict[str, str] = {}
    for chapter in chapters:
        for photo in chapter.photos:
            if photo.takenAt:
                index[photo.photoId] = photo.takenAt
    return index


def _earliest_taken_at(photo_ids: Sequence[str], taken_at: Mapping[str, str]) -> str | None:
    """The earliest known capture time among a page's photos (ISO strings sort
    chronologically), or None when none of them carry a takenAt."""
    stamps = [taken_at[pid] for pid in photo_ids if pid in taken_at]
    return min(stamps) if stamps else None


def _format_date_decor(taken_at_iso: str, max_chars: int | None) -> str:
    """A compact generic date label from an ISO `takenAt`, clamped to the slot's
    maxChars. Prefers `MM/YY` (e.g. ``03/24`` — matches templates/README's "如 08/24",
    5 chars); on a tight slot falls back to a bare zero-padded month, then truncation.
    EXIF time only — no place (§3)."""
    # takenAt matches the contract's ISO datetime (validated upstream); slice the
    # date parts off the front rather than parsing, so a `Z`/offset suffix is moot.
    year = taken_at_iso[0:4]
    month = taken_at_iso[5:7]
    if not (year.isdigit() and month.isdigit()):
        return ""
    full = f"{month}/{year[2:]}"  # e.g. "03/24"
    if max_chars is None or len(full) <= max_chars:
        return full
    if max_chars >= len(month):
        return month
    return full[:max_chars]


def _format_folio(page_index: int, max_chars: int | None) -> str:
    """A 1-based page number for a `folio` slot, zero-padded to maxChars (defaulting
    to 2 digits — `02` — matching the existing decoration convention)."""
    width = max_chars if (max_chars and max_chars > 0) else 2
    return str(page_index + 1).zfill(width)[:width]


def _decor_for_slot(slot: Mapping[str, Any], page_index: int, page_date: str | None) -> str | None:
    """The deterministic generic value for one decoration slot, or None to leave it
    empty. Only `folio` and `date`/`dateNum` are owned; every other decoration id is
    left to later environments (theme just recolors them — value stays code-owned)."""
    slot_id = slot.get("id", "")
    max_chars = slot.get("maxChars")
    if slot_id in _FOLIO_IDS:
        return _format_folio(page_index, max_chars)
    if slot_id in _DATE_IDS and page_date is not None:
        value = _format_date_decor(page_date, max_chars)
        return value or None
    return None


def fill_page_generic_copy(page: Mapping[str, Any], page_date: str | None) -> dict[str, str]:
    """Generic-copy `texts` for one preview page: deterministic decoration only.

    Reads the page's `templateId` to find its text-slot declarations, fills the
    decoration slots we own (`folio`, `date`/`dateNum`) and leaves everything else
    empty. Merges over any texts already on the page (keeps explicit values, never
    overwrites a non-empty slot). Returns a plain `{slotId: str}` dict (Page.texts
    shape). An unknown template yields the page's existing texts unchanged — this
    stage never hard-fails the preview."""
    existing = dict(page.get("texts") or {})
    template_id = page.get("templateId")
    template = templates.get(template_id) if isinstance(template_id, str) else None
    if template is None:
        return existing

    page_index = int(page.get("pageIndex") or 0)
    out = dict(existing)
    for slot in templates.text_slots(template):
        if slot.get("role") != "decoration":
            continue
        slot_id = slot.get("id", "")
        if out.get(slot_id):
            continue  # never clobber an explicit/non-empty value
        value = _decor_for_slot(slot, page_index, page_date)
        if value:
            out[slot_id] = value
    return out


def fill_generic_copy(
    pages: Sequence[Mapping[str, Any]], chapters: Sequence[V3Chapter]
) -> list[dict[str, Any]]:
    """Layer generic 文案 onto the WP1.4 preview pages → preview-state pages (§4.1(e)).

    For each page: deterministic decoration (`folio` page number, `date` from the
    page's photos' earliest code-filled `takenAt`) is filled into `texts`; user-content
    and unowned decoration slots stay empty for the章节故事环节 to author. The chapter
    tree's `accentColor`/`artFont` null placeholders are left intact (通用色 = the null
    placeholder; theme环节 fills real值). Pure code, never raises.

    Returns NEW page dicts (Page shape: pageIndex/templateId/images/texts/…) so the
    caller's input is not mutated. Page ordering and image assignment are untouched —
    this stage only adds generic decoration text."""
    taken_at = _photo_taken_at_index(chapters)
    out: list[dict[str, Any]] = []
    filled_decor = 0
    for page in pages:
        photo_ids = list((page.get("images") or {}).values())
        page_date = _earliest_taken_at(photo_ids, taken_at)
        texts = fill_page_generic_copy(page, page_date)
        new_page = dict(page)
        new_page["texts"] = texts
        filled_decor += sum(1 for v in texts.values() if v)
        out.append(new_page)
    log.info("generic_copy.filled", pages=len(out), decorations=filled_decor)
    return out
