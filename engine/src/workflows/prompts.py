"""Prompt loader —— workflow 读自己那份 system prompt 的唯一入口。

每个 workflow 的 prompt 正文就是它自己模块目录下的 `<name>.md`,紧挨着加载它的
handler(select_layout/judge_thumbnails.md、write_copy/write_copy.md、…)。
prompt 不集中放,改哪个环节就在哪个环节的目录里改。

这个加载器原本住在 `src/skills/`。那个名字是错的:目录里一个 skill 都没有,只有下面
这个函数;真正的 skill(带 frontmatter 的 `packages/contracts/skills/<name>/SKILL.md`)
是 design-agent 消费的,engine 侧根本不读。名字承诺了一个它不实现的概念,还害得
handler 要写 `from .....skills import`(五级相对 import)。它只服务 workflows、加载的
`.md` 也全在 workflows 下,所以搬到这里。

若将来要让 engine workflow 也复用 design-agent 那套 SKILL.md,需要在这里加一个读
`<name>/SKILL.md` 并剥掉 frontmatter 的加载器 —— 那会改动排版 AI 的输入,属行为变更,
另行评估。

`{KEY}` 占位符用 `str.replace` 而【不是】 `str.format` 填充 —— prompt 正文里有 JSON
示例,`format` 会把那些 `{ }` 当占位符炸掉。加载文本按路径 `lru_cache`。
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
