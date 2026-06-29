"""章节描述 Agent 的输出结构。"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class DescribeResult:
    """Stage1 章节级识图输出。

    模型优先写章节概括、关键词和标题提示;逐图 scene 只是兼容当前
    V3LayoutTree 契约的短描述,缺省时可由章节摘要回填。
    """

    chapterDescriptions: dict[str, str]
    imageDescriptions: dict[str, str]
    # 逐图构图(closeup/focal/wide),识图模型输出;排版按朝向×构图匹配槽位。
    imageCompositions: dict[str, str] = field(default_factory=dict)
    chapterTitleHints: dict[str, str] = field(default_factory=dict)
    chapterKeywords: dict[str, list[str]] = field(default_factory=dict)
    chapterVisualSummaries: dict[str, str] = field(default_factory=dict)
    tokens_billed: int = 0
    model: str = ""
    provider: str = ""
    call_count: int = 0
