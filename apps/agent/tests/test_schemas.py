import pytest
from pydantic import ValidationError

from src.schemas import (
    AlbumLayoutPlan,
    LayoutRequest,
    Magazine,
    Page,
    PhotoAnalysis,
    PhotoGroup,
    PhotoIn,
    VisionResult,
)


def _photo_analysis(pid: str = "p1", quality: str = "hero", orientation: str = "landscape") -> PhotoAnalysis:
    return PhotoAnalysis(
        photoId=pid,
        description="A simple test photo",
        tags=["sample"],
        quality=quality,  # type: ignore[arg-type]
        orientation=orientation,  # type: ignore[arg-type]
        peopleCount="1",
        scene="outdoor",
        mood="warm",
        timeOfDay=None,
        location=None,
    )


class TestPhotoFloor:
    """architecture §6.5 decision 6 — photo floor lowered 3 → 1."""

    def test_single_photo_request_accepted(self):
        req = LayoutRequest(
            requestId="r1",
            prompt="a quiet afternoon",
            language="en",
            callbackUrl="http://example.com/cb",
            photos=[PhotoIn(photoId="p1", base64="data:image/jpeg;base64,A", width=800, height=600)],
        )
        assert len(req.photos) == 1

    def test_zero_photos_still_rejected(self):
        with pytest.raises(ValidationError):
            LayoutRequest(
                requestId="r1",
                prompt="hi",
                language="en",
                callbackUrl="http://example.com/cb",
                photos=[],
            )


class TestExtraForbid:
    def test_layout_request_rejects_unknown(self):
        with pytest.raises(ValidationError):
            LayoutRequest(
                requestId="r1",
                prompt="hi",
                language="en",
                callbackUrl="http://example.com/cb",
                photos=[
                    PhotoIn(photoId="p1", base64="data:image/jpeg;base64,A", width=10, height=10),
                    PhotoIn(photoId="p2", base64="data:image/jpeg;base64,A", width=10, height=10),
                    PhotoIn(photoId="p3", base64="data:image/jpeg;base64,A", width=10, height=10),
                ],
                unknown="x",  # type: ignore[call-arg]
            )

    def test_photo_analysis_rejects_unknown(self):
        with pytest.raises(ValidationError):
            PhotoAnalysis(
                photoId="p1",
                description="x",
                tags=[],
                quality="hero",
                orientation="landscape",
                peopleCount="1",
                scene="outdoor",
                mood="warm",
                extra="nope",  # type: ignore[call-arg]
            )


class TestPagesBound:
    def test_pages_capped_at_16(self):
        with pytest.raises(ValidationError):
            AlbumLayoutPlan(
                magazine=Magazine(title="H", style="warm-film", language="en"),
                photos=[_photo_analysis("p1")],
                pages=[
                    Page(pageIndex=i, templateId="mag-13", images={"image": "p1"}, texts={})
                    for i in range(17)
                ],
            )


class TestVisionGroups:
    def test_photo_group_and_vision_result_construct(self):
        group = PhotoGroup(
            groupId="g1",
            label="Opening moments",
            photoIds=["p1", "p2"],
            role="opening",
        )
        result = VisionResult(photos=[_photo_analysis("p1")], groups=[group])

        assert result.groups[0].role == "opening"
        assert result.groups[0].photoIds == ["p1", "p2"]

    def test_photo_group_rejects_unknown_key(self):
        with pytest.raises(ValidationError):
            PhotoGroup(
                groupId="g1",
                label="Opening moments",
                photoIds=["p1"],
                role="body",
                unexpected="x",  # type: ignore[call-arg]
            )
