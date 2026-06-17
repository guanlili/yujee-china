"""v2 contract parity tests — mirror packages/contracts/src/v2.test.ts.

Guards the two P0 invariants from the rebuild review:
  P0-2: strict models reject lat/lng (never strip) — the D-GPS privacy point.
  P0-1: the callback union discriminates the two `completed` shapes by jobKind.
"""

import pytest
from pydantic import TypeAdapter, ValidationError

from src.schemas_v2 import (
    V2Callback,
    V2DraftEditRequest,
    V2DraftEditResponse,
    V2InitRequest,
    V2InspectDiagnosis,
    V2InspectRequest,
    V2InspectResponse,
)

_CALLBACK = TypeAdapter(V2Callback)

_DRAFT = dict(
    version="v2",
    meta=dict(style="warm-film", language="en"),
    photoPool=[],
    basePages=dict(
        cover=dict(pageIndex=0, templateId="mag-01", images={}, texts={}),
        ending=dict(pageIndex=1, templateId="mag-03", images={"image": "p1"}, texts={}),
    ),
    chapters=[],
)


def _init_req(exif=None):
    photo = dict(photoId="p1", base64="data:..", width=800, height=600)
    if exif is not None:
        photo["exif"] = exif
    return dict(
        requestId="r",
        albumId="a",
        callbackUrl="https://yujeeai.com/api/v2/internal/job-progress",
        language="en",
        photos=[photo],
    )


def test_init_exif_takenat_only_ok():
    V2InitRequest.model_validate(_init_req(dict(takenAt="2026-06-01T10:00:00Z")))


def test_init_exif_rejects_coordinates():
    with pytest.raises(ValidationError):
        V2InitRequest.model_validate(_init_req(dict(takenAt=None, lat=35.6, lng=139.7)))


def test_init_rejects_includeplace_or_unknown_top_level():
    with pytest.raises(ValidationError):
        V2InitRequest.model_validate({**_init_req(), "includePlace": True})


def test_init_completed_carries_draft_tree():
    parsed = _CALLBACK.validate_python(
        dict(event="completed", jobKind="init", requestId="r", draftTree=_DRAFT,
             usage=dict(durationMs=1, models={}))
    )
    assert type(parsed).__name__ == "V2InitCompletedCallback"


def test_init_completed_rejects_layout_field():
    with pytest.raises(ValidationError):
        _CALLBACK.validate_python(
            dict(event="completed", jobKind="init", requestId="r", draftTree=_DRAFT,
                 layout={}, usage=dict(durationMs=1, models={}))
        )


def test_finalize_completed_carries_layout():
    parsed = _CALLBACK.validate_python(
        dict(event="completed", jobKind="finalize", requestId="r",
             layout=dict(magazine=dict(title="t", style="s", language="en"), photos=[],
                         pages=[dict(pageIndex=0, templateId="mag-01", images={}, texts={})]),
             usage=dict(durationMs=1, models={}))
    )
    assert type(parsed).__name__ == "V2FinalizeCompletedCallback"


# ---------- #162 draft-edit contract parity (TS v2.ts ↔ pydantic) -------------
#
# Field-name + strictness parity with V2DraftEditRequest / V2DraftEditResponse
# in packages/contracts/src/v2.ts. Mirrors design.md §14 (no TS↔py drift) and
# invariant 12 (single page slice, no whole tree, no base64).

_DRAFT_PAGE = dict(pageIndex=2, templateId="mag-05", images={"image": "p1"}, texts={"title": "T"})
_DRAFT_PHOTO = dict(
    photoId="p1", description="d", tags=[], quality="detail", orientation="landscape",
    peopleCount="0", scene="outdoor", mood="warm",
)


def _draft_edit_req(**over):
    base = dict(
        albumId="a", language="en", page=_DRAFT_PAGE, photos=[_DRAFT_PHOTO],
        history=[], userMessage="change the title",
    )
    base.update(over)
    return base


def test_draft_edit_request_fields_and_strict():
    req = V2DraftEditRequest.model_validate(_draft_edit_req(focusedPageIndex=2))
    # exact field set matches the TS zod object.
    assert set(V2DraftEditRequest.model_fields) == {
        "albumId", "language", "theme", "page", "photos",
        "history", "userMessage", "focusedPageIndex",
    }
    assert req.focusedPageIndex == 2
    assert req.page.pageIndex == 2


