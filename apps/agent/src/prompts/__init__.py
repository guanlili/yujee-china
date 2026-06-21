"""Co-located prompt loader (replaces the central `skills.load_skill`).

Each agent keeps its prompt `.md` assets next to its `handler.py`; code loads
one by explicit path so the prompt lives with the capability that uses it.
`{KEY}` placeholders are filled via `str.replace` (NOT `str.format`) so JSON
braces in a prompt body are left untouched. Loaded text is `lru_cache`d by path.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path


@lru_cache(maxsize=None)
def _read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8").strip()


def load_prompt(path: Path | str, **slots: str) -> str:
    text = _read(str(path))
    for key, value in slots.items():
        text = text.replace(f"{{{key}}}", value)
    return text
