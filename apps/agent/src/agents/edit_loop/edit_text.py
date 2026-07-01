"""edit_text 工具:把主控写好的文案落到某一页(实现)。

这是修复「改成英文却没变」的关键工具,但**它本身不调 LLM**。主控 AI 已经在上下文里
看到了每页的当前文案 + slot 规格(id/lang/hint/maxChars)+ 照片场景,它自己就能写新文案 ——
所以这里不再起一个独立「写手」子调用(那是多此一举的分角色)。主控直接把改好的
`texts={slotId: 新文案}` 当工具参数传进来,本工具只做**确定性落地**:

  - 解析目标页(1-based page 参数,缺省=聚焦页)。
  - 校验:每个 slot 不超 maxChars、只写该模板声明的 text slot、丢图槽/未知键。
  - 返回:实际写入的 {pageIndex, appliedTexts} —— 回喂给主控,让它验证「改对了没」。

零 LLM、零网络。一次用户消息里主控可能多次调它(改多页/逐页微调),都很便宜。
"""

from __future__ import annotations

from typing import Any

from . import helpers
from .tools import ToolResult


def _resolve_page(ctx: Any, raw_page: Any) -> int | None:
    """1-based 人类页码 -> pageIndex;缺省=聚焦页。落到本章已知页里才算数。"""
    if isinstance(raw_page, bool):
        raw_page = None
    if isinstance(raw_page, int) and raw_page >= 1:
        candidate = raw_page - 1
    elif isinstance(raw_page, str) and raw_page.strip().isdigit() and int(raw_page) >= 1:
        candidate = int(raw_page) - 1
    else:
        candidate = ctx.focused_page_index
    if candidate is None:
        return None
    if candidate in ctx.pages_by_index:
        return candidate
    return None


async def run(ctx: Any, args: dict[str, Any]) -> ToolResult:
    """落地主控传入的文案,返回 ToolResult(observation 回带写入的文案供主控验证)。"""
    page_index = _resolve_page(ctx, args.get("page"))
    if page_index is None:
        return ToolResult(
            observation={
                "error": "no_target_page",
                "detail": "没有可改的页:既无 1-based page 参数也无聚焦页。",
            }
        )

    raw_texts = args.get("texts")
    if not isinstance(raw_texts, dict) or not raw_texts:
        return ToolResult(
            observation={
                "pageIndex": page_index,
                "error": "no_texts",
                "detail": "edit_text 需要 texts={slotId: 文案};请直接给出每个槽位的新文案。",
            }
        )

    page = ctx.pages_by_index[page_index]
    specs = ctx.slot_specs.get(page_index, [])

    texts = helpers.clean_texts(raw_texts, specs, template_id=page.templateId)
    if not texts:
        # 主控写了文案但没命中任何合法 slot —— 回喂合法 slot 让它改用正确的键。
        valid_slots = [str(spec.get("id")) for spec in specs if spec.get("id") is not None]
        return ToolResult(
            observation={
                "pageIndex": page_index,
                "error": "no_valid_slots",
                "detail": "给的键没命中任何合法 slot。",
                "validSlots": valid_slots,
            }
        )

    return ToolResult(
        observation={"pageIndex": page_index, "appliedTexts": texts},
        pageTexts=(page_index, texts),
    )
