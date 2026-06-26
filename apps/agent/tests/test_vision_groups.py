import asyncio
import json
from typing import Any

import pytest

from src.schemas import V3AnalyzePhoto, V3LayoutTree
from src import ai_client
from src.agents.image_understanding import handler as vision


@pytest.fixture(autouse=True)
def _real_vision_env(monkeypatch):
    monkeypatch.setenv("AGENT_PIPELINE_MODE", "real")
    monkeypatch.setenv("ARK_API_KEY", "fake_ark")
    from src import settings as s

    s.reset_settings_cache()
    yield
    s.reset_settings_cache()


# =============================================================================
# WP1.3 describe-content (#182): 章节树 partition + 3 LLM fields + failover.
# =============================================================================


@pytest.fixture
def _describe_env(monkeypatch):
    """describe-content env with BOTH slots keyed (OpenAI primary + 火山 failover)."""
    monkeypatch.setenv("AGENT_PIPELINE_MODE", "real")
    # describe-content's primary IS the OpenAI slot; without pinning the provider the
    # default (vision_provider="ark") makes ark the primary and the gpt-5.5-mini
    # assertions below fail. This keeps the failover tests deterministic regardless of
    # the operator's .env default.
    monkeypatch.setenv("VISION_PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_VISION_MODEL", "gpt-4o-mini")
    monkeypatch.setenv("OPENAI_API_KEY", "fake_oai")
    monkeypatch.setenv("ARK_API_KEY", "fake_ark")
    from src import settings as s

    s.reset_settings_cache()
    yield
    s.reset_settings_cache()


def _v3_photos(count: int = 3) -> list[V3AnalyzePhoto]:
    return [
        V3AnalyzePhoto(
            photoId=f"p{i + 1}",
            base64="data:image/jpeg;base64,AA==",
            width=800 if i % 2 == 0 else 600,
            height=600 if i % 2 == 0 else 800,
            exif={"takenAt": f"2024-03-{(i % 28) + 1:02d}T08:30:00"},
        )
        for i in range(count)
    ]


def _chapters_payload() -> dict[str, Any]:
    return {
        "chapters": [
            {
                "description": "Spring morning walk.",
                "photoIds": ["p1", "p2"],
                "scenes": {
                    "p1": "a woman in a red coat",
                    "p2": "snow on the old street",
                },
            },
            {
                "description": "Quiet afternoon.",
                "photoIds": ["p3"],
                "scenes": {"p3": "a quiet teahouse"},
            },
        ]
    }


def _completion(content: Any) -> dict[str, Any]:
    return {
        "choices": [{"message": {"content": json.dumps(content)}}],
        "usage": {"prompt_tokens": 11, "completion_tokens": 7},
    }


def test_describe_content_builds_chapter_tree_with_llm_3_fields(_describe_env, monkeypatch):
    async def fake_completion(**kwargs):
        # Primary slot = OpenAI (GPT-5.5 Mini); never carries doubao's `thinking`.
        assert kwargs["model"] == "gpt-5.5-mini"
        assert kwargs.get("extra_body") is None
        return _completion(_chapters_payload())

    monkeypatch.setattr(ai_client, "chat_completion", fake_completion)

    photos = _v3_photos(3)
    result = asyncio.run(vision.describe_content(photos, language="en"))

    assert isinstance(result.tree, V3LayoutTree)
    assert result.provider == "openai"
    assert result.model == "gpt-5.5-mini"
    assert result.tokens_billed == 18

    chapters = result.tree.chapters
    assert [c.chapterId for c in chapters] == ["ch_1", "ch_2"]
    # ① 分章 (LLM): partition honored.
    assert [[p.photoId for p in c.photos] for c in chapters] == [["p1", "p2"], ["p3"]]
    # ② description (LLM).
    assert chapters[0].description == "Spring morning walk."
    # ③ sceneDescription (LLM).
    assert chapters[0].photos[0].sceneDescription == "a woman in a red coat"

    # Code-filled deterministic attrs come from the REQUEST, not the LLM (§4.1(c)).
    p1 = chapters[0].photos[0]
    assert (p1.width, p1.height, p1.orientation) == (800, 600, "landscape")
    assert p1.takenAt == "2024-03-01T08:30:00"
    p3 = chapters[1].photos[0]
    assert (p3.width, p3.height, p3.orientation) == (800, 600, "landscape")

    # accentColor/artFont stay null placeholders (theme stage fills, §4.1).
    for c in chapters:
        assert c.accentColor is None and c.artFont is None


