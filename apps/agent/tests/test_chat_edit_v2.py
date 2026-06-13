"""Tests for the Stage 6 v2 edit service (rebuild-tech-plan §1.5 / design.md §13).

Covers the four pieces the issue calls out: a single DeepSeek call producing a
layoutPatch, the pickTemplate re-template tool, ``validate_v2`` (with the v2
page bound and the cover/ending hero exemption), and the one-shot repair loop.
DeepSeek is never called — the model response is injected via the ``complete``
hook, mirroring the chapter-chat tests.
"""

import json

import pytest

from src.schemas import Magazine, Page, PhotoAnalysis
from src.schemas_v2 import LayoutV2, V2EditRequest
from src.services import ai_client, chat_edit_v2
from src.services.chat_edit_v2 import V2EditError


# --------------------------------------------------------------------------- #
# fixtures / helpers                                                           #
# --------------------------------------------------------------------------- #


def _photo(pid: str, *, quality: str, orientation: str) -> PhotoAnalysis:
    return PhotoAnalysis(
        photoId=pid,
        description=f"photo {pid}",
        tags=["t"],
        quality=quality,  # type: ignore[arg-type]
        orientation=orientation,  # type: ignore[arg-type]
    )


def _layout() -> LayoutV2:
    """Valid 4-page album: cover(mag-13) → chapter(mag-19) → chapter(mag-12) →
    ending(mag-17). p2 is used twice (chapter + ending), everyone else once."""
    photos = [
        _photo("p1", quality="hero", orientation="landscape"),
        _photo("p2", quality="detail", orientation="portrait"),
        _photo("p3", quality="detail", orientation="square"),
        _photo("p4", quality="fill", orientation="landscape"),
    ]
    pages = [
        Page(pageIndex=0, templateId="mag-13", images={"image": "p1"},
             texts={"title": "Kyoto", "issue": "YUJEE · 01"}),
        Page(pageIndex=1, templateId="mag-19", images={"image": "p4"},
             texts={"intro": "A quiet street."}),
        Page(pageIndex=2, templateId="mag-12",
             images={"imageTop": "p3", "imageBottom": "p2"},
             texts={"num1": "02", "num2": "03"}),
        Page(pageIndex=3, templateId="mag-17", images={"image": "p2"},
             texts={"name1": "The End"}),
    ]
    return LayoutV2(
        magazine=Magazine(title="Trip", style="warm-film", language="en"),
        photos=photos,
        pages=pages,
    )


def _req(layout: LayoutV2 | None = None, *, user_message: str = "edit it") -> V2EditRequest:
    return V2EditRequest(
        albumId="alb_1",
        currentLayout=layout or _layout(),
        history=[],
        userMessage=user_message,
        language="en",
    )


def _envelope(payload: dict, *, prompt_tokens: int = 11, completion_tokens: int = 7) -> dict:
    return {
        "choices": [{"message": {"content": json.dumps(payload)}}],
        "usage": {"prompt_tokens": prompt_tokens, "completion_tokens": completion_tokens},
    }


def _complete_returning(*payloads: dict):
    """Build a `complete` hook that returns the given payloads in order."""
    envelopes = iter(_envelope(p) for p in payloads)

    async def _complete(**_kwargs):
        return next(envelopes)

    return _complete


# --------------------------------------------------------------------------- #
# _coerce_response                                                             #
# --------------------------------------------------------------------------- #


class TestCoerceResponse:
    def test_missing_reply_rejected(self):
        with pytest.raises(V2EditError):
            chat_edit_v2._coerce_response({"layoutPatch": [{"pageIndex": 0}]})

    def test_empty_patch_rejected(self):
        with pytest.raises(V2EditError):
            chat_edit_v2._coerce_response({"assistantReply": "x", "layoutPatch": []})

    def test_non_object_rejected(self):
        with pytest.raises(V2EditError):
            chat_edit_v2._coerce_response(["not", "a", "dict"])

    def test_negative_page_index_rejected(self):
        with pytest.raises(V2EditError):
            chat_edit_v2._coerce_response(
                {"assistantReply": "x", "layoutPatch": [{"pageIndex": -1}]}
            )

    def test_retemplate_flag_parsed(self):
        reply, entries = chat_edit_v2._coerce_response(
            {"assistantReply": "ok", "layoutPatch": [{"pageIndex": 2, "retemplate": True}]}
        )
        assert reply == "ok"
        assert entries[0]["retemplate"] is True


