"""Agent-bound simple ID mapping helpers.

Simple IDs are short, deterministic aliases for model-facing payloads. They must
not cross the Agent boundary; callers translate back to real IDs before returning
or persisting data.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

PathPattern = tuple[str, ...]


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


def _matches_path(path: tuple[str, ...], patterns: Sequence[PathPattern]) -> bool:
    return any(
        len(path) == len(pattern)
        and all(expected == "*" or expected == actual for expected, actual in zip(pattern, path, strict=True))
        for pattern in patterns
    )


def from_simple_at_paths(
    payload: Any,
    mapping: dict[str, str],
    *,
    value_paths: Sequence[PathPattern],
    key_paths: Sequence[PathPattern] = (),
) -> Any:
    """Replace simple IDs only at schema-selected JSON paths.

    `from_simple` is intentionally broad for payloads made solely of IDs. Mixed
    model JSON also contains free text, so callers can use this helper to keep
    ID remapping shared-owned while limiting replacement to known ID fields.
    Lists use `"*"` as their path segment; key paths match dictionary keys.
    """

    def walk(node: Any, path: tuple[str, ...]) -> Any:
        if isinstance(node, str):
            return mapping.get(node.strip(), node) if _matches_path(path, value_paths) else node
        if isinstance(node, list):
            return [walk(item, (*path, "*")) for item in node]
        if isinstance(node, tuple):
            return tuple(walk(item, (*path, "*")) for item in node)
        if isinstance(node, dict):
            out: dict[Any, Any] = {}
            for key, value in node.items():
                key_path = (*path, str(key))
                next_key = mapping.get(key.strip(), key) if isinstance(key, str) and _matches_path(key_path, key_paths) else key
                out[next_key] = walk(value, key_path)
            return out
        return node

    return walk(payload, ())
