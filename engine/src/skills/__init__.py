"""Prompt loader.

各 workflow 的 prompt 正文(system)就在各自模块目录的 `<name>.md`,用 `load_prompt(path)` 加载。

写作/排版/主题这类共享技能的**单一真相源**是 `packages/contracts/skills/<name>/SKILL.md`
(带 frontmatter,design-agent 直接消费),engine 侧不读。若将来要让 engine workflow 也复用,
需在这里加一个读 `<name>/SKILL.md` 并剥掉 frontmatter 的加载器——那会改动排版 AI 的输入,
属行为变更,另行评估。

`{KEY}` 占位符用 `str.replace`(不是 `str.format`)填充,所以 prompt 里 JSON 示例的
`{ }` 不会被动到。加载文本按路径 `lru_cache`。
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path


@lru_cache(maxsize=None)
def _read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8").strip()


def load_prompt(path: Path | str, **slots: str) -> str:
    """Compose an agent prompt.

    读取 agent contract 正文,再把 `{KEY}` 占位符逐个 `str.replace` 填充,
    所以正文里的 JSON 花括号不受影响。
    """
    text = _read(str(path))
    for key, value in slots.items():
        text = text.replace(f"{{{key}}}", value)
    return text
