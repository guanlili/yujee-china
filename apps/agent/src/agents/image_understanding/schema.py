"""image_understanding agent 的就近放置 schema。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from ...schemas import V3LayoutTree


@dataclass(frozen=True)
class DescribeResult:
    """Stage1 fixed-group describe output.

    The vision model writes only chapter descriptions and per-photo image
    descriptions. It does not choose templates, pages, cover/ending, or generic
    copy.
    """

    chapterDescriptions: dict[str, str]
    imageDescriptions: dict[str, str]
    tokens_billed: int = 0
    model: str = ""
    provider: str = ""
    call_count: int = 0


@dataclass(frozen=True)
class V3AnalyzeResult:
    """旧的一体化识图调用输出,保留给未迁移内部引用。

    当前对外 `/v3/analyze` callback 是 tree-only;pages 由 `/v3/select-layout`
    单独产生。这里的 `pages` 只表示旧内部组合结果,不等于对外 analyze callback。

    `model` 是实际命中的 slot(使 Usage.models.vision 反映真实 provider,而非写死)。"""

    tree: V3LayoutTree
    pages: list[dict[str, Any]]
    tokens_billed: int
    model: str
    provider: str
    call_count: int = 1


# 向后兼容别名:旧名 V3DescribeResult 在重构前是只含 tree 的「describe」结果。
# 现在保留为旧内部组合结果别名;对外 analyze callback 仍只返回 tree。
V3DescribeResult = V3AnalyzeResult
