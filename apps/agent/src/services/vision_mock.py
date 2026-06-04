from ..schemas import LayoutRequest, PhotoAnalysis, PhotoGroup, VisionResult


_QUALITY_CYCLE = ("hero", "detail", "fill")


def _orientation(width: int, height: int) -> str:
    if width > height:
        return "landscape"
    if height > width:
        return "portrait"
    return "square"


def _groups(photo_ids: list[str]) -> list[PhotoGroup]:
    if len(photo_ids) == 1:
        return [PhotoGroup(groupId="g1", label="Closing", photoIds=photo_ids, role="closing")]
    if len(photo_ids) == 2:
        return [
            PhotoGroup(groupId="g1", label="Opening", photoIds=[photo_ids[0]], role="opening"),
            PhotoGroup(groupId="g2", label="Closing", photoIds=[photo_ids[1]], role="closing"),
        ]
    return [
        PhotoGroup(groupId="g1", label="Opening", photoIds=[photo_ids[0]], role="opening"),
        PhotoGroup(groupId="g2", label="Body", photoIds=photo_ids[1:-1], role="body"),
        PhotoGroup(groupId="g3", label="Closing", photoIds=[photo_ids[-1]], role="closing"),
    ]


def analyze(req: LayoutRequest) -> VisionResult:
    results: list[PhotoAnalysis] = []
    for idx, photo in enumerate(req.photos):
        if idx == 0:
            quality = "hero"
        else:
            quality = _QUALITY_CYCLE[1 + ((idx - 1) % 2)]
        results.append(
            PhotoAnalysis(
                photoId=photo.photoId,
                description="A moment from your story",
                tags=["family", "warm"],
                quality=quality,  # type: ignore[arg-type]
                orientation=_orientation(photo.width, photo.height),  # type: ignore[arg-type]
                peopleCount="1",
                scene="outdoor",
                mood="warm",
                timeOfDay="day",
                location=None,
            )
        )
    return VisionResult(photos=results, groups=_groups([p.photoId for p in req.photos]))