def test_describe_call_uses_shared_simple_id_helpers(_describe_env, monkeypatch):
    from src.engine.simple_id import from_simple_at_paths as real_from_simple_at_paths
    from src.engine.simple_id import to_simple as real_to_simple
    from src.vision_provider import VisionSlot

    calls: list[tuple[str, Any]] = []

    def spy_to_simple(real_ids: list[str]):
        calls.append(("to_simple", list(real_ids)))
        return real_to_simple(real_ids)

    def spy_from_simple_at_paths(
        payload: Any,
        mapping: dict[str, str],
        *,
        value_paths: tuple[tuple[str, ...], ...],
        key_paths: tuple[tuple[str, ...], ...] = (),
    ):
        calls.append(("from_simple_at_paths", payload, dict(mapping), tuple(value_paths), tuple(key_paths)))
        return real_from_simple_at_paths(payload, mapping, value_paths=value_paths, key_paths=key_paths)

    parsed_payload = {
        "chapters": [
            {
                "description": "Spring morning walk.",
                "photoIds": ["1", "2"],
                "pages": [{"photoIds": ["1", "2"], "templateId": "mag-13"}],
                "scenes": {"1": "a woman in a red coat", "2": "snow on the old street"},
            }
        ]
    }

    async def fake_completion(**kwargs):
        return _completion(parsed_payload)

    monkeypatch.setattr(vision, "to_simple", spy_to_simple, raising=False)
    monkeypatch.setattr(vision, "from_simple_at_paths", spy_from_simple_at_paths, raising=False)
    monkeypatch.setattr(ai_client, "chat_completion", fake_completion)

    tree, _pages_by_chapter, _tokens = asyncio.run(
        vision._describe_call(
            VisionSlot(
                provider="test",
                base_url="http://vision.test",
                api_key="key",
                model="model",
                timeout_seconds=1,
                extra_body=None,
                response_format=None,
                supports_json_object=False,
            ),
            _v3_photos(2),
            "en",
            None,
            max_output_tokens=1024,
        )
    )

    assert ("to_simple", ["p1", "p2"]) in calls
    remap_calls = [call for call in calls if call[0] == "from_simple_at_paths"]
    assert len(remap_calls) == 1
    assert remap_calls[0][1] == parsed_payload
    assert remap_calls[0][2] == {"1": "p1", "2": "p2"}
    assert ("chapters", "*", "photoIds", "*") in remap_calls[0][3]
    assert ("chapters", "*", "pages", "*", "photoIds", "*") in remap_calls[0][3]
    assert ("chapters", "*", "scenes", "*") in remap_calls[0][4]
    assert [[p.photoId for p in chapter.photos] for chapter in tree.chapters] == [["p1", "p2"]]
    assert list(_pages_by_chapter["ch_1"][0]["images"].values()) == ["p1", "p2"]


def test_describe_call_simple_id_remap_does_not_rewrite_numeric_text(_describe_env, monkeypatch):
    from src.vision_provider import VisionSlot

    parsed_payload = {
        "chapters": [
            {
                "description": "1",
                "pages": [
                    {"photoIds": ["1"], "templateId": "mag-03"},
                    {"photoIds": ["2"], "templateId": "mag-03"},
                ],
                "scenes": {"1": "2", "2": "1"},
            }
        ]
    }

    async def fake_completion(**kwargs):
        return _completion(parsed_payload)

    monkeypatch.setattr(ai_client, "chat_completion", fake_completion)

    tree, pages_by_chapter, _tokens = asyncio.run(
        vision._describe_call(
            VisionSlot(
                provider="test",
                base_url="http://vision.test",
                api_key="key",
                model="model",
                timeout_seconds=1,
                extra_body=None,
                response_format=None,
                supports_json_object=False,
            ),
            _v3_photos(2),
            "en",
            None,
            max_output_tokens=1024,
        )
    )

    chapter = tree.chapters[0]
    assert chapter.description == "1"
    assert [[photo.photoId for photo in chapter.photos]] == [["p1", "p2"]]
    assert [photo.sceneDescription for photo in chapter.photos] == ["2", "1"]
    assert [list(page["images"].values()) for page in pages_by_chapter["ch_1"]] == [["p1"], ["p2"]]


