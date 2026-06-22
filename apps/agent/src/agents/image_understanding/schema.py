"""image_understanding agent 的就近放置 schema。"""

from __future__ import annotations

from dataclasses import dataclass

from ...schemas import V3LayoutTree


@dataclass(frozen=True)
class V3DescribeResult:
    """一个 analyze 批次的 describe-content 输出。`tree` 【只】承载 3 处 LLM 撰写的字段
    + 代码填充的确定性照片属性;`model` 是实际命中的 slot(使 Usage.models.vision 反映
    真实 provider,而非写死)。"""

    tree: V3LayoutTree
    tokens_billed: int
    model: str
    provider: str
    call_count: int = 1
