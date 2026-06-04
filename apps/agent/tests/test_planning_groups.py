import json

from src.schemas import AlbumLayoutPlan, Magazine, Page, PhotoAnalysis, PhotoGroup
from src.services import planning


def _photo(pid: str) -> PhotoAnalysis:
    return PhotoAnalysis(
        photoId=pid,
        description="d",
        tags=["t"],
        quality="detail",
        orientation="landscape",
        peopleCount="1",
        scene="outdoor",
        mood="warm",
    )


def test_composing_user_payload_includes_internal_groups_but_layout_plan_does_not():
    magazine = Magazine(title="Trip", style="warm-film", language="en")
    photos = [_photo("p1"), _photo("p2")]
    groups = [PhotoGroup(groupId="g1", label="Closing", photoIds=["p2"], role="closing")]

    payload = json.loads(planning._composing_user_payload(magazine, photos, groups=groups))

    assert payload["groups"] == [
        {"groupId": "g1", "label": "Closing", "photoIds": ["p2"], "role": "closing"}
    ]

    layout = AlbumLayoutPlan(
        magazine=magazine,
        photos=photos,
        pages=[Page(pageIndex=0, templateId="mag-13", images={"image": "p1"}, texts={})],
    )
    assert "groups" not in layout.model_dump()


def test_composing_system_prompt_mentions_group_adjacency_and_closing_hint():
    prompt = planning._composing_system_prompt(3)

    assert "same group" in prompt
    assert "adjacent" in prompt
    assert "role=closing" in prompt
