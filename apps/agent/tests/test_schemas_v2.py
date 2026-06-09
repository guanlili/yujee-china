"""v2 contract parity tests — mirror packages/contracts/src/v2.test.ts.

Guards the two P0 invariants from the rebuild review:
  P0-2: strict models reject lat/lng (never strip) — the D-GPS privacy point.
  P0-1: the callback union discriminates the two `completed` shapes by jobKind.
"""

import pytest
from pydantic import TypeAdapter, ValidationError

from src.schemas_v2 import V2Callback, V2InitRequest

_CALLBACK = TypeAdapter(V2Callback)

_DRAFT = dict(
    version="v2",
    meta=dict(style="warm-film", language="en"),
    photoPool=[],
    basePages=dict(
        cover=dict(pageIndex=0, templateId="mag-20", images={}, texts={}),
        ending=dict(pageIndex=1, templateId="mag-17", images={"image": "p1"}, texts={}),
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
                         pages=[dict(pageIndex=0, templateId="mag-20", images={}, texts={})]),
             usage=dict(durationMs=1, models={}))
    )
    assert type(parsed).__name__ == "V2FinalizeCompletedCallback"


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
