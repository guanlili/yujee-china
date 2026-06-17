"""Vision-diagnosis service tests (#165 Phase 2).

The vision `complete` is MOCKED in every case — no live API. Covers:
  * good JSON → clamped diagnosis pinned to a real slot;
  * out-of-range dx/dy/scale/confidence → clamped;
  * invalid (off-page) imageId → null + graceful "unable to inspect";
  * vision upstream error → graceful "unable to inspect" (NEVER raises);
  * the route degrades the same way (mock mode).
"""

import json

import pytest
from fastapi.testclient import TestClient

from src.schemas_v2 import V2InspectRequest, V2InspectResponse
from src.services import ai_client, inspect_render

_AUTH = {"Authorization": "Bearer test_secret", "X-Request-Id": "req_165"}


def _req(user_message="the face is cut off at the top", screenshot="data:image/png;base64,AAAA"):
    return V2InspectRequest.model_validate(
        {
            "albumId": "a1",
            "language": "en",
            "page": {
                "pageIndex": 2,
                "templateId": "mag-05",
                "images": {"image": "p1"},
                "texts": {"title": "Old"},
            },
            "photos": [
                {
                    "photoId": "p1",
                    "description": "a portrait of a woman",
                    "tags": ["portrait"],
                    "quality": "hero",
                    "orientation": "portrait",
                    "peopleCount": "1",
                    "scene": "outdoor",
                    "mood": "warm",
                }
            ],
            "screenshot": screenshot,
            "userMessage": user_message,
        }
    )


def _vision_complete(payload):
    async def complete(**_kwargs):
        return {
            "choices": [{"message": {"content": json.dumps(payload)}}],
            "usage": {"prompt_tokens": 11, "completion_tokens": 3},
        }

    return complete


def _error_complete():
    async def complete(**_kwargs):
        raise ai_client.AIRequestError("vision upstream blew up")

    return complete


@pytest.mark.asyncio
async def test_good_json_yields_diagnosis():
    resp = await inspect_render.diagnose(
        _req(),
        complete=_vision_complete(
            {
                "imageId": "image",
                "problem": "the woman's head is cut off at the top",
                "targetX": 50,
                "targetY": 20,
                "suggestedScale": 1.2,
                "confidence": 0.8,
            }
        ),
    )
    assert isinstance(resp, V2InspectResponse)
    d = resp.diagnosis
    assert d.imageId == "image"
    assert d.targetX == 50
    assert d.targetY == 20
    assert d.suggestedScale == 1.2
    assert d.confidence == 0.8
    assert resp.usage.visionCallCount == 1
    assert resp.usage.planningInputTokens == 11
    assert resp.assistantReply


@pytest.mark.asyncio
async def test_out_of_range_values_clamped():
    resp = await inspect_render.diagnose(
        _req(),
        complete=_vision_complete(
            {
                "imageId": "image",
                "problem": "way off",
                "targetX": 999,
                "targetY": -999,
                "suggestedScale": 9,
                "confidence": 5,
            }
        ),
    )
    d = resp.diagnosis
    assert d.targetX == 100
    assert d.targetY == 0
    assert d.suggestedScale == 2.0
    assert d.confidence == 1.0


@pytest.mark.asyncio
async def test_invalid_image_id_yields_null_unable():
    # An imageId not on the page → null + graceful "unable to inspect".
    resp = await inspect_render.diagnose(
        _req(),
        complete=_vision_complete(
            {
                "imageId": "ghost",
                "problem": "something",
                "targetX": 50,
                "targetY": 20,
                "suggestedScale": 1.0,
                "confidence": 0.7,
            }
        ),
    )
    d = resp.diagnosis
    assert d.imageId is None
    assert d.problem == "unable to inspect"
    assert d.confidence == 0.0
    assert d.targetX == 50.0 and d.targetY == 50.0 and d.suggestedScale == 1.0


@pytest.mark.asyncio
async def test_null_image_id_yields_unable():
    resp = await inspect_render.diagnose(
        _req(),
        complete=_vision_complete(
            {
                "imageId": None,
                "problem": "page looks fine",
                "targetX": 50,
                "targetY": 50,
                "suggestedScale": 1.0,
                "confidence": 0.1,
            }
        ),
    )
    assert resp.diagnosis.imageId is None
    assert resp.diagnosis.problem == "unable to inspect"


@pytest.mark.asyncio
async def test_unparseable_json_degrades_gracefully():
    async def complete(**_kwargs):
        return {
            "choices": [{"message": {"content": "not json at all <<"}}],
            "usage": {"prompt_tokens": 1, "completion_tokens": 1},
        }

    resp = await inspect_render.diagnose(_req(), complete=complete)
    assert resp.diagnosis.imageId is None
    assert resp.diagnosis.problem == "unable to inspect"
    assert resp.diagnosis.confidence == 0.0


@pytest.mark.asyncio
async def test_vision_error_degrades_gracefully_no_raise():
    # A vision upstream failure must NOT raise — it degrades to "unable to inspect".
    resp = await inspect_render.diagnose(_req(), complete=_error_complete())
    assert resp.diagnosis.imageId is None
    assert resp.diagnosis.problem == "unable to inspect"
    assert resp.diagnosis.confidence == 0.0
    # Still a well-formed response the caller can answer with.
    assert resp.assistantReply
    assert resp.usage.visionCallCount == 1


# ---------- route (mock mode) -------------------------------------------------


@pytest.fixture()
def client():
    from src.main import app

    return TestClient(app)


def _route_body():
    return {
        "albumId": "a1",
        "language": "en",
        "page": {
            "pageIndex": 2,
            "templateId": "mag-05",
            "images": {"image": "p1"},
            "texts": {"title": "Old"},
        },
        "photos": [
            {
                "photoId": "p1",
                "description": "a portrait",
                "tags": ["portrait"],
                "quality": "hero",
                "orientation": "portrait",
                "peopleCount": "1",
                "scene": "outdoor",
                "mood": "warm",
            }
        ],
        "screenshot": "data:image/png;base64,AAAA",
        "userMessage": "the face is cut off",
    }


def test_route_inspect_in_mock_mode(client):
    resp = client.post("/v2/album/inspect-page", headers=_AUTH, json=_route_body())
    assert resp.status_code == 200
    data = resp.json()["data"]
    # Mock names the first slot and targets the upper area (face-cut-at-top fix).
    assert data["diagnosis"]["imageId"] == "image"
    assert data["diagnosis"]["targetY"] == 20
    assert data["assistantReply"]


def test_route_rejects_unknown_field(client):
    body = {**_route_body(), "draftTree": {}}
    resp = client.post("/v2/album/inspect-page", headers=_AUTH, json=body)
    assert resp.status_code == 400


def test_route_requires_bearer(client):
    resp = client.post("/v2/album/inspect-page", json=_route_body())
    assert resp.status_code in (401, 403)