def test_describe_simple_id_remap_strips_ids_only_on_selected_paths():
    from src.engine.simple_id import from_simple_at_paths

    payload = {
        "chapters": [
            {
                "description": " 1 ",
                "photoIds": [" 1 ", " 2 "],
                "pages": [{"photoIds": [" 1 "], "templateId": "mag-03"}],
                "scenes": {" 1 ": " 2 ", " 2 ": " 1 "},
                "note": " 2 ",
            }
        ]
    }

    remapped = from_simple_at_paths(
        payload,
        {"1": "p1", "2": "p2"},
        value_paths=vision._DESCRIBE_SIMPLE_VALUE_PATHS,
        key_paths=vision._DESCRIBE_SIMPLE_KEY_PATHS,
    )

    chapter = remapped["chapters"][0]
    assert chapter["description"] == " 1 "
    assert chapter["note"] == " 2 "
    assert chapter["photoIds"] == ["p1", "p2"]
    assert chapter["pages"][0]["photoIds"] == ["p1"]
    assert chapter["scenes"] == {"p1": " 2 ", "p2": " 1 "}


def test_describe_content_rejects_duplicate_photo_ids(_describe_env, monkeypatch):
    # The code must reject duplicate LLM-authored grouping, not silently keep the
    # first occurrence or patch in its own partition.
    payload = {
        "chapters": [
            {
                "description": "A.",
                "photoIds": ["p1", "p2"],
                "scenes": {"p1": "one", "p2": "two"},
            },
            {
                "description": "B.",
                "photoIds": ["p1", "p3"],
                "scenes": {"p1": "one again", "p3": "three"},
            },
        ]
    }

    async def fake_completion(**kwargs):
        return _completion(payload)

    monkeypatch.setattr(ai_client, "chat_completion", fake_completion)

    with pytest.raises(vision.VisionError, match="duplicated photoId"):
        asyncio.run(vision.describe_content(_v3_photos(3), language="en"))


def test_describe_content_rejects_omitted_photo_ids(_describe_env, monkeypatch):
    # Every input photo must appear once; omitted ids are invalid LLM output.
    payload = {
        "chapters": [
            {
                "description": "A.",
                "photoIds": ["p1", "p2"],
                "scenes": {"p1": "one", "p2": "two"},
            }
        ]
    }

    async def fake_completion(**kwargs):
        return _completion(payload)

    monkeypatch.setattr(ai_client, "chat_completion", fake_completion)

    with pytest.raises(vision.VisionError, match="omitted photoIds"):
        asyncio.run(vision.describe_content(_v3_photos(3), language="en"))


def test_describe_content_rejects_unknown_photo_ids(_describe_env, monkeypatch):
    # The model may only reference exact photoIds from the request manifest.
    payload = {
        "chapters": [
            {
                "description": "A.",
                "photoIds": ["p1", "p2", "p3", "p999"],
                "scenes": {"p1": "one", "p2": "two", "p3": "three", "p999": "unknown"},
            }
        ]
    }

    async def fake_completion(**kwargs):
        return _completion(payload)

    monkeypatch.setattr(ai_client, "chat_completion", fake_completion)

    with pytest.raises(vision.VisionError, match="unknown photoId"):
        asyncio.run(vision.describe_content(_v3_photos(3), language="en"))


def test_describe_content_rejects_missing_llm_authored_text(_describe_env, monkeypatch):
    """`description` and per-photo `sceneDescription` are LLM-authored fields.
    Missing values are invalid model output, not code-fill opportunities."""
    payload = {
        "chapters": [
            {
                "description": "Spring morning walk.",
                "photoIds": ["p1", "p2"],
                "scenes": {"p1": "a woman in a red coat"},
            },
            {
                "description": "",
                "photoIds": ["p3"],
                "scenes": {"p3": "a quiet teahouse"},
            },
        ]
    }

    async def fake_completion(**kwargs):
        return _completion(payload)

    monkeypatch.setattr(ai_client, "chat_completion", fake_completion)

    with pytest.raises(vision.VisionError):
        asyncio.run(vision.describe_content(_v3_photos(3), language="en"))


def test_describe_content_fails_over_to_ark_on_openai_5xx(_describe_env, monkeypatch):
    calls: list[str] = []

    async def fake_completion(**kwargs):
        model = kwargs["model"]
        calls.append(model)
        if model == "gpt-5.5-mini":
            raise ai_client.AIRequestError(
                "upstream_5xx status=503", status_code=503, kind="5xx"
            )
        # Failover slot = 火山 doubao; thinking-disabled, no json_object.
        assert model == "doubao-seed-1-6-vision-250815"
        assert kwargs.get("response_format") is None
        return _completion(_chapters_payload())

    monkeypatch.setattr(ai_client, "chat_completion", fake_completion)

    result = asyncio.run(vision.describe_content(_v3_photos(3), language="en"))

    # 先 GPT、自动降级火山: primary tried first, then failover.
    assert calls == ["gpt-5.5-mini", "doubao-seed-1-6-vision-250815"]
    assert result.provider == "ark"
    assert result.model == "doubao-seed-1-6-vision-250815"
    assert result.call_count == 2
    assert len(result.tree.chapters) == 2