# --------------------------------------------------------------------------- #
# _apply_patch                                                                 #
# --------------------------------------------------------------------------- #


class TestApplyPatch:
    def test_text_only_patch_preserves_other_pages(self):
        layout = _layout()
        _, raw = chat_edit_v2._coerce_response(
            {"assistantReply": "ok", "layoutPatch": [{"pageIndex": 0, "texts": {"title": "Nara"}}]}
        )
        patch = chat_edit_v2._resolve_entries(layout, raw, album_id="alb_1", attempt=0)
        patched = chat_edit_v2._apply_patch(layout, patch)
        assert patched.pages[0].texts["title"] == "Nara"
        assert patched.pages[2].images == {"imageTop": "p3", "imageBottom": "p2"}
        assert chat_edit_v2.validate_v2(patched) is None

    def test_template_change_requires_full_replacement(self):
        layout = _layout()
        _, raw = chat_edit_v2._coerce_response(
            {"assistantReply": "swap", "layoutPatch": [{"pageIndex": 2, "templateId": "mag-15"}]}
        )
        patch = chat_edit_v2._resolve_entries(layout, raw, album_id="alb_1", attempt=0)
        with pytest.raises(V2EditError):
            chat_edit_v2._apply_patch(layout, patch)

    def test_unknown_page_index_rejected(self):
        layout = _layout()
        _, raw = chat_edit_v2._coerce_response(
            {"assistantReply": "edit", "layoutPatch": [{"pageIndex": 99, "texts": {"x": "y"}}]}
        )
        with pytest.raises(V2EditError):
            chat_edit_v2._resolve_entries(layout, raw, album_id="alb_1", attempt=0)


# --------------------------------------------------------------------------- #
# validate_v2                                                                  #
# --------------------------------------------------------------------------- #


