from src.services.deterministic_attrs import (
    PhotoDimensions,
    compute_orientation,
    fill_deterministic_attrs,
)


def test_compute_orientation_from_dimensions():
    assert compute_orientation(1600, 1200) == "landscape"
    assert compute_orientation(800, 1200) == "portrait"
    assert compute_orientation(1000, 1000) == "square"
    # Degenerate dimensions never raise — defensively treated as square.
    assert compute_orientation(0, 0) == "square"
    assert compute_orientation(-5, 100) == "square"


def test_fill_deterministic_attrs_is_code_only_and_carries_taken_at():
    filled = fill_deterministic_attrs(
        [
            PhotoDimensions(photo_id="p1", width=800, height=1200, taken_at="2024-03-15T08:30:00"),
            PhotoDimensions(photo_id="p2", width=1600, height=900, taken_at=None),
        ]
    )

    by_id = {attr.photo_id: attr for attr in filled}
    assert by_id["p1"].orientation == "portrait"
    assert by_id["p1"].width == 800
    assert by_id["p1"].height == 1200
    assert by_id["p1"].taken_at == "2024-03-15T08:30:00"
    assert by_id["p2"].orientation == "landscape"
    assert by_id["p2"].taken_at is None


def test_fill_deterministic_attrs_emits_no_gps_or_place_fields():
    """Privacy red line: the deterministic attrs carry no location dimension."""
    attrs = fill_deterministic_attrs(
        [PhotoDimensions(photo_id="p1", width=100, height=100, taken_at=None)]
    )
    fields = set(vars(attrs[0]).keys())
    assert not (fields & {"lat", "lng", "latitude", "longitude", "place", "location", "gps"})
