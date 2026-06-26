"""Agent-bound simple ID mapping helpers.

Simple IDs are short, deterministic aliases for model-facing payloads. They must
not cross the Agent boundary; callers translate back to real IDs before returning
or persisting data.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any


def to_simple(real_ids: Sequence[str]) -> tuple[list[str], dict[str, str]]:
    """real_ids -> (["1", "2", ...], {"1": realId, ...}).

    Simple IDs are allocated in input order and always start at "1".
    """
    simple_ids = [str(idx) for idx in range(1, len(real_ids) + 1)]
    return simple_ids, dict(zip(simple_ids, real_ids, strict=True))


def from_simple(payload: Any, mapping: dict[str, str]) -> Any:
    """Recursively replace simple IDs in payload with real IDs.

    Unknown IDs are preserved. Dict keys and values are both translated because
    model payloads can use simple IDs in either position.
    """
    if isinstance(payload, str):
        return mapping.get(payload, payload)
    if isinstance(payload, list):
        return [from_simple(item, mapping) for item in payload]
    if isinstance(payload, tuple):
        return tuple(from_simple(item, mapping) for item in payload)
    if isinstance(payload, dict):
        return {
            from_simple(key, mapping): from_simple(value, mapping)
            for key, value in payload.items()
        }
    return payload
