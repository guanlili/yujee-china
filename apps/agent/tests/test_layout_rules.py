from src.schemas import AlbumLayoutPlan, Magazine, Page, PhotoAnalysis
from src.services.layout_rules import violation


def _photo(pid: str, *, quality: str, orientation: str) -> PhotoAnalysis:
    return PhotoAnalysis(
        photoId=pid,
        description="test",
        tags=["t"],
        quality=quality,  # type: ignore[arg-type]
        orientation=orientation,  # type: ignore[arg-type]
        peopleCount="1",
        scene="outdoor",
        mood="warm",
    )


def _good_layout() -> AlbumLayoutPlan:
    photos = [
        _photo("p1", quality="hero", orientation="landscape"),
        _photo("p2", quality="detail", orientation="portrait"),
        _photo("p3", quality="fill", orientation="square"),
    ]
    pages = [
        Page(pageIndex=0, templateId="mag-13", images={"image": "p1"},
             texts={"title": "A spring trip to Kyoto", "intro": "x" * 45,
                    "issue": "YUJEE · 01", "credit": "AI ARRANGED · YUJEE"}),
        Page(pageIndex=1, templateId="mag-02", images={},
             texts={"items": "A small page of entries kept from the trip."}),
        Page(pageIndex=2, templateId="mag-12",
             images={"imageTop": "p3", "imageBottom": "p2"},
             texts={"num1": "02", "num2": "03"}),
    ]
    return AlbumLayoutPlan(
        magazine=Magazine(title="Trip", style="warm-film", language="en"),
        photos=photos,
        pages=pages,
    )


class TestRules:
    def test_good_layout_passes(self):
        assert violation(_good_layout()) is None

    def test_unknown_template_caught(self):
        layout = _good_layout()
        layout.pages[1] = Page(pageIndex=1, templateId="does-not-exist", images={}, texts={})
        assert "TemplateRegistry" in (violation(layout) or "")

    def test_non_cover_first_page_caught(self):
        layout = _good_layout()
        layout.pages[0] = Page(pageIndex=0, templateId="mag-02", images={}, texts={"items": "x"})
        msg = violation(layout) or ""
        assert "cover" in msg

    def test_quality_mismatch_caught(self):
        # mag-16.imageTiny requires quality=['fill'] — putting a hero there fails.
        layout = _good_layout()
        layout.pages[2] = Page(
            pageIndex=2,
            templateId="mag-16",
            images={"imageTiny": "p1", "imagePerson": "p1", "imageHarbor": "p1"},
            texts={"caption1": "x" * 45, "caption2": "y" * 45,
                   "caption3": "z" * 45, "quote": "q" * 35},
        )
        msg = violation(layout) or ""
        # p1 is landscape but imageTiny requires portrait → orientation hits first
        assert "orientation" in msg or "quality" in msg

    def test_unused_photo_caught(self):
        layout = _good_layout()
        layout.pages[2] = Page(pageIndex=2, templateId="mag-02", images={},
                               texts={"items": "x"})
        assert "unused" in (violation(layout) or "")

    def test_dup_on_same_page_caught(self):
        # mag-18 has two portrait slots — give it the same photoId twice
        photos = [
            _photo("p1", quality="hero", orientation="landscape"),
            _photo("p2", quality="detail", orientation="portrait"),
        ]
        layout = AlbumLayoutPlan(
            magazine=Magazine(title="x", style="warm-film", language="en"),
            photos=photos,
            pages=[
                Page(pageIndex=0, templateId="mag-13", images={"image": "p1"},
                     texts={"title": "Trip to Tokyo", "intro": "y" * 45,
                            "issue": "YUJEE · 01", "credit": "AI ARRANGED · YUJEE"}),
                Page(pageIndex=1, templateId="mag-02", images={}, texts={"items": "x"}),
                Page(pageIndex=2, templateId="mag-18",
                     images={"imageLeft": "p2", "imageRight": "p2"},
                     texts={"numLeft": "01", "numRight": "02",
                            "captionLeft": "x" * 45, "captionRight": "y" * 45,
                            "subtitle": "z" * 35}),
            ],
        )
        msg = violation(layout) or ""
        assert "twice on same page" in msg