class TestValidateV2:
    def test_valid_layout_passes(self):
        assert chat_edit_v2.validate_v2(_layout()) is None

    def test_unused_photo_caught(self):
        layout = _layout()
        # Replace page 1's only use of p4 with p1 → p4 becomes unused.
        layout.pages[1] = Page(pageIndex=1, templateId="mag-19", images={"image": "p1"}, texts={})
        v = chat_edit_v2.validate_v2(layout)
        assert v is not None and "unused" in v

    def test_reuse_over_twice_caught(self):
        # p2 appears 3 times (chapter + chapter + ending); every photo stays used
        # so the reuse cap is the only violation.
        photos = [
            _photo("p1", quality="hero", orientation="landscape"),
            _photo("p2", quality="detail", orientation="portrait"),
            _photo("p3", quality="detail", orientation="square"),
        ]
        pages = [
            Page(pageIndex=0, templateId="mag-13", images={"image": "p1"}, texts={}),
            Page(pageIndex=1, templateId="mag-12",
                 images={"imageTop": "p3", "imageBottom": "p2"}, texts={}),
            Page(pageIndex=2, templateId="mag-19", images={"image": "p2"}, texts={}),
            Page(pageIndex=3, templateId="mag-17", images={"image": "p2"}, texts={}),
        ]
        layout = LayoutV2(
            magazine=Magazine(title="T", style="warm-film", language="en"),
            photos=photos, pages=pages,
        )
        v = chat_edit_v2.validate_v2(layout)
        assert v is not None and "reused more than 2" in v

    def test_first_page_must_be_cover(self):
        layout = _layout()
        layout.pages[0] = Page(pageIndex=0, templateId="mag-19", images={"image": "p1"}, texts={})
        v = chat_edit_v2.validate_v2(layout)
        assert v is not None and "must be cover" in v

    def test_fill_in_hero_on_chapter_page_rejected(self):
        # p4 (fill) into mag-12's imageBottom (a hero/detail slot) on a chapter page.
        photos = [
            _photo("p1", quality="hero", orientation="landscape"),
            _photo("p2", quality="detail", orientation="square"),
            _photo("p4", quality="fill", orientation="portrait"),
        ]
        pages = [
            Page(pageIndex=0, templateId="mag-13", images={"image": "p1"}, texts={}),
            Page(pageIndex=1, templateId="mag-12",
                 images={"imageTop": "p2", "imageBottom": "p4"}, texts={}),
            Page(pageIndex=2, templateId="mag-17", images={"image": "p2"}, texts={}),
        ]
        layout = LayoutV2(
            magazine=Magazine(title="T", style="warm-film", language="en"),
            photos=photos, pages=pages,
        )
        v = chat_edit_v2.validate_v2(layout)
        assert v is not None and "fill" in v and "hero" in v

    def test_fill_in_hero_exempt_on_cover_and_ending(self):
        # Same fill-in-hero placement, but on the cover (page 0) and ending
        # (last page) — §4.4 exempts both, so the layout is valid.
        photos = [
            _photo("pf", quality="fill", orientation="landscape"),
            _photo("pd", quality="detail", orientation="portrait"),
        ]
        pages = [
            Page(pageIndex=0, templateId="mag-13", images={"image": "pf"}, texts={}),
            Page(pageIndex=1, templateId="mag-17", images={"image": "pd"}, texts={}),
        ]
        layout = LayoutV2(
            magazine=Magazine(title="T", style="warm-film", language="en"),
            photos=photos, pages=pages,
        )
        assert chat_edit_v2.validate_v2(layout) is None

    def test_pages_above_v1_cap_allowed(self):
        # 17 pages would fail the v1 [1,16] bound; the v2 bound is [1,48].
        photos = [_photo("p0", quality="hero", orientation="landscape")]
        photos += [_photo(f"f{i}", quality="fill", orientation="landscape") for i in range(15)]
        pages = [Page(pageIndex=0, templateId="mag-13", images={"image": "p0"}, texts={})]
        for i in range(15):
            pages.append(
                Page(pageIndex=i + 1, templateId="mag-19", images={"image": f"f{i}"}, texts={})
            )
        pages.append(Page(pageIndex=16, templateId="mag-17", images={"image": "p0"}, texts={}))
        layout = LayoutV2(
            magazine=Magazine(title="T", style="warm-film", language="en"),
            photos=photos, pages=pages,
        )
        assert len(layout.pages) == 17
        assert chat_edit_v2.validate_v2(layout) is None


# --------------------------------------------------------------------------- #
# re-template (pickTemplate tool)                                              #
# --------------------------------------------------------------------------- #