def test_describe_content_does_not_failover_on_openai_4xx(_describe_env, monkeypatch):
    """Auth/model/request errors are configuration or request bugs, not
    5xx/timeout/deadline failover cases."""
    calls: list[str] = []

    async def fake_completion(**kwargs):
        calls.append(kwargs["model"])
        raise ai_client.AIRequestError(
            "upstream_4xx status=401", status_code=401, kind="4xx"
        )

    monkeypatch.setattr(ai_client, "chat_completion", fake_completion)

    with pytest.raises(vision.VisionError):
        asyncio.run(vision.describe_content(_v3_photos(2), language="en"))
    assert calls == ["gpt-5.5-mini"]


def test_describe_content_fails_over_when_primary_overruns_deadline(_describe_env, monkeypatch):
    """A slow-but-not-erroring primary that overruns describe_batch_deadline_seconds
    flips to 火山 (先 GPT、自动降级火山, deadline 数值可微调)."""
    monkeypatch.setenv("DESCRIBE_BATCH_DEADLINE_SECONDS", "1")  # tight deadline
    from src import settings as s

    s.reset_settings_cache()
    calls: list[str] = []

    async def fake_completion(**kwargs):
        model = kwargs["model"]
        calls.append(model)
        if model == "gpt-5.5-mini":
            await asyncio.sleep(5)  # overruns the 1s batch deadline → failover
            return _completion(_chapters_payload())
        return _completion(_chapters_payload())

    monkeypatch.setattr(ai_client, "chat_completion", fake_completion)

    result = asyncio.run(vision.describe_content(_v3_photos(3), language="en"))
    assert calls == ["gpt-5.5-mini", "doubao-seed-1-6-vision-250815"]
    assert result.provider == "ark"


def test_describe_content_raises_when_openai_unconfigured(monkeypatch):
    # Only the 火山 key is present. V3 describe-content must not silently switch
    # providers for a missing primary key; failover is for 5xx/timeouts/deadline.
    monkeypatch.setenv("AGENT_PIPELINE_MODE", "real")
    # primary IS the OpenAI slot here (vision_provider=openai); the test asserts a
    # missing OpenAI key errors out rather than silently failing over to 火山.
    monkeypatch.setenv("VISION_PROVIDER", "openai")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setenv("ARK_API_KEY", "fake_ark")
    from src import settings as s

    s.reset_settings_cache()
    try:
        calls: list[str] = []

        async def fake_completion(**kwargs):
            calls.append(kwargs["model"])
            return _completion(_chapters_payload())

        monkeypatch.setattr(ai_client, "chat_completion", fake_completion)

        with pytest.raises(vision.VisionError):
            asyncio.run(vision.describe_content(_v3_photos(2), language="en"))
        assert calls == []
    finally:
        s.reset_settings_cache()


def test_describe_content_raises_when_both_providers_fail(_describe_env, monkeypatch):
    async def fake_completion(**kwargs):
        raise ai_client.AIRequestError("upstream_5xx status=503", status_code=503, kind="5xx")

    monkeypatch.setattr(ai_client, "chat_completion", fake_completion)

    with pytest.raises(vision.VisionError):
        asyncio.run(vision.describe_content(_v3_photos(2), language="en"))


def test_describe_content_does_not_failover_on_unparseable_response(_describe_env, monkeypatch):
    """A malformed (non-JSON) response is NOT a transport failure: it propagates
    rather than burning the failover on the same bad-output class of bug."""
    calls: list[str] = []

    async def fake_completion(**kwargs):
        calls.append(kwargs["model"])
        return {"choices": [{"message": {"content": "not json at all"}}], "usage": {}}

    monkeypatch.setattr(ai_client, "chat_completion", fake_completion)

    with pytest.raises(vision.VisionError):
        asyncio.run(vision.describe_content(_v3_photos(2), language="en"))
    # Only the primary was hit; no failover attempt.
    assert calls == ["gpt-5.5-mini"]


