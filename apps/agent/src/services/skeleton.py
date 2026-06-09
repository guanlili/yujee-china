"""Deterministic v2 skeleton layout engine.

The rules in this module implement docs/agent/rebuild-tech-plan.md §4 without
LLM calls. Web has a TypeScript port; shared fixtures keep both outputs aligned.
"""

from __future__ import annotations

from collections import Counter
from itertools import permutations
from typing import Any, Iterable, Literal, Mapping, Sequence, TypedDict, cast

from src import templates


UseCase = Literal["chapter", "cover", "toc", "closing"]
PhotoQuality = Literal["hero", "detail", "fill"]
Photo = Mapping[str, Any]
Page = dict[str, Any]

_QUALITY_RANK: dict[str, int] = {"hero": 0, "detail": 1, "fill": 2}
_USE_CASES: tuple[UseCase, ...] = ("chapter", "cover", "toc", "closing")


class SkeletonChapter(TypedDict, total=False):
    chapterId: str
    cluster: dict[str, Any]
    photoIds: list[str]
    pages: list[Page]


class SkeletonResult(TypedDict):
    basePages: dict[str, Page | None]
    chapters: list[SkeletonChapter]
    pages: list[Page]


def _analysis(photo: Photo) -> Mapping[str, Any]:
    value = photo.get("analysis", photo)
    if not isinstance(value, Mapping):
        raise ValueError("photo.analysis must be an object")
    return value


def _photo_id(photo: Photo) -> str:
    value = photo.get("photoId") or _analysis(photo).get("photoId")
    if not isinstance(value, str) or not value:
        raise ValueError("photoId must be a non-empty string")
    return value


def _quality(photo: Photo) -> PhotoQuality:
    value = _analysis(photo).get("quality")
    if value not in _QUALITY_RANK:
        raise ValueError(f"unsupported photo quality: {value!r}")
    return cast(PhotoQuality, value)


def _orientation(photo: Photo) -> str | None:
    value = _analysis(photo).get("orientation")
    return value if isinstance(value, str) else None


def _order(photo: Photo) -> int:
    exif = photo.get("exif")
    if isinstance(exif, Mapping):
        value = exif.get("order")
        if isinstance(value, int) and not isinstance(value, bool):
            return value
    return 0


def _is_used(photo: Photo) -> bool:
    return bool(photo.get("used", True))


def _image_slot_count(template: templates.TemplateDef) -> int:
    return len(template["imageSlots"])


def _is_hero_slot(slot: templates.ImageSlot) -> bool:
    qualities = slot.get("quality") or []
    return "hero" in qualities and "fill" not in qualities


def _use_case_for_template(template_id: str, template: templates.TemplateDef) -> UseCase:
    if template_id == "mag-02":
        return "toc"
    if template["category"] == "cover":
        return "cover"
    if template["category"] == "closing":
        return "closing"
    return "chapter"


def _build_templates_by() -> dict[UseCase, dict[int, list[str]]]:
    out: dict[UseCase, dict[int, list[str]]] = {use_case: {} for use_case in _USE_CASES}
    for template_id in templates.TEMPLATE_IDS:
        template = templates.TEMPLATES[template_id]
        use_case = _use_case_for_template(template_id, template)
        count = _image_slot_count(template)
        out[use_case].setdefault(count, []).append(template_id)
    for per_count in out.values():
        for ids in per_count.values():
            ids.sort()
    return out


TEMPLATES_BY: dict[UseCase, dict[int, list[str]]] = _build_templates_by()


def fill_capacity(use_case: UseCase, image_count: int) -> int:
    """Return max non-hero image slots for a use case and image count."""

    return max(
        (
            sum(
                1
                for slot in templates.TEMPLATES[template_id]["imageSlots"].values()
                if not _is_hero_slot(slot)
            )
            for template_id in TEMPLATES_BY.get(use_case, {}).get(image_count, [])
        ),
        default=0,
    )


def partition_chapter_photos(chapter_photos: Sequence[Photo]) -> list[list[Photo]]:
    """Partition one chapter into 1/2/3-up pages with the 3-fill repair."""

    photos = list(chapter_photos)
    heroes = [photo for photo in photos if _quality(photo) == "hero"]
    solo = heroes[0] if heroes else None
    rest = [photo for photo in photos if photo is not solo]

    pages: list[list[Photo]] = []
    if solo is not None:
        pages.append([solo])

    n = len(rest)
    if n == 1:
        pages.append(rest[:1])
    elif n == 2:
        pages.append(rest[:2])
    elif n > 2:
        q, r = divmod(n, 3)
        if r == 0:
            page_sizes = [3] * q
        elif r == 1:
            page_sizes = [3] * (q - 1) + [2, 2]
        else:
            page_sizes = [3] * q + [2]

        offset = 0
        for size in page_sizes:
            pages.append(rest[offset : offset + size])
            offset += size

    repaired: list[list[Photo]] = []
    for page in pages:
        fill_count = sum(1 for photo in page if _quality(photo) == "fill")
        if len(page) == 3 and fill_count == 3:
            repaired.append(page[:2])
            repaired.append(page[2:])
        else:
            repaired.append(page)
    return repaired


