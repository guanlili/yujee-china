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
    """统一识图调用(读图 + 分章 + 分页选模板,合一)的输出。

    `tree` 承载 LLM 撰写的章节字段(description / 每图 sceneDescription)+ 代码填充的
    确定性照片属性;`pages` 是【已经过确定性合法性护栏】的扁平正文页 dict 列表(形如
    `schemas.Page`:pageIndex/templateId/images/texts,texts 为空 —— 通用文案/色稍后叠加)。
    封面/封底由调用方的 `wrap_with_cover_ending` 在这些正文页前后补齐。

    `model` 是实际命中的 slot(使 Usage.models.vision 反映真实 provider,而非写死)。"""

    tree: V3LayoutTree
    pages: list[dict[str, Any]]
    tokens_billed: int
    model: str
    provider: str
    call_count: int = 1


# 向后兼容别名:旧名 V3DescribeResult 在重构前是只含 tree 的「describe」结果。统一调用后
# 它就是 V3AnalyzeResult(同时承载 tree + pages)。保留别名以免外部引用炸裂。
V3DescribeResult = V3AnalyzeResult