class TestRetemplate:
    def test_retemplate_picks_a_different_legal_template(self):
        layout = _layout()
        _, raw = chat_edit_v2._coerce_response(
            {"assistantReply": "new layout", "layoutPatch": [{"pageIndex": 2, "retemplate": True}]}
        )
        patch = chat_edit_v2._resolve_entries(layout, raw, album_id="alb_1", attempt=0)
        entry = patch[0]
        assert entry.templateId is not None and entry.templateId != "mag-12"
        # Every image slot of the new template is filled with the page's photos.
        assert set(entry.images.values()) == {"p3", "p2"}
        patched = chat_edit_v2._apply_patch(layout, patch)
        assert chat_edit_v2.validate_v2(patched) is None

    def test_retemplate_is_deterministic_for_a_given_attempt(self):
        layout = _layout()
        _, raw = chat_edit_v2._coerce_response(
            {"assistantReply": "x", "layoutPatch": [{"pageIndex": 2, "retemplate": True}]}
        )
        a = chat_edit_v2._resolve_entries(layout, raw, album_id="alb_1", attempt=0)
        b = chat_edit_v2._resolve_entries(layout, raw, album_id="alb_1", attempt=0)
        assert a[0].templateId == b[0].templateId

    def test_retemplate_cover_stays_a_cover(self):
        layout = _layout()
        _, raw = chat_edit_v2._coerce_response(
            {"assistantReply": "new cover", "layoutPatch": [{"pageIndex": 0, "retemplate": True}]}
        )
        patch = chat_edit_v2._resolve_entries(layout, raw, album_id="alb_1", attempt=0)
        entry = patch[0]
        assert entry.templateId != "mag-13"
        from src import templates as registry
        assert registry.get(entry.templateId)["slot"] == "cover"
        patched = chat_edit_v2._apply_patch(layout, patch)
        assert chat_edit_v2.validate_v2(patched) is None

    def test_retemplate_ending_falls_back_to_lone_closing(self):
        # The closing use-case has a single template (mag-17); excluding it leaves
        # an empty pool, so pickTemplate falls back to the legal pool (no raise)
        # and the page keeps mag-17 with its texts preserved.
        layout = _layout()
        _, raw = chat_edit_v2._coerce_response(
            {"assistantReply": "redo ending", "layoutPatch": [{"pageIndex": 3, "retemplate": True}]}
        )
        patch = chat_edit_v2._resolve_entries(layout, raw, album_id="alb_1", attempt=0)
        entry = patch[0]
        assert entry.templateId == "mag-17"
        assert entry.texts.get("name1") == "The End"  # preserved, not rekeyed
        patched = chat_edit_v2._apply_patch(layout, patch)
        assert chat_edit_v2.validate_v2(patched) is None

    def test_retemplate_unknown_photo_rejected(self):
        layout = _layout()
        _, raw = chat_edit_v2._coerce_response(
            {
                "assistantReply": "x",
                "layoutPatch": [
                    {"pageIndex": 2, "retemplate": True, "images": {"slot": "ghost"}}
                ],
            }
        )
        with pytest.raises(V2EditError):
            chat_edit_v2._resolve_entries(layout, raw, album_id="alb_1", attempt=0)


# --------------------------------------------------------------------------- #
# run() — full round-trip                                                      #
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
class TestRun:
    async def test_text_edit_round_trip(self):
        complete = _complete_returning(
            {"assistantReply": "Renamed it.", "layoutPatch": [{"pageIndex": 0, "texts": {"title": "Nara"}}]}
        )
        res = await chat_edit_v2.run(_req(), complete=complete)
        assert res.assistantReply == "Renamed it."
        assert len(res.layoutPatch) == 1
        assert res.layoutPatch[0].texts["title"] == "Nara"
        assert res.usage.repairAttempts == 0
        assert res.usage.planningInputTokens == 11
        assert res.usage.planningOutputTokens == 7

    async def test_retemplate_round_trip_resolves_concrete_template(self):
        complete = _complete_returning(
            {"assistantReply": "Changed the layout.", "layoutPatch": [{"pageIndex": 2, "retemplate": True}]}
        )
        res = await chat_edit_v2.run(_req(), complete=complete)
        assert res.layoutPatch[0].templateId not in (None, "mag-12")
        assert res.usage.repairAttempts == 0

    async def test_repair_after_invalid_first_response(self):
        # First response drops p4's only placement (unused photo) → fails
        # validate_v2; the repair returns a valid no-op text edit.
        complete = _complete_returning(
            {"assistantReply": "bad", "layoutPatch": [{"pageIndex": 1, "images": {"image": "p1"}}]},
            {"assistantReply": "fixed", "layoutPatch": [{"pageIndex": 0, "texts": {"title": "OK"}}]},
        )
        res = await chat_edit_v2.run(_req(), complete=complete)
        assert res.assistantReply == "fixed"
        assert res.usage.repairAttempts == 1
        # tokens accumulate across both calls
        assert res.usage.planningInputTokens == 22

    async def test_two_failures_raise(self):
        bad = {"assistantReply": "bad", "layoutPatch": [{"pageIndex": 1, "images": {"image": "p1"}}]}
        complete = _complete_returning(bad, bad)
        with pytest.raises(V2EditError):
            await chat_edit_v2.run(_req(), complete=complete)

    async def test_upstream_error_mapped(self):
        async def _complete(**_kwargs):
            raise ai_client.AIRequestError("network down")

        with pytest.raises(V2EditError):
            await chat_edit_v2.run(_req(), complete=_complete)