# =============================================================================
# Unified path (single vision call returns chapters[]{ description, scenes,
# pages[]{ photoIds, templateId } }). The legacy flat-`photoIds` payloads above
# only exercise chaptering; these drive REAL per-page grouping + template choice
# through describe_content → _assemble_chapter_pages.
# =============================================================================


def _unified_completion(content: Any) -> dict[str, Any]:
    return _completion(content)


def test_describe_content_honors_model_pages_and_per_page_template(_describe_env, monkeypatch):
    """a. Honored happy path: a unified reply whose `pages` carry a LEGAL
    templateId per page → result.pages reflect the model's grouping AND its
    chosen templateId per page (not overridden), every photo covered exactly
    once, pageIndex contiguous from 0."""
    payload = {
        "chapters": [
            {
                "description": "Spring morning walk.",
                "scenes": {"p1": "red coat", "p2": "old street", "p3": "teahouse"},
                "pages": [
                    # page 0: two photos → mag-04 is a LEGAL 2-slot interior template.
                    {"photoIds": ["p1", "p2"], "templateId": "mag-04"},
                    # page 1: one photo → mag-03 is a LEGAL 1-slot interior template.
                    {"photoIds": ["p3"], "templateId": "mag-03"},
                ],
            }
        ]
    }

    async def fake_completion(**kwargs):
        return _unified_completion(payload)

    monkeypatch.setattr(ai_client, "chat_completion", fake_completion)

    result = asyncio.run(vision.describe_content(_v3_photos(3), language="en"))

    # Chapter membership = flatten(pages[].photoIds), in order.
    assert [[p.photoId for p in c.photos] for c in result.tree.chapters] == [
        ["p1", "p2", "p3"]
    ]
    # Model's per-page grouping honored on the flattened pages.
    assert [list(pg["images"].values()) for pg in result.pages] == [
        ["p1", "p2"],
        ["p3"],
    ]
    # Model's LEGAL per-page templateId honored (NOT overridden by the engine).
    assert [pg["templateId"] for pg in result.pages] == ["mag-04", "mag-03"]
    # pageIndex contiguous from 0.
    assert [pg["pageIndex"] for pg in result.pages] == [0, 1]
    # Coverage: every input photo placed exactly once across pages.
    placed = [pid for pg in result.pages for pid in pg["images"].values()]
    assert sorted(placed) == ["p1", "p2", "p3"]


def test_describe_content_clamps_illegal_page_template_keeps_others(_describe_env, monkeypatch):
    """b. Per-page template clamp: a page whose templateId is illegal for its
    photo count falls back to a deterministic legal pick_template_v3 choice,
    while OTHER pages keep their legal model choices."""
    from src.engine import skeleton_v3

    # mag-03 is a 1-slot template → ILLEGAL for a 2-photo page (legal_candidates
    # only widens capacity UP from N, never below; a 1-slot can't hold 2 photos).
    illegal_for_two = "mag-03"
    legal_for_one = "mag-03"  # the same 1-slot template is legal on a 1-photo page
    assert illegal_for_two not in {
        c["templateId"] for c in skeleton_v3.legal_candidates("interior", 2)
    }
    assert legal_for_one in {
        c["templateId"] for c in skeleton_v3.legal_candidates("interior", 1)
    }
    deterministic_two = skeleton_v3.pick_template_v3("interior", 2)

    payload = {
        "chapters": [
            {
                "description": "A day out.",
                "scenes": {"p1": "one", "p2": "two", "p3": "three"},
                "pages": [
                    # page 0: TWO photos but an illegal 1-slot templateId → clamp.
                    {"photoIds": ["p1", "p2"], "templateId": illegal_for_two},
                    # page 1: ONE photo with a legal 1-slot templateId → kept.
                    {"photoIds": ["p3"], "templateId": legal_for_one},
                ],
            }
        ]
    }

    async def fake_completion(**kwargs):
        return _unified_completion(payload)

    monkeypatch.setattr(ai_client, "chat_completion", fake_completion)

    result = asyncio.run(vision.describe_content(_v3_photos(3), language="en"))

    # Grouping preserved.
    assert [list(pg["images"].values()) for pg in result.pages] == [["p1", "p2"], ["p3"]]
    # Illegal page clamped to the deterministic legal pick; legal page untouched.
    assert result.pages[0]["templateId"] == deterministic_two
    assert result.pages[0]["templateId"] != illegal_for_two
    assert result.pages[1]["templateId"] == legal_for_one
    # No photo lost by the clamp.
    placed = [pid for pg in result.pages for pid in pg["images"].values()]
    assert sorted(placed) == ["p1", "p2", "p3"]