def can_place(template_id: str, photos: Sequence[Photo]) -> bool:
    template = templates.TEMPLATES.get(template_id)
    if template is None:
        return False
    if _image_slot_count(template) != len(photos):
        return False
    fill_count = sum(1 for photo in photos if _quality(photo) == "fill")
    fill_ok = sum(1 for slot in template["imageSlots"].values() if not _is_hero_slot(slot))
    return fill_count <= fill_ok


def stable_hash(value: str) -> int:
    """FNV-1a 32-bit hash shared with the TS port."""

    h = 0x811C9DC5
    for byte in value.encode("utf-8"):
        h ^= byte
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def pick_template(
    use_case: UseCase,
    image_count: int,
    photos: Sequence[Photo],
    exclude: Iterable[str] | None = None,
    album_id: str = "",
    chapter_id: str = "",
    page_ordinal: int = 0,
    attempt: int = 0,
) -> str:
    candidates = list(TEMPLATES_BY.get(use_case, {}).get(image_count, []))
    if not candidates:
        raise ValueError(f"no templates for useCase={use_case} imageCount={image_count}")

    legal = [template_id for template_id in candidates if can_place(template_id, photos)]
    if not legal:
        raise ValueError(
            f"no legal templates for useCase={use_case} imageCount={image_count} "
            f"fillCount={sum(1 for photo in photos if _quality(photo) == 'fill')}"
        )

    excluded = set(exclude or ())
    pool = [template_id for template_id in legal if template_id not in excluded] or legal
    seed = stable_hash(f"{album_id}:{chapter_id}:{page_ordinal}:{attempt}")
    return pool[seed % len(pool)]


def assign_images(
    template_id: str,
    photos: Sequence[Photo],
    *,
    allow_fill_in_hero: bool = False,
) -> dict[str, str]:
    template = templates.TEMPLATES[template_id]
    slot_items = list(template["imageSlots"].items())
    if len(slot_items) != len(photos):
        raise ValueError(
            f"template {template_id} expects {len(slot_items)} images, got {len(photos)}"
        )
    if not slot_items:
        return {}

    best_score: int | None = None
    best_ids: tuple[str, ...] | None = None
    best_mapping: dict[str, str] | None = None

    for ordered_photos in permutations(photos):
        score = 0
        valid = True
        mapping: dict[str, str] = {}

        for (slot_name, slot), photo in zip(slot_items, ordered_photos, strict=True):
            if _quality(photo) == "fill" and _is_hero_slot(slot) and not allow_fill_in_hero:
                valid = False
                break

            qualities = slot.get("quality")
            orientations = slot.get("orientation")
            if qualities and _quality(photo) in qualities:
                score += 10
            if orientations and _orientation(photo) in orientations:
                score += 2
            mapping[slot_name] = _photo_id(photo)

        if not valid:
            continue

        ids = tuple(mapping[slot_name] for slot_name, _slot in slot_items)
        if best_score is None or score > best_score or (score == best_score and ids < best_ids):
            best_score = score
            best_ids = ids
            best_mapping = mapping

    if best_mapping is None:
        raise ValueError(f"could not assign images for template {template_id}")
    return best_mapping


def build_chapter_pages(
    album_id: str,
    chapter_id: str,
    photos: Sequence[Photo],
    attempt: int = 0,
) -> list[Page]:
    pages: list[Page] = []
    previous_template_id: str | None = None

    for ordinal, page_photos in enumerate(partition_chapter_photos(photos)):
        template_id = pick_template(
            "chapter",
            len(page_photos),
            page_photos,
            exclude={previous_template_id} if previous_template_id else set(),
            album_id=album_id,
            chapter_id=chapter_id,
            page_ordinal=ordinal,
            attempt=attempt,
        )
        pages.append(
            {
                "pageIndex": 0,
                "templateId": template_id,
                "images": assign_images(template_id, page_photos),
                "texts": {},
            }
        )
        previous_template_id = template_id

    return pages


