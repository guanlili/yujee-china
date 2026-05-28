"""The 9 business rules from docs/agent/design.md §4.3. Used both after
composing and after applying a chat-edit patch. Returns the first violation
as a human-readable string for the repair prompt, or None if all pass."""

from collections import Counter
from math import ceil

from ..schemas import AlbumLayoutPlan, Page, PhotoAnalysis
from .. import templates as registry


def _expected_page_count(photo_count: int) -> int:
    raw = ceil(photo_count / 2.5)
    return min(16, max(3, raw))


def clamp_text(text: str, max_chars: int) -> str:
    """Trim text to <= max_chars, preferring the last word boundary within the
    limit (falling back to a hard cut). Only ever shortens."""
    if len(text) <= max_chars:
        return text
    hard = text[:max_chars].rstrip()
    space = hard.rfind(" ")
    if space >= max(1, int(max_chars * 0.6)):
        hard = hard[:space].rstrip()
    return hard


def clamp_texts_for_template(template_id: str, texts: dict[str, str]) -> dict[str, str]:
    """Return a copy of `texts` with each slot trimmed to the template's
    maxChars. Unknown template / slots pass through unchanged."""
    tpl = registry.get(template_id)
    if not tpl:
        return dict(texts)
    out = dict(texts)
    for slot, text in texts.items():
        cons = tpl["textSlots"].get(slot)
        if not cons:
            continue
        max_chars = cons.get("maxChars")
        if isinstance(max_chars, int):
            out[slot] = clamp_text(text, max_chars)
    return out


def clamp_page_texts(pages: list[Page]) -> list[Page]:
    """Deterministically trim each text slot to its template's maxChars.

    Real planning models (e.g. doubao-seed-lite) routinely overshoot a slot's
    maxChars by a few characters and ignore the repair feedback, which would
    otherwise fail Rule 9 and sink the whole generation over a purely cosmetic
    limit. This only ever shortens text and layout_rules enforces no minChars,
    so it can never introduce a new violation."""
    out: list[Page] = []
    for page in pages:
        new_texts = clamp_texts_for_template(page.templateId, page.texts)
        out.append(page.model_copy(update={"texts": new_texts}) if new_texts != page.texts else page)
    return out


def violation(layout: AlbumLayoutPlan) -> str | None:
    pages = layout.pages
    photos = layout.photos
    photo_ids = {p.photoId for p in photos}
    by_id: dict[str, PhotoAnalysis] = {p.photoId: p for p in photos}

    # Rule 1: page count
    expected = _expected_page_count(len(photos))
    if not (3 <= len(pages) <= 16):
        return f"pages count {len(pages)} outside [3, 16]"
    if len(pages) < expected:
        return f"pages count {len(pages)} below target {expected} for {len(photos)} photos"

    # Rule 2: first page must be a cover-category template
    first_tpl = registry.get(pages[0].templateId)
    if not first_tpl:
        return f"page 0 templateId {pages[0].templateId} not in TemplateRegistry"
    if first_tpl["category"] != "cover":
        return f"page 0 templateId {pages[0].templateId} category={first_tpl['category']} (must be cover)"

    # Rule 8: pageIndex strictly 0..N-1
    for expected_idx, page in enumerate(pages):
        if page.pageIndex != expected_idx:
            return f"pageIndex {page.pageIndex} at position {expected_idx} (must be sequential)"

    used_counts: Counter[str] = Counter()
    for page in pages:
        tpl = registry.get(page.templateId)
        if not tpl:
            return f"page {page.pageIndex}: templateId {page.templateId} not in TemplateRegistry"

        # Rule 7: image slot keys subset of template
        for slot in page.images.keys():
            if slot not in tpl["imageSlots"]:
                return f"page {page.pageIndex}: image slot '{slot}' not in template {page.templateId}"
        for slot in page.texts.keys():
            if slot not in tpl["textSlots"]:
                return f"page {page.pageIndex}: text slot '{slot}' not in template {page.templateId}"

        # Rule 5/6 + 4 (single-page dup): every photoId referenced exists; no duplicate within a page
        seen_on_page: set[str] = set()
        for slot, pid in page.images.items():
            if pid not in photo_ids:
                return f"page {page.pageIndex}: photoId {pid} not in photos[]"
            if pid in seen_on_page:
                return f"page {page.pageIndex}: photoId {pid} used twice on same page"
            seen_on_page.add(pid)
            used_counts[pid] += 1

            constraint = tpl["imageSlots"][slot]
            photo = by_id[pid]
            if photo.orientation not in constraint["orientation"]:
                return (
                    f"page {page.pageIndex} slot '{slot}': "
                    f"photo {pid} orientation={photo.orientation} not in "
                    f"{constraint['orientation']}"
                )
            if photo.quality not in constraint["quality"]:
                return (
                    f"page {page.pageIndex} slot '{slot}': "
                    f"photo {pid} quality={photo.quality} not acceptable "
                    f"(slot accepts {constraint['quality']})"
                )

        # Rule 9: text length (we keep it lenient: only the explicit maxChars)
        for slot, text in page.texts.items():
            cons = tpl["textSlots"][slot]
            max_chars = cons.get("maxChars")
            if isinstance(max_chars, int) and len(text) > max_chars:
                return (
                    f"page {page.pageIndex} text '{slot}' length {len(text)} > "
                    f"maxChars {max_chars}"
                )

    # Rule 3: every photoId referenced at least once
    unused = [pid for pid in photo_ids if used_counts[pid] == 0]
    if unused:
        return f"unused photos: {unused[:3]}"

    # Rule 6: single photo reused at most twice
    overused = [pid for pid, c in used_counts.items() if c > 2]
    if overused:
        return f"photos reused more than 2 times: {overused[:3]}"

    return None
