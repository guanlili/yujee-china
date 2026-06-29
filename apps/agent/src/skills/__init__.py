"""Prompt loader.

按职责切分 prompt 资产:
  * `agents/<cap>/*.md`:固定结构,只描述角色、输入、输出 JSON 形状和硬格式契约。
  * `skills/*.md`:人为可调技能/规则/风格/回复,由 handler 用 `skills=`
    声明或按 `SKILLS_DIR / "<name>.md"` 显式加载。

`{KEY}` 占位符用 `str.replace`(不是 `str.format`)填充,所以 prompt 里 JSON 示例的
`{ }` 不会被动到。加载文本按路径 `lru_cache`。
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

SKILLS_DIR = Path(__file__).resolve().parent


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
        # 取首个 ASCII 冒号或全角冒号作为分隔符(取两者中位置更靠前的那个)。
        idx_ascii = line.find(":")
        idx_full = line.find("：")
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
    path: Path | str, *, skills: tuple[str, ...] = (), **slots: str
) -> str:
    """Compose an agent prompt.

    The agent contract body comes first, then explicitly declared
    `<name>.md` skill fragments. Each capability picks only the skills it needs.
    `{KEY}` placeholders are filled via `str.replace` across the whole composed
    text, so JSON braces survive.
    """
    parts = [_read(str(path))]
    parts += [_read(str(SKILLS_DIR / f"{name}.md")) for name in skills]
    text = "\n\n".join(parts)
    for key, value in slots.items():
        text = text.replace(f"{{{key}}}", value)
    return text
