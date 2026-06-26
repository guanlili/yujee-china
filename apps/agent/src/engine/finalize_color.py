"""Shared final color normalization for design-color outputs."""

from __future__ import annotations

from typing import TypeAlias

GenericColor: TypeAlias = str

_FALLBACK_ACCENT = "#4A5568"
_HEX_DIGITS = frozenset("0123456789abcdefABCDEF")
_HEX6_LEN = 6


def finalize_color(generic: GenericColor) -> str:
    """Generic design color -> final '#RRGGBB' uppercase.

    The algorithm is intentionally conservative while the final color pipeline is
    boss-pending: only hex-like input is accepted, 3-digit hex expands to 6, and
    every invalid/unparseable input falls back without raising.
    """
    try:
        if not isinstance(generic, str):
            return _FALLBACK_ACCENT
        value = generic.strip().lstrip("#")
        if not value or not all(ch in _HEX_DIGITS for ch in value):
            return _FALLBACK_ACCENT
        if len(value) == 3:
            value = "".join(ch * 2 for ch in value)
        if len(value) != _HEX6_LEN:
            return _FALLBACK_ACCENT
        return f"#{value.upper()}"
    except Exception:
        return _FALLBACK_ACCENT
