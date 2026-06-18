"""Endpoint wiring tests for POST /v2/album/finalize + /v2/album/edit (W6c).

finalize is the async 202 + v2 callback job (mirrors test_v2_init.py): it runs
Stage 5 (services/finalize.py) — the deterministic AlbumDraft → flat LayoutV2
flatten — and emits a `jobKind='finalize'` completed callback carrying the flat
layout, with progress on stage='finalize'. A flatten/validation failure emits a
`jobKind='finalize'` failed callback (AGENT_OUTPUT_VALIDATION).

edit is the synchronous seam (mirrors test_v2_theme_chat.py): it wires the W5
chat_edit_v2 service, returns a layoutPatch, and maps V2EditError → 502
AGENT_CHAT_FAILED. The services themselves are covered by test_finalize_flatten
/ test_chat_edit_v2; here we only verify the route around them.
"""

import asyncio
from typing import Any

import pytest
from fastapi.testclient import TestClient

from src.routes import v2_album
from src.schemas import Magazine, Page, PhotoAnalysis
from src.schemas_v2 import (
    AlbumDraft,
    LayoutV2,
    V2BasePages,
    V2Chapter,
    V2Cluster,
    V2EditRequest,
    V2EditResponse,
    V2Exif,
    V2FinalizeRequest,
    V2Meta,
    V2Photo,
    V2PhotoAnalysis,
)
from src.services import callback as cb_mod
from src.services import finalize, skeleton


# --------------------------------------------------------------------------- #
# fixtures                                                                     #
# --------------------------------------------------------------------------- #


@pytest.fixture
def captured_callbacks(monkeypatch):
    received: list[dict[str, Any]] = []

    async def fake_post(callback_url: str, envelope: Any) -> bool:
        received.append(envelope.model_dump(exclude_none=True, mode="json"))
        return True

    monkeypatch.setattr(cb_mod, "post", fake_post)
    return received


@pytest.fixture
def client():
    from src.main import app

    return TestClient(app)


_AUTH = {"Authorization": "Bearer test_secret", "X-Request-Id": "req_w6c"}


# --------------------------------------------------------------------------- #
# draft tree builders (mirror test_finalize_flatten.py)                        #
# --------------------------------------------------------------------------- #


def _photo(idx: int, quality: str = "detail", orientation: str = "portrait") -> V2Photo:
    pid = f"p{idx:03d}"
    return V2Photo(
        photoId=pid,
        analysis=V2PhotoAnalysis(
            photoId=pid,
            description=f"photo {idx}",
            tags=["trip"],
            quality=quality,  # type: ignore[arg-type]
            orientation=orientation,  # type: ignore[arg-type]
            peopleCount="1",
            scene="outdoor",
            mood="warm",
        ),
        exif=V2Exif(takenAt=None, place=None, order=idx),
        used=True,
    )


def _chapter(cid: str, photos: list[V2Photo], *, role: str = "body") -> V2Chapter:
    skeleton_photos = [finalize._skeleton_photo(p) for p in photos]
    pages = [Page(**pg) for pg in skeleton.build_chapter_pages("alb", cid, skeleton_photos)]
    return V2Chapter(
        chapterId=cid,
        state="empty",
        cluster=V2Cluster(label="A day out", place=None, timeRange=None, role=role),  # type: ignore[arg-type]
        photoIds=[p.photoId for p in photos],
        brief=None,
        askCount=0,
        pages=pages,
    )


def _draft(photos: list[V2Photo], chapters: list[V2Chapter]) -> AlbumDraft:
    skeleton_photos = [finalize._skeleton_photo(p) for p in photos]
    cover, ending = skeleton.build_base_pages("My Album", skeleton_photos, [])
    return AlbumDraft(
        version="v2",
        meta=V2Meta(theme=None, style="warm-film", language="en", promptHint="A trip"),
        photoPool=photos,
        basePages=V2BasePages(
            cover=Page(**cover), toc=None, ending=Page(**ending)
        ),
        chapters=chapters,
    )


def _draft_payload() -> dict:
    photos = [_photo(i) for i in range(1, 5)]
    draft = _draft(photos, [_chapter("ch_1", photos)])
    return draft.model_dump(mode="json")


def _finalize_req() -> V2FinalizeRequest:
    photos = [_photo(i) for i in range(1, 5)]
    draft = _draft(photos, [_chapter("ch_1", photos)])
    return V2FinalizeRequest(
        requestId="req_fin",
        albumId="alb_1",
        callbackUrl="http://example.com/cb",
        draftTree=draft,
    )


# --------------------------------------------------------------------------- #
# finalize — async job                                                         #
# --------------------------------------------------------------------------- #


def test_finalize_mock_emits_finalize_stage_and_layout(captured_callbacks):
    asyncio.run(v2_album._run_finalize(_finalize_req()))

    events = [c["event"] for c in captured_callbacks]
    assert events.count("completed") == 1, events
    assert events.count("failed") == 0, events

    # Every callback is a finalize job; progress is the single 'finalize' stage,
    # resetting 0 → 100.
    for c in captured_callbacks:
        assert c["jobKind"] == "finalize"
    progress = [c for c in captured_callbacks if c["event"] == "progress"]
    assert progress, "expected at least one progress callback"
    assert {c["stage"] for c in progress} == {"finalize"}
    ticks = [c["progress"] for c in progress]
    assert ticks[0] == 0 and ticks[-1] == 100, ticks

    completed = next(c for c in captured_callbacks if c["event"] == "completed")
    assert completed["jobKind"] == "finalize"
    assert completed["requestId"] == "req_fin"

    # The flat layout must re-validate against the LayoutV2 contract + validate_v2.
    layout = LayoutV2(**completed["layout"])
    assert 1 <= len(layout.pages) <= 48
    assert finalize.validate_v2(layout) is None
    # Photos are stripped to the external base-5 fields — the internal
    # composing-hint extensions never carry into the flat layout.
    for photo in layout.photos:
        assert photo.photoId and photo.quality and photo.orientation
        assert {
            "peopleCount",
            "scene",
            "mood",
            "timeOfDay",
            "location",
        }.isdisjoint(photo.model_dump())


