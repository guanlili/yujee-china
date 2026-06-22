"""Prompt loader (replaces the central `skills.load_skill`).

按稳定性切分 prompt 的归属:
  * 固定结构(任务定义 + 输出 JSON 形状 + 字段契约)co-located 在 `agents/<cap>/`,
    跟使用它的能力放一起 —— code 按显式路径加载。
  * 人为可调规则(分章启发式 / 写作·引导风格 / 颜色字体 / 重试纠正语 / grounding /
    privacy / persona)集中放在本目录:`common/`(跨能力共享,handler 用 `common=`
    声明)与 `rules/`(按能力的规则,handler 按 `RULES_DIR / "<name>.md"` 加载)。

`{KEY}` 占位符用 `str.replace`(不是 `str.format`)填充,所以 prompt 里 JSON 示例的
`{ }` 不会被动到。加载文本按路径 `lru_cache`。
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

PROMPTS_DIR = Path(__file__).resolve().parent
COMMON_DIR = PROMPTS_DIR / "common"
RULES_DIR = PROMPTS_DIR / "rules"

# Backward-compatible private alias (load_prompt's `common=` resolves against it).
_COMMON_DIR = COMMON_DIR


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