def test_draft_edit_request_rejects_unknown_field():
    with pytest.raises(ValidationError):
        V2DraftEditRequest.model_validate({**_draft_edit_req(), "draftTree": {}})


def test_draft_edit_request_rejects_unknown_key_inside_page():
    # Fix 1 — `page` is V2DraftEditPage(_Strict); a stray key INSIDE page is
    # rejected, never stripped. The TS `page` slice is now `.strict()` too, so
    # both sides reject `page.bleed` symmetrically (TS↔py parity, design.md §14).
    bad_page = {**_DRAFT_PAGE, "bleed": True}
    with pytest.raises(ValidationError):
        V2DraftEditRequest.model_validate(_draft_edit_req(page=bad_page))


def test_draft_edit_request_requires_photos():
    # Fix 2 — `photos` is required on BOTH sides (no py default_factory, no TS
    # default): omitting it is rejected; an empty list is accepted.
    no_photos = _draft_edit_req()
    no_photos.pop("photos")
    with pytest.raises(ValidationError):
        V2DraftEditRequest.model_validate(no_photos)
    # empty list is a valid "this page uses no photos" payload.
    V2DraftEditRequest.model_validate(_draft_edit_req(photos=[]))


def test_draft_edit_request_focused_optional_and_nonnegative():
    # additive optional int>=0 | null
    V2DraftEditRequest.model_validate(_draft_edit_req())  # absent ok
    V2DraftEditRequest.model_validate(_draft_edit_req(focusedPageIndex=None))  # null ok
    with pytest.raises(ValidationError):
        V2DraftEditRequest.model_validate(_draft_edit_req(focusedPageIndex=-1))


def test_draft_edit_response_act_shape():
    resp = V2DraftEditResponse.model_validate(
        dict(
            kind="act", assistantReply="ok",
            pageWrite=dict(pageIndex=2, texts={"title": "New"}),
            usage=dict(durationMs=1, models={}),
        )
    )
    # #165 Phase 2: imagePosWrite + inspectRequest joined the response.
    assert set(V2DraftEditResponse.model_fields) == {
        "kind", "assistantReply", "pageWrite", "imagePosWrite", "inspectRequest", "usage",
    }
    assert resp.kind == "act"
    assert resp.pageWrite.texts == {"title": "New"}


def test_draft_edit_response_talk_omits_pagewrite():
    resp = V2DraftEditResponse.model_validate(
        dict(kind="talk", assistantReply="hi", usage=dict(durationMs=1, models={}))
    )
    assert resp.kind == "talk"
    assert resp.pageWrite is None


def test_draft_edit_response_rejects_bad_kind():
    with pytest.raises(ValidationError):
        V2DraftEditResponse.model_validate(
            dict(kind="other", assistantReply="x", usage=dict(durationMs=1, models={}))
        )


def test_progress_and_failed_carry_jobkind():
    prog = _CALLBACK.validate_python(
        dict(event="progress", jobKind="init", requestId="r", stage="vision", progress=0)
    )
    assert prog.jobKind == "init"
    failed = _CALLBACK.validate_python(
        dict(event="failed", jobKind="finalize", requestId="r",
             error=dict(code="AGENT_TIMEOUT", message="x"))
    )
    assert failed.jobKind == "finalize"


# ---------- #165 Phase 2 contract parity (TS v2.ts ↔ pydantic) ----------------
#
# Field-name + strictness parity for the inspect/adjust response additions and
# the new V2InspectRequest / V2InspectResponse (design.md §14, invariant 12: the
# screenshot is the only new base64 channel; no whole tree / photo base64).

_INSPECT_PAGE = dict(pageIndex=2, templateId="mag-05", images={"image": "p1"}, texts={"title": "T"})
_INSPECT_PHOTO = dict(
    photoId="p1", description="d", tags=[], quality="hero", orientation="portrait",
    peopleCount="1", scene="outdoor", mood="warm",
)


def _inspect_req(**over):
    base = dict(
        albumId="a", language="en", page=_INSPECT_PAGE, photos=[_INSPECT_PHOTO],
        screenshot="data:image/png;base64,AAAA", userMessage="face cut off",
    )
    base.update(over)
    return base