def test_describe_content_chapter_pages_malformed_falls_back_to_baseline(_describe_env, monkeypatch):
    """c. Per-chapter malformed pages → that chapter degrades to the
    partition_photos_v3 baseline covering ALL its photos (no photo lost), while
    OTHER chapters keep their honored model pages."""
    from src.engine import skeleton_v3

    cap = skeleton_v3.max_capacity("interior")  # interior page hard cap (9)
    # Broken chapter has cap+1 photos in ONE page → over-capacity. Membership
    # (flatten of pages) is intact (no dup/omit/unknown), so it passes the tree
    # guards and reaches _assemble_chapter_pages, where validate_grouping fails on
    # the over-capacity page → chapter-level partition_photos_v3 baseline.
    broken_n = cap + 1
    good_ids = ["p1", "p2"]
    broken_ids = [f"p{i + 3}" for i in range(broken_n)]  # p3..p(broken_n+2)
    total = 2 + broken_n

    payload = {
        "chapters": [
            {
                "description": "Good chapter.",
                "scenes": {pid: f"scene {pid}" for pid in good_ids},
                "pages": [
                    {"photoIds": ["p1"], "templateId": "mag-03"},
                    {"photoIds": ["p2"], "templateId": "mag-03"},
                ],
            },
            {
                "description": "Broken chapter.",
                "scenes": {pid: f"scene {pid}" for pid in broken_ids},
                # Malformed: a single page over the interior capacity cap →
                # validate_grouping fails → chapter-level baseline (no photo lost).
                "pages": [{"photoIds": list(broken_ids), "templateId": "mag-03"}],
            },
        ]
    }

    async def fake_completion(**kwargs):
        return _unified_completion(payload)

    monkeypatch.setattr(ai_client, "chat_completion", fake_completion)

    result = asyncio.run(vision.describe_content(_v3_photos(total), language="en"))

    chapters = result.tree.chapters
    assert [c.chapterId for c in chapters] == ["ch_1", "ch_2"]

    # Map flattened pages back to chapters via membership to assert per-chapter.
    ch1_ids = {p.photoId for p in chapters[0].photos}
    ch2_ids = {p.photoId for p in chapters[1].photos}
    ch1_pages = [pg for pg in result.pages if set(pg["images"].values()) <= ch1_ids]
    ch2_pages = [pg for pg in result.pages if set(pg["images"].values()) <= ch2_ids]

    # Good chapter UNAFFECTED: model pages honored (two single-photo mag-03 pages).
    assert [list(pg["images"].values()) for pg in ch1_pages] == [["p1"], ["p2"]]
    assert [pg["templateId"] for pg in ch1_pages] == ["mag-03", "mag-03"]

    # Broken chapter: degraded to the deterministic partition baseline that
    # covers ALL its photos with no loss (cap+1 → split into cap + 1).
    baseline = [
        skeleton_v3.build_page_v3("interior", chunk)
        for chunk in skeleton_v3.partition_photos_v3(broken_ids, category="interior")
    ]
    assert [list(pg["images"].values()) for pg in ch2_pages] == [
        list(pg["images"].values()) for pg in baseline
    ]
    # The broken chapter is NOT one over-capacity page anymore — it was healed.
    assert all(len(pg["images"]) <= cap for pg in ch2_pages)
    # Whole-book coverage: no photo lost despite the malformed chapter.
    placed = [pid for pg in result.pages for pid in pg["images"].values()]
    assert sorted(placed) == sorted(p.photoId for p in _v3_photos(total))
    # pageIndex contiguous across the whole book.
    assert [pg["pageIndex"] for pg in result.pages] == list(range(len(result.pages)))


def test_describe_content_manifest_carries_takenat_but_never_gps(_describe_env):
    """§3 privacy: the user turn lists photoId + takenAt as the分章 signal and
    contains NO GPS/coordinate/place token."""
    photos = _v3_photos(2)
    parts = vision._build_v3_user_content(photos, "a trip")
    manifest = parts[0]["text"]

    assert "p1" in manifest and "p2" in manifest
    assert "2024-03-01T08:30:00" in manifest  # takenAt signal present
    lowered = manifest.lower()
    for banned in ("lat", "lng", "latitude", "longitude", "gps", "coordinate", "place="):
        assert banned not in lowered, banned
