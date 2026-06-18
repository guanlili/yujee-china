"""V3 skills = prompt assets loaded by the recognition model (architecture §4 /
§6.8 第 2 条). Each skill is a `.md` file in this directory holding ONE prompt
template; code loads it by name and fills `{PLACEHOLDER}` slots. Keeping prompts
as standalone files (not inlined Python strings) is the whole point — they are
人工统一维护 in one place so prompt tuning never touches engine code.

Loaded text is cached; placeholders are simple `{NAME}` tokens substituted via
str.replace (NOT str.format) so the JSON braces in a prompt body are left alone."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

_SKILLS_DIR = Path(__file__).resolve().parent


class SkillNotFoundError(FileNotFoundError):
    """A skill prompt asset is missing from apps/agent/src/skills/."""


@lru_cache(maxsize=None)
def _load_raw(name: str) -> str:
    path = _SKILLS_DIR / f"{name}.md"
    if not path.is_file():
        raise SkillNotFoundError(f"skill prompt asset not found: {path.name}")
    return path.read_text(encoding="utf-8").strip()


def load_skill(name: str, **slots: str) -> str:
    """Return the skill prompt for `name`, with each `{KEY}` placeholder replaced
    by the matching keyword value. Unknown placeholders are left untouched (so a
    typo surfaces as a literal token in the prompt rather than a crash)."""
    text = _load_raw(name)
    for key, value in slots.items():
        text = text.replace(f"{{{key}}}", value)
    return text
