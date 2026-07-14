"""排版之后写文案 agent 的输出结构。"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class WriteCopyResult:
    """按页写好的文案。`pages_texts` 形状是 ``{pageIndex: {slotId: 文案}}``,
    只含本次写入(已跳过 decoration)。任何失败(缺 key /
    HTTP 出错 / JSON 解析不出)都返回一个空结果而不是抛错 —— 写文案是叠加性的,
    绝不能因为它失败而搞崩排版。"""

    pages_texts: dict[int, dict[str, str]]
    call_count: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    model: str | None = None
