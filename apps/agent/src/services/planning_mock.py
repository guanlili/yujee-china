from ..schemas import AlbumLayoutPlan, LayoutRequest, Magazine, Page, PhotoAnalysis


def _title_from_prompt(prompt: str) -> str:
    trimmed = prompt.strip()
    if not trimmed:
        return "Untitled"
    return trimmed[:30]


def plan(req: LayoutRequest, photos: list[PhotoAnalysis]) -> AlbumLayoutPlan:
    title = _title_from_prompt(req.prompt)
    subtitle = "A memoir"
    magazine = Magazine(title=title, subtitle=subtitle, style="warm-film", language=req.language)

    third = photos[2].photoId if len(photos) >= 3 else photos[0].photoId

    pages: list[Page] = [
        Page(
            pageIndex=0,
            templateId="cover-01",
            images={"hero": photos[0].photoId},
            texts={"title": title, "subtitle": subtitle},
        ),
        Page(
            pageIndex=1,
            templateId="spread-01",
            images={"left": photos[1].photoId, "right": third},
            texts={"caption": "A page from your memoir"},
        ),
    ]

    remaining = photos[3:]
    spread_two_images: dict[str, str] = {}
    if remaining:
        for idx, photo in enumerate(remaining):
            slot = f"slot{idx + 1}"
            spread_two_images[slot] = photo.photoId
    else:
        spread_two_images = {"left": photos[0].photoId, "right": photos[1].photoId}

    pages.append(
        Page(
            pageIndex=2,
            templateId="spread-02",
            images=spread_two_images,
            texts={"caption": "Another page from your memoir"},
        )
    )

    return AlbumLayoutPlan(magazine=magazine, photos=photos, pages=pages)
