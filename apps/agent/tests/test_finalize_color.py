from __future__ import annotations

import pytest
from pydantic import TypeAdapter

from src.engine.finalize_color import finalize_color
from src.schemas import AccentColor

_ACCENT = TypeAdapter(AccentColor)


@pytest.mark.parametrize(
    ("generic", "expected"),
    [
        ("#abc", "#AABBCC"),
        ("abc", "#AABBCC"),
        ("  #a1b2c3  ", "#A1B2C3"),
        ("A1B2C3", "#A1B2C3"),
    ],
)
def test_finalize_color_normalizes_hex_to_uppercase_six_digit(generic: str, expected: str):
    result = finalize_color(generic)

    assert result == expected
    assert _ACCENT.validate_python(result) == result


@pytest.mark.parametrize("generic", [None, "", "#12", "#abcd", "red", object()])
def test_finalize_color_falls_back_for_invalid_values(generic: object):
    assert finalize_color(generic) == "#4A5568"  # type: ignore[arg-type]


def test_finalize_color_never_raises_on_unexpected_parser_errors():
    class BadStr(str):
        def strip(self, *args, **kwargs):  # noqa: ANN002, ANN003
            raise RuntimeError("parser failed")

    assert finalize_color(BadStr("#abc")) == "#4A5568"
