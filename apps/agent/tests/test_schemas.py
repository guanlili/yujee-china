import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest
from pydantic import TypeAdapter, ValidationError

from src.schemas import (
    AlbumLayoutPlan,
    LayoutRequest,
    Magazine,
    Page,
    PhotoAnalysis,
    PhotoGroup,
    PhotoIn,
    VisionResult,
    # V3 mirror (WP0.3 / #178)
    AccentColor,
    AlbumStage,
    ArtFontPack,
    TemplateCategory,
    TemplateDef,
    TemplateTextSlot,
    V3AcceptedResponse,
    V3ApplyThemeResponse,
    V3AnalyzeRequest,
    V3ApplyThemeRequest,
    V3Callback,
    V3Chapter,
    V3ChapterChatRequest,
    V3ChapterChatResponse,
    V3ChapterPhoto,
    V3CoverRequest,
    V3CoverResponse,
    V3FinalizeRequest,
    V3FinalizeResponse,
    V3LayoutTree,
    V3RecommendRequest,
    V3RecommendResponse,
    V3TemplateCandidate,
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

    def test_album_layout_photos_reject_internal_extensions_from_json(self):
        with pytest.raises(ValidationError):
            AlbumLayoutPlan.model_validate(
                {
                    "magazine": {"title": "H", "style": "warm-film", "language": "en"},
                    "photos": [
                        {
                            "photoId": "p1",
                            "description": "x",
                            "tags": [],
                            "quality": "hero",
                            "orientation": "landscape",
                            "peopleCount": "1",
                        }
                    ],
                    "pages": [
                        {"pageIndex": 0, "templateId": "mag-13", "images": {}, "texts": {}}
                    ],
                }
            )


class TestPagesBound:
    def test_pages_match_ts_contract_without_legacy_16_cap(self):
        layout = AlbumLayoutPlan(
            magazine=Magazine(title="H", style="warm-film", language="en"),
            photos=[_photo_analysis("p1")],
            pages=[
                Page(pageIndex=i, templateId="mag-13", images={"image": "p1"}, texts={})
                for i in range(17)
            ],
        )

        assert len(layout.pages) == 17
        assert {"peopleCount", "scene", "mood", "timeOfDay", "location"}.isdisjoint(
            layout.model_dump()["photos"][0]
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


# =============================================================================
# V3 contract mirror (WP0.3 / #178) — parity with @yujee/contracts
#   src/{enums,layout,templates,v3}.ts.
# =============================================================================

_ACCENT = TypeAdapter(AccentColor)
_ALBUM_STAGE = TypeAdapter(AlbumStage)
_ART_FONT = TypeAdapter(ArtFontPack)
_TEMPLATE_CATEGORY = TypeAdapter(TemplateCategory)
_CALLBACK = TypeAdapter(V3Callback)


class TestV3Enums:
    """enums.ts — closed legal sets, byte-aligned members."""

    def test_album_stage_five_states(self):
        for stage in ("analysing", "story", "theme", "cover", "ready"):
            assert _ALBUM_STAGE.validate_python(stage) == stage
        with pytest.raises(ValidationError):
            _ALBUM_STAGE.validate_python("done")

    def test_template_category_replaces_slot_scene(self):
        for cat in ("cover", "interior", "toc", "ending"):
            assert _TEMPLATE_CATEGORY.validate_python(cat) == cat
        with pytest.raises(ValidationError):
            _TEMPLATE_CATEGORY.validate_python("opening")  # old scene rejected

    def test_art_font_pack_closed_set(self):
        assert _ART_FONT.validate_python("serif-classic") == "serif-classic"
        with pytest.raises(ValidationError):
            _ART_FONT.validate_python("comic-sans")


class TestV3AccentColor:
    def test_accepts_rgb_and_rrggbb(self):
        assert _ACCENT.validate_python("#abc") == "#abc"
        assert _ACCENT.validate_python("#A1B2C3") == "#A1B2C3"

    @pytest.mark.parametrize("bad", ["red", "#12", "blue", "abc", "#xyz"])
    def test_rejects_non_hex(self, bad):
        with pytest.raises(ValidationError):
            _ACCENT.validate_python(bad)


class TestV3ChapterTreePrivacy:
    """§3 privacy red line — V3 chapter tree carries NO location/GPS field; the
    strict (extra='forbid') models reject any such key at parse time."""

    base_photo = {
        "photoId": "p1",
        "sceneDescription": "a woman in a red coat walking in the snow",
        "width": 800,
        "height": 1200,
        "orientation": "portrait",
        "takenAt": "2024-03-15T08:30:00.000Z",
    }

    def test_chapter_photo_shape_and_null_takenat(self):
        V3ChapterPhoto.model_validate(self.base_photo)
        V3ChapterPhoto.model_validate({**self.base_photo, "takenAt": None})
        V3ChapterPhoto.model_validate({**self.base_photo, "takenAt": "2024-03-15T08:30:00"})

    @pytest.mark.parametrize(
        "leak", ["location", "place", "lat", "lng", "gps", "coordinates"]
    )
    def test_chapter_photo_rejects_location_gps(self, leak):
        with pytest.raises(ValidationError):
            V3ChapterPhoto.model_validate({**self.base_photo, leak: "x"})

    def test_chapter_photo_rejects_bad_takenat(self):
        with pytest.raises(ValidationError):
            V3ChapterPhoto.model_validate({**self.base_photo, "takenAt": "not-a-date"})
        with pytest.raises(ValidationError):
            V3ChapterPhoto.model_validate({**self.base_photo, "takenAt": "2024-03-15T08:30:00+08:00"})

    def test_chapter_null_placeholders_then_filled(self):
        chapter = {
            "chapterId": "c1",
            "description": "a quiet spring morning in an old town",
            "accentColor": None,
            "artFont": None,
            "photos": [self.base_photo],
        }
        V3Chapter.model_validate(chapter)
        V3Chapter.model_validate(
            {**chapter, "accentColor": "#aabbcc", "artFont": "sans-modern"}
        )
        with pytest.raises(ValidationError):
            V3Chapter.model_validate({**chapter, "artFont": "nope"})
        with pytest.raises(ValidationError):
            V3Chapter.model_validate({**chapter, "accentColor": "blue"})

    def test_layout_tree_strict(self):
        V3LayoutTree.model_validate({"chapters": []})
        with pytest.raises(ValidationError):
            V3LayoutTree.model_validate({"chapters": [], "extra": 1})


class TestV3TemplateLegacyTolerance:
    """templates.ts — V3 adds category/svgs/items/variableDecor/hint; the loader
    must still TOLERATE legacy slot/scene/quality/orientation/repeat JSON (WP0.1
    parity), or the WP0.4 template loader can't start."""

    def test_tolerates_legacy_slot_scene_quality_orientation(self):
        TemplateDef.model_validate(
            {
                "id": "mag-x",
                "slot": "interior",
                "scene": "portrait",
                "images": [{"id": "image", "quality": ["hero"], "orientation": ["portrait"]}],
                "texts": [{"id": "body", "role": "body", "lang": "user"}],
            }
        )

    def test_accepts_v3_category_svgs_items(self):
        TemplateDef.model_validate(
            {
                "id": "mag-y",
                "category": "interior",
                "images": [{"id": "image"}],
                "svgs": [{"id": "divider", "variableDecor": True}],
                "texts": [
                    {"id": "title", "role": "title", "lang": "user", "variableDecor": True, "hint": "h"}
                ],
                "items": {"texts": [{"id": "caption", "role": "explain", "lang": "user", "maxChars": 70}]},
            }
        )

    def test_requires_classification(self):
        with pytest.raises(ValidationError):
            TemplateDef.model_validate(
                {
                    "id": "mag-z",
                    "images": [{"id": "image"}],
                    "texts": [{"id": "title", "role": "title", "lang": "user"}],
                }
            )

    def test_pairing_with_alias(self):
        tpl = TemplateDef.model_validate(
            {
                "id": "m",
                "category": "interior",
                "images": [],
                "texts": [],
                "pairing": {"forced": True, "with": "mag-2", "side": "left"},
            }
        )
        assert tpl.pairing is not None
        assert tpl.pairing.with_ == "mag-2"

    def test_text_slot_hint_max_chars(self):
        TemplateTextSlot.model_validate(
            {"id": "title", "role": "title", "lang": "user", "hint": "one line", "variableDecor": True}
        )
        with pytest.raises(ValidationError):
            TemplateTextSlot.model_validate(
                {"id": "t", "role": "body", "lang": "user", "hint": "x" * 201}
            )


class TestV3AnalyzePrivacy:
    """★ analyze exif is the §3 privacy enforcement point — only takenAt; any
    lat/lng/place key is rejected at parse time (mirrors WP0.1 TS strict exif)."""

    base = {
        "requestId": "r1",
        "albumId": "a1",
        "callbackUrl": "https://example.com/cb",
        "language": "en",
        "photos": [
            {"photoId": "p1", "base64": "data:image/jpeg;base64,xx", "width": 800, "height": 600}
        ],
    }

    def test_minimal_and_takenat_accepted(self):
        V3AnalyzeRequest.model_validate(self.base)
        V3AnalyzeRequest.model_validate({**self.base, "callbackUrl": "mailto:ops@example.com"})
        with_exif = {
            **self.base,
            "photos": [{**self.base["photos"][0], "exif": {"takenAt": "2024-03-15T08:30:00.000Z"}}],
        }
        V3AnalyzeRequest.model_validate(with_exif)
        V3AnalyzeRequest.model_validate(
            {
                **self.base,
                "photos": [
                    {**self.base["photos"][0], "exif": {"takenAt": "2024-03-15T08:30:00"}}
                ],
            }
        )

    def test_rejects_zod_disallowed_type_coercion(self):
        bad = {
            **self.base,
            "photos": [
                {
                    **self.base["photos"][0],
                    "width": "800",
                }
            ],
        }
        with pytest.raises(ValidationError):
            V3AnalyzeRequest.model_validate(bad)

    @pytest.mark.parametrize(
        "exif_leak",
        [
            {"takenAt": None, "lat": 1, "lng": 2},
            {"takenAt": None, "place": "Kyoto"},
            {"latitude": 35.0},
            {"gps": "x"},
        ],
    )
    def test_exif_rejects_geo_keys(self, exif_leak):
        bad = {**self.base, "photos": [{**self.base["photos"][0], "exif": exif_leak}]}
        with pytest.raises(ValidationError):
            V3AnalyzeRequest.model_validate(bad)


class TestV3Endpoints:
    def test_chapter_chat_kind_drives_patch(self):
        usage = {"durationMs": 1, "models": {}}
        V3ChapterChatResponse.model_validate(
            {"kind": "write", "assistantReply": "done", "pagesTexts": [{"pageIndex": 0, "texts": {"body": "hi"}}], "usage": usage}
        )
        V3ChapterChatResponse.model_validate({"kind": "talk", "assistantReply": "tell me more", "usage": usage})
        with pytest.raises(ValidationError):
            V3ChapterChatResponse.model_validate({"kind": "sing", "assistantReply": "x", "usage": usage})

    def test_recommend_response_legal_sets(self):
        V3RecommendResponse.model_validate(
            {
                "themeOptions": [{"subject": "Spring in Kyoto", "label": "Kyoto"}],
                "chapterColors": [{"chapterId": "c1", "accentColor": "#aabbcc", "artFont": "serif-classic"}],
                "assistantReply": "",
                "usage": {"durationMs": 1, "models": {}},
            }
        )

    def test_apply_theme_and_cover_page_level(self):
        page = {"pageIndex": 0, "templateId": "mag-08", "images": {}, "texts": {}}
        V3ApplyThemeRequest.model_validate(
            {
                "albumId": "a1",
                "language": "en",
                "theme": {"subject": "s", "label": "l"},
                "chapters": [{"chapterId": "c1", "accentColor": "#abc", "artFont": "sans-modern"}],
                "pages": [page],
            }
        )
        V3CoverRequest.model_validate(
            {"albumId": "a1", "language": "en", "coverTemplateId": None, "endingTemplateId": None, "pages": [page]}
        )

    def test_finalize_returns_flat_layout(self):
        V3FinalizeResponse.model_validate(
            {
                "layout": {
                    "magazine": {"title": "My Book", "style": "warm-film", "language": "en"},
                    "photos": [],
                    "pages": [{"pageIndex": 0, "templateId": "mag-08", "images": {}, "texts": {}}],
                },
                "usage": {"durationMs": 1, "models": {}},
            }
        )

    def test_template_candidate(self):
        V3TemplateCandidate.model_validate({"templateId": "mag-08", "category": "interior", "imageSlotCount": 3})


class TestV3Callback:
    def test_union_progress_completed_failed(self):
        _CALLBACK.validate_python(
            {"requestId": "r1", "jobKind": "analyze", "event": "progress", "stage": "describe", "progress": 40}
        )
        _CALLBACK.validate_python(
            {
                "requestId": "r1",
                "jobKind": "analyze",
                "event": "completed",
                "tree": {"chapters": []},
                "pages": [{"pageIndex": 0, "templateId": "mag-08", "images": {}, "texts": {}}],
                "usage": {"durationMs": 1, "models": {}},
            }
        )
        _CALLBACK.validate_python(
            {"requestId": "r1", "jobKind": "analyze", "event": "failed", "error": {"code": "AGENT_TIMEOUT", "message": "timeout"}}
        )

    def test_union_rejects_unknown_event(self):
        with pytest.raises(ValidationError):
            _CALLBACK.validate_python({"requestId": "r1", "jobKind": "analyze", "event": "bogus"})


# ---------- cross-language parity (design.md §14 drift guard) -----------------

_REPO_ROOT = Path(__file__).resolve().parents[3]
_PARITY_FIXTURE = _REPO_ROOT / "packages" / "contracts" / "fixtures" / "v3" / "parity.json"

_PY_SCHEMAS = {
    "V3AcceptedResponse": V3AcceptedResponse,
    "V3AnalyzeRequest": V3AnalyzeRequest,
    "V3ApplyThemeResponse": V3ApplyThemeResponse,
    "V3ApplyThemeRequest": V3ApplyThemeRequest,
    "V3Chapter": V3Chapter,
    "V3ChapterChatRequest": V3ChapterChatRequest,
    "V3ChapterChatResponse": V3ChapterChatResponse,
    "V3ChapterPhoto": V3ChapterPhoto,
    "V3CoverRequest": V3CoverRequest,
    "V3CoverResponse": V3CoverResponse,
    "V3FinalizeRequest": V3FinalizeRequest,
    "V3FinalizeResponse": V3FinalizeResponse,
    "V3LayoutTree": V3LayoutTree,
    "V3RecommendRequest": V3RecommendRequest,
    "V3RecommendResponse": V3RecommendResponse,
    "V3TemplateCandidate": V3TemplateCandidate,
    "TemplateDef": TemplateDef,
    "TemplateTextSlot": TemplateTextSlot,
}
_PY_ADAPTERS = {"V3Callback": _CALLBACK}


def _py_valid(schema_name: str, payload) -> bool:
    try:
        if schema_name in _PY_ADAPTERS:
            _PY_ADAPTERS[schema_name].validate_python(payload)
        else:
            _PY_SCHEMAS[schema_name].model_validate(payload)
        return True
    except ValidationError:
        return False


def _load_parity_cases():
    data = json.loads(_PARITY_FIXTURE.read_text())
    return data["cases"]


def test_parity_fixture_exists():
    """The shared fixture is the single artifact both languages parse."""
    assert _PARITY_FIXTURE.exists(), f"missing parity fixture: {_PARITY_FIXTURE}"


@pytest.mark.parametrize("case", _load_parity_cases(), ids=lambda c: c["name"])
def test_cross_language_parity_python_side(case):
    """Python pydantic mirror must agree with the shared `expectValid` verdict for
    every fixture case. `expectValid` is the TS zod verdict (verified by
    packages/contracts/scripts/parity-check.ts), so a Python/TS drift surfaces
    here as a failing case — the historical risk in design.md §14."""
    assert _py_valid(case["schema"], case["payload"]) == case["expectValid"], (
        f"Python verdict disagrees with shared contract verdict for: {case['name']}"
    )


@pytest.mark.skipif(
    shutil.which("npx") is None or os.environ.get("YUJEE_SKIP_TS_PARITY") == "1",
    reason="node/npx unavailable; Python-vs-shared-verdict parity already covers drift",
)
def test_cross_language_parity_ts_side_matches_python():
    """When node is available, actually run the TS zod parser over the SAME
    fixtures and assert TS verdict == Python verdict per case (true cross-language
    check, not two hand-written copies)."""
    contracts_dir = _REPO_ROOT / "packages" / "contracts"
    if not (contracts_dir / "node_modules").exists():
        pytest.skip("contracts node_modules not installed in this checkout")
    proc = subprocess.run(
        ["npx", "tsx", "scripts/parity-check.ts"],
        cwd=contracts_dir,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert proc.returncode == 0, f"TS parity runner failed: {proc.stderr[:500]}"
    ts_results = {r["name"]: r["valid"] for r in json.loads(proc.stdout)}
    for case in _load_parity_cases():
        py = _py_valid(case["schema"], case["payload"])
        ts = ts_results.get(case["name"])
        assert ts == py, f"TS({ts}) != Python({py}) for case: {case['name']}"
