"""compose 的输出结构。任何失败都返回空结果而非抛错。"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class ComposeChapterResult:
    """一章写好的文案。`pages_texts` 形状是 ``{pageIndex: {slotId: 文案}}``。

    写不出来就是空 dict —— 该章页面保留模板 sample 文案,绝不阻断交付。"""

    pages_texts: dict[int, dict[str, str]] = field(default_factory=dict)
    call_count: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    model: str | None = None


@dataclass(frozen=True)
class ComposeGlobalResult:
    """全书级成稿:封面/封尾文案 + 三款字体(字体永远由代码查表填,见 handler)。"""

    cover_texts: dict[str, str] = field(default_factory=dict)
    ending_texts: dict[str, str] = field(default_factory=dict)
    fonts: dict[str, str] = field(default_factory=dict)
    call_count: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    model: str | None = None
