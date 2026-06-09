"""Verifies docs/agent/design.md §9 — sensitive fields never leak to logs.

We re-configure structlog with `cache_logger_on_first_use=False` for these
tests via a module-scoped fixture, then capture stdout."""

import json

import pytest
import structlog

from src.logging_config import _redact_processor, request_id_var


def _run(event_dict: dict) -> dict:
    """Drive the redact processor directly — bypasses structlog plumbing
    so we can assert on the output dict without stdout games."""
    return _redact_processor(None, None, dict(event_dict))


class TestRedaction:
    def test_base64_key_value_redacted(self):
        out = _run({"event": "evt", "base64": "data:image/png;base64,SECRETBYTES"})
        assert out["base64"] == "<redacted>"

    def test_prompt_key_value_redacted(self):
        out = _run({"event": "evt", "prompt": "user's secret text here"})
        assert out["prompt"] == "<redacted>"

    def test_api_key_redacted(self):
        out = _run({"event": "evt", "api_key": "sk-real-secret"})
        assert out["api_key"] == "<redacted>"

    def test_authorization_header_key_redacted(self):
        out = _run({"event": "evt", "Authorization": "Bearer abc.def.ghi"})
        assert out["Authorization"] == "<redacted>"

    def test_bearer_inline_scrubbed_in_safe_key(self):
        out = _run({"event": "evt", "note": "failed Authorization: Bearer abc.def.ghi"})
        assert "abc.def.ghi" not in out["note"]
        assert "Bearer <redacted>" in out["note"]

    def test_data_url_inline_scrubbed_in_safe_key(self):
        out = _run({"event": "evt", "note": "raw=data:image/jpeg;base64,LEAKED"})
        assert "LEAKED" not in out["note"]
        assert "data:image/<redacted>" in out["note"]

    def test_safe_fields_passthrough(self):
        out = _run({"event": "evt", "requestId": "r1", "stage": "vision", "progress": 50})
        assert out["requestId"] == "r1"
        assert out["stage"] == "vision"
        assert out["progress"] == 50

    def test_nested_dict_values_scrubbed(self):
        out = _run(
            {
                "event": "evt",
                "payload": {
                    "headers": {"Authorization": "Bearer xyz"},
                    "snippet": "data:image/jpeg;base64,ABC",
                },
            }
        )
        # Nested values are scrubbed by string content (regex), not key match.
        assert "xyz" not in json.dumps(out["payload"])
        assert "ABC" not in json.dumps(out["payload"])

    def test_email_key_redacted(self):
        out = _run({"event": "evt", "user_email": "a@b.com"})
        assert out["user_email"] == "<redacted>"

    def test_prompt_exact_key_redacted(self):
        out = _run({"event": "evt", "prompt": "user's secret prompt"})
        assert out["prompt"] == "<redacted>"

    def test_prompt_tokens_not_redacted(self):
        # "prompt" must not substring-match the allowed numeric usage fields.
        out = _run({"event": "evt", "prompt_tokens": 1820, "completion_tokens": 142})
        assert out["prompt_tokens"] == 1820
        assert out["completion_tokens"] == 142

    def test_prompt_length_not_redacted(self):
        # promptLength is explicitly an allowed field in design.md §9.
        out = _run({"event": "evt", "promptLength": 42})
        assert out["promptLength"] == 42

    # ── invariant 11 / D-GPS: coordinate + EXIF keys are a pre-set red line ──

    @pytest.mark.parametrize(
        "key,value",
        [
            ("lat", 37.7749),
            ("lng", -122.4194),
            ("latitude", 37.7749),
            ("longitude", -122.4194),
            ("gps", "37.7749,-122.4194"),
            ("coordinates", [37.7749, -122.4194]),
            ("place", "San Francisco, CA"),
            ("LAT", 37.7749),  # case-insensitive
            ("Coordinates", {"lat": 1, "lng": 2}),
        ],
    )
    def test_geo_keys_redacted(self, key, value):
        out = _run({"event": "evt", key: value})
        assert out[key] == "<redacted>", f"{key} must be redacted (invariant 11)"

    def test_exif_block_redacted(self):
        # The raw EXIF block may carry an embedded GPS structure — never log it.
        out = _run({"event": "evt", "exif": {"takenAt": "2020-01-01", "gps": [1, 2]}})
        assert out["exif"] == "<redacted>"

    def test_taken_at_not_redacted(self):
        # takenAt is low-sensitivity time used for ordering/grouping — allowed.
        out = _run({"event": "evt", "takenAt": "2020-01-01T00:00:00Z"})
        assert out["takenAt"] == "2020-01-01T00:00:00Z"

    def test_geo_substrings_do_not_overmatch(self):
        # The short geo keys are EXACT-match, so benign fields that merely contain
        # "lat"/"place" as a substring must pass through untouched.
        out = _run(
            {
                "event": "evt",
                "latency_ms": 12,
                "translated": True,
                "placeholder_count": 3,
                "template_id": "mag-02",
            }
        )
        assert out["latency_ms"] == 12
        assert out["translated"] is True
        assert out["placeholder_count"] == 3
        assert out["template_id"] == "mag-02"