def needs_toc(chapters: Sequence[Mapping[str, Any]], total_pages: int) -> bool:
    return len(chapters) >= 4 and total_pages >= 8


def best_photo(photos: Sequence[Photo]) -> Photo | None:
    if not photos:
        return None
    return min(photos, key=lambda photo: (_QUALITY_RANK[_quality(photo)], _order(photo), _photo_id(photo)))


def build_toc(chapters: Sequence[Mapping[str, Any]]) -> Page:
    texts: dict[str, str] = {}
    for idx, chapter in enumerate(chapters):
        cluster = chapter.get("cluster")
        label = cluster.get("label") if isinstance(cluster, Mapping) else None
        texts[f"items[{idx}].title"] = str(label or chapter.get("chapterId") or f"Chapter {idx + 1}")
    return {"pageIndex": 0, "templateId": "mag-02", "images": {}, "texts": texts}


def build_base_pages(
    album_id: str,
    used_photos: Sequence[Photo],
    chapter_pages: Sequence[Page],
) -> tuple[Page, Page]:
    use_count = Counter(
        photo_id
        for page in chapter_pages
        for photo_id in page["images"].values()
        if isinstance(photo_id, str)
    )

    def budget_ok(photo: Photo) -> bool:
        return use_count[_photo_id(photo)] < 2

    ending_candidates = [
        photo
        for photo in used_photos
        if _quality(photo) in ("hero", "detail") and budget_ok(photo)
    ]
    ending_pick = (
        best_photo(ending_candidates)
        or best_photo([photo for photo in used_photos if budget_ok(photo)])
        or best_photo(used_photos)
    )
    if ending_pick is None:
        raise ValueError("cannot build ending without at least one used photo")

    ending = {
        "pageIndex": 0,
        "templateId": "mag-17",
        "images": assign_images("mag-17", [ending_pick], allow_fill_in_hero=True),
        "texts": {},
    }
    use_count[_photo_id(ending_pick)] += 1

    cover_candidates = [
        photo
        for photo in used_photos
        if _quality(photo) in ("hero", "detail") and budget_ok(photo)
    ]
    cover_pick = best_photo(cover_candidates)
    if cover_pick is None:
        cover = {"pageIndex": 0, "templateId": "mag-20", "images": {}, "texts": {}}
    else:
        cover_template_id = pick_template(
            "cover",
            1,
            [cover_pick],
            album_id=album_id,
            chapter_id="cover",
            page_ordinal=0,
        )
        cover = {
            "pageIndex": 0,
            "templateId": cover_template_id,
            "images": assign_images(cover_template_id, [cover_pick]),
            "texts": {},
        }

    return cover, ending


def build_skeleton(input_data: Mapping[str, Any]) -> SkeletonResult:
    album_id = str(input_data.get("albumId") or "")
    photos = [photo for photo in input_data.get("photos", []) if isinstance(photo, Mapping)]
    photos_by_id = {_photo_id(photo): photo for photo in photos}
    used_photos = [photo for photo in photos if _is_used(photo)]

    output_chapters: list[SkeletonChapter] = []
    body_pages: list[Page] = []
    for raw_chapter in input_data.get("chapters", []):
        if not isinstance(raw_chapter, Mapping):
            continue
        chapter_id = str(raw_chapter.get("chapterId") or "")
        chapter_photo_ids = raw_chapter.get("photoIds", [])
        chapter_photos = [
            photos_by_id[photo_id]
            for photo_id in chapter_photo_ids
            if isinstance(photo_id, str) and _is_used(photos_by_id[photo_id])
        ]
        pages = build_chapter_pages(album_id, chapter_id, chapter_photos)
        output_chapter: SkeletonChapter = {
            "chapterId": chapter_id,
            "cluster": dict(raw_chapter.get("cluster") or {}),
            "photoIds": list(chapter_photo_ids),
            "pages": pages,
        }
        output_chapters.append(output_chapter)
        body_pages.extend(pages)

    cover, ending = build_base_pages(album_id, used_photos, body_pages)
    total_without_toc = 1 + len(body_pages) + 1
    toc = build_toc(output_chapters) if needs_toc(output_chapters, total_without_toc) else None

    flat_pages = [cover]
    if toc is not None:
        flat_pages.append(toc)
    flat_pages.extend(body_pages)
    flat_pages.append(ending)
    for page_index, page in enumerate(flat_pages):
        page["pageIndex"] = page_index

    return {
        "basePages": {"cover": cover, "toc": toc, "ending": ending},
        "chapters": output_chapters,
        "pages": flat_pages,
    }
