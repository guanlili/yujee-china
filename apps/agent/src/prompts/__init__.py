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


@lru_cache(maxsize=None)
def load_replies(path: Path | str) -> dict[str, str]:
    """加载一份「兜底/默认回复」文件,解析成扁平的 `key -> 文本` 字典(按路径 lru_cache)。

    格式极简、便于产品手调:每行 `key: 文本`(首个冒号 `:` 或全角 `:` 分隔)。
    实践里 key 形如 `intent.zh` / `intent.en`(意图/种类 + 语言),但本加载器不强加这层
    语义 —— 它只做「键 → 文本」。空行与以 `#` 起头的注释行被忽略;键与值两端空白被裁掉。
    重复键以最后一次为准(宽容)。"""
    out: dict[str, str] = {}
    for raw_line in Path(path).read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        # 取首个 ASCII 冒号或全角冒号作为分隔符。
        idx_ascii = line.find(":")
        idx_full = line.find(":")
        candidates = [i for i in (idx_ascii, idx_full) if i != -1]
        if not candidates:
            continue
        sep = min(candidates)
        key = line[:sep].strip()
        value = line[sep + 1 :].strip()
        if key:
            out[key] = value
    return out


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
