"""Co-located prompt loader (replaces the central `skills.load_skill`).

Each agent keeps its prompt `.md` assets next to its `handler.py`; code loads
one by explicit path so the prompt lives with the capability that uses it.
`{KEY}` placeholders are filled via `str.replace` (NOT `str.format`) so JSON
braces in a prompt body are left untouched. Loaded text is `lru_cache`d by path.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

_COMMON_DIR = Path(__file__).resolve().parent / "common"


@lru_cache(maxsize=None)
def _read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8").strip()


def load_prompt(
    path: Path | str, *, common: tuple[str, ...] = (), **slots: str
) -> str:
    """Compose an agent prompt: the agent-specific body first, then the shared
    `common/<name>.md` fragments the agent DECLARES (output format / grounding /
    privacy — authored once, reused). Each agent picks only the commons it needs.
    `{KEY}` placeholders are filled via `str.replace` (NOT `str.format`, so JSON
    braces survive) across the whole composed text."""
    parts = [_read(str(path))]
    parts += [_read(str(_COMMON_DIR / f"{name}.md")) for name in common]
    text = "\n\n".join(parts)
    for key, value in slots.items():
        text = text.replace(f"{{{key}}}", value)
    return text