def test_finalize_failure_emits_failed(monkeypatch, captured_callbacks):
    def boom(_draft):
        raise v2_album.FinalizeError("flat layout failed validate_v2")

    monkeypatch.setattr(v2_album.finalize_service, "finalize", boom)

    asyncio.run(v2_album._run_finalize(_finalize_req()))

    failed = [c for c in captured_callbacks if c["event"] == "failed"]
    assert len(failed) == 1, captured_callbacks
    assert failed[0]["jobKind"] == "finalize"
    assert failed[0]["error"]["code"] == "AGENT_OUTPUT_VALIDATION"
    assert failed[0]["stage"] == "finalize"
    assert not [c for c in captured_callbacks if c["event"] == "completed"]


def test_finalize_route_returns_202(client, captured_callbacks):
    resp = client.post(
        "/v2/album/finalize",
        headers=_AUTH,
        json={
            "requestId": "req_fin_route",
            "albumId": "alb_route",
            "callbackUrl": "http://example.com/cb",
            "draftTree": _draft_payload(),
        },
    )
    assert resp.status_code == 202, resp.text
    assert resp.json() == {
        "ok": True,
        "data": {"requestId": "req_fin_route", "accepted": True},
    }
    # Background task ran the flatten and emitted a terminal completed callback.
    assert any(c["event"] == "completed" for c in captured_callbacks)


def test_finalize_route_requires_auth(client):
    resp = client.post(
        "/v2/album/finalize",
        json={
            "requestId": "req_noauth",
            "albumId": "alb",
            "callbackUrl": "http://example.com/cb",
            "draftTree": _draft_payload(),
        },
    )
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "AGENT_UNAUTHORIZED"


def test_finalize_route_rejects_unknown_field(client):
    resp = client.post(
        "/v2/album/finalize",
        headers=_AUTH,
        json={
            "requestId": "req_bad",
            "albumId": "alb",
            "callbackUrl": "http://example.com/cb",
            "draftTree": _draft_payload(),
            "surprise": True,
        },
    )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "AGENT_INVALID_INPUT"


# --------------------------------------------------------------------------- #
# edit — synchronous                                                          #
# --------------------------------------------------------------------------- #


def _edit_layout() -> LayoutV2:
    """Valid 4-page album mirroring test_chat_edit_v2._layout()."""
    photos = [
        PhotoAnalysis(photoId="p1", description="d", tags=["t"], quality="hero", orientation="landscape"),
        PhotoAnalysis(photoId="p2", description="d", tags=["t"], quality="detail", orientation="portrait"),
        PhotoAnalysis(photoId="p3", description="d", tags=["t"], quality="detail", orientation="square"),
        PhotoAnalysis(photoId="p4", description="d", tags=["t"], quality="fill", orientation="landscape"),
    ]
    pages = [
        Page(pageIndex=0, templateId="mag-13", images={"image": "p1"},
             texts={"title": "Kyoto", "caption": "A quiet cover.", "folio": "01"}),
        Page(pageIndex=1, templateId="mag-19", images={"image": "p4"}, texts={"intro": "A quiet street."}),
        Page(pageIndex=2, templateId="mag-19",
             images={"image": "p3"}, texts={"intro": "Square note"}),
        Page(pageIndex=3, templateId="mag-03", images={"image": "p2"}, texts={"location": "The End"}),
    ]
    return LayoutV2(
        magazine=Magazine(title="Trip", style="warm-film", language="en"),
        photos=photos,
        pages=pages,
    )


def _edit_body(**overrides) -> dict:
    body = {
        "albumId": "alb_1",
        "currentLayout": _edit_layout().model_dump(mode="json"),
        "history": [],
        "userMessage": "make the cover warmer",
        "language": "en",
    }
    body.update(overrides)
    return body


def test_edit_mock_returns_patch_that_revalidates(client):
    resp = client.post("/v2/album/edit", headers=_AUTH, json=_edit_body())
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["ok"] is True
    out = V2EditResponse(**data["data"])
    assert out.assistantReply
    assert 1 <= len(out.layoutPatch) <= 48

    # Apply the returned patch and confirm the whole layout still validates.
    from src.services import chat_edit_v2

    req = V2EditRequest(**_edit_body())
    patched = chat_edit_v2._apply_patch(req.currentLayout, out.layoutPatch)
    assert chat_edit_v2.validate_v2(patched) is None


def test_edit_requires_auth(client):
    resp = client.post("/v2/album/edit", json=_edit_body())
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "AGENT_UNAUTHORIZED"


def test_edit_rejects_unknown_field(client):
    resp = client.post("/v2/album/edit", headers=_AUTH, json=_edit_body(surprise=True))
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "AGENT_INVALID_INPUT"


def test_edit_rejects_message_over_limit(client):
    resp = client.post("/v2/album/edit", headers=_AUTH, json=_edit_body(userMessage="x" * 501))
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "AGENT_INVALID_INPUT"


def test_edit_service_failure_maps_to_chat_failed(client, monkeypatch):
    async def boom(_req, *, complete=None):
        raise v2_album.V2EditError("patch failed after repair")

    monkeypatch.setattr(v2_album.chat_edit_v2, "run", boom)

    resp = client.post("/v2/album/edit", headers=_AUTH, json=_edit_body())
    assert resp.status_code == 502
    assert resp.json()["error"]["code"] == "AGENT_CHAT_FAILED"