def test_draft_edit_response_inspect_kind_and_request():
    resp = V2DraftEditResponse.model_validate(
        dict(
            kind="inspect", assistantReply="Let me take a look.",
            inspectRequest=dict(pageIndex=2), usage=dict(durationMs=1, models={}),
        )
    )
    assert resp.kind == "inspect"
    assert resp.inspectRequest.pageIndex == 2
    assert resp.pageWrite is None and resp.imagePosWrite is None


def test_draft_edit_response_imagepos_write_shape():
    resp = V2DraftEditResponse.model_validate(
        dict(
            kind="act", assistantReply="moved it",
            imagePosWrite=dict(pageIndex=2, imageId="image", x=50, y=35, scale=1.2),
            usage=dict(durationMs=1, models={}),
        )
    )
    assert resp.imagePosWrite.imageId == "image"
    assert resp.imagePosWrite.y == 35
    assert resp.imagePosWrite.scale == 1.2


def test_draft_edit_response_imagepos_write_clamp_bounds():
    # x/y∈[0,100], scale∈[1,2] — the schema guards the Phase-1 ImagePos range.
    for bad in (
        dict(pageIndex=0, imageId="i", x=-1, y=50, scale=1),
        dict(pageIndex=0, imageId="i", x=50, y=101, scale=1),
        dict(pageIndex=0, imageId="i", x=50, y=50, scale=0.9),
        dict(pageIndex=0, imageId="i", x=50, y=50, scale=2.1),
    ):
        with pytest.raises(ValidationError):
            V2DraftEditResponse.model_validate(
                dict(kind="act", assistantReply="x", imagePosWrite=bad,
                     usage=dict(durationMs=1, models={}))
            )


def test_inspect_request_fields_and_strict():
    req = V2InspectRequest.model_validate(_inspect_req())
    assert set(V2InspectRequest.model_fields) == {
        "albumId", "language", "page", "photos", "screenshot", "userMessage",
    }
    assert req.screenshot.startswith("data:")
    assert req.page.pageIndex == 2


def test_inspect_request_rejects_unknown_field():
    # invariant 12: no whole tree / extra base64 smuggled in.
    with pytest.raises(ValidationError):
        V2InspectRequest.model_validate({**_inspect_req(), "draftTree": {}})


def test_inspect_request_rejects_unknown_key_inside_page():
    with pytest.raises(ValidationError):
        V2InspectRequest.model_validate(_inspect_req(page={**_INSPECT_PAGE, "bleed": True}))


def test_inspect_request_requires_screenshot():
    body = _inspect_req()
    body.pop("screenshot")
    with pytest.raises(ValidationError):
        V2InspectRequest.model_validate(body)


def test_inspect_diagnosis_fields_and_clamp():
    assert set(V2InspectDiagnosis.model_fields) == {
        "imageId", "problem", "suggestedDx", "suggestedDy", "suggestedScale", "confidence",
    }
    # imageId nullable; ranges enforced.
    V2InspectDiagnosis.model_validate(
        dict(imageId=None, problem="ok", suggestedDx=0, suggestedDy=0, suggestedScale=1, confidence=0)
    )
    for bad in (
        dict(imageId="i", problem="p", suggestedDx=51, suggestedDy=0, suggestedScale=1, confidence=0),
        dict(imageId="i", problem="p", suggestedDx=0, suggestedDy=-51, suggestedScale=1, confidence=0),
        dict(imageId="i", problem="p", suggestedDx=0, suggestedDy=0, suggestedScale=2.1, confidence=0),
        dict(imageId="i", problem="p", suggestedDx=0, suggestedDy=0, suggestedScale=1, confidence=1.1),
    ):
        with pytest.raises(ValidationError):
            V2InspectDiagnosis.model_validate(bad)


def test_inspect_response_fields_and_strict():
    resp = V2InspectResponse.model_validate(
        dict(
            diagnosis=dict(imageId="image", problem="cut off", suggestedDx=0, suggestedDy=-10,
                           suggestedScale=1.1, confidence=0.7),
            assistantReply="let me adjust", usage=dict(durationMs=1, models={}),
        )
    )
    assert set(V2InspectResponse.model_fields) == {"diagnosis", "assistantReply", "usage"}
    assert resp.diagnosis.imageId == "image"
    with pytest.raises(ValidationError):
        V2InspectResponse.model_validate(
            dict(diagnosis=dict(imageId="image", problem="p", suggestedDx=0, suggestedDy=0,
                                suggestedScale=1, confidence=0),
                 assistantReply="x", usage=dict(durationMs=1, models={}), extra=1)
        )
