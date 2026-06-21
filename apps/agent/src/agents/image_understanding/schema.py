"""Co-located schema for the image_understanding agent."""

from __future__ import annotations

from dataclasses import dataclass

from ...schemas import V3LayoutTree


@dataclass(frozen=True)
class V3DescribeResult:
    """describe-content output for one analyze batch. `tree` carries ONLY the 3
    LLM-authored fields + the code-filled deterministic photo attrs; `model` is the
    slot actually hit (so Usage.models.vision reflects真实 provider, not hardwired)."""

    tree: V3LayoutTree
    tokens_billed: int
    model: str
    provider: str
    call_count: int = 1
