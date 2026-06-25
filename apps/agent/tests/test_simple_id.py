from __future__ import annotations

from src.engine.simple_id import from_simple, to_simple


def test_to_simple_assigns_one_based_ids_and_mapping():
    simple_ids, mapping = to_simple(["photo_real_a", "photo_real_b", "photo_real_c"])

    assert simple_ids == ["1", "2", "3"]
    assert mapping == {
        "1": "photo_real_a",
        "2": "photo_real_b",
        "3": "photo_real_c",
    }


def test_from_simple_recursively_replaces_id_values_and_keys():
    mapping = {"1": "photo_real_a", "2": "photo_real_b"}
    payload = {
        "photoId": "1",
        "photoIds": ["1", "2", "999"],
        "nested": {
            "1": {"selected": "2"},
            "unknown": "3",
        },
        "items": [{"id": "1"}, ("2", "keep")],
    }

    assert from_simple(payload, mapping) == {
        "photoId": "photo_real_a",
        "photoIds": ["photo_real_a", "photo_real_b", "999"],
        "nested": {
            "photo_real_a": {"selected": "photo_real_b"},
            "unknown": "3",
        },
        "items": [{"id": "photo_real_a"}, ("photo_real_b", "keep")],
    }


def test_from_simple_preserves_unknown_ids_and_non_string_scalars():
    assert from_simple(["2", 7, None, True], {"1": "photo_real_a"}) == ["2", 7, None, True]
