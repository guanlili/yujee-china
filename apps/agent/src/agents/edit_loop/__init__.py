"""Stage3 编辑环节 —— 主控 AI agent loop(集中存放编辑能力)。

一个主控 AI,持有完整上下文(含当前页文案)、知道能力与边界,在单次 /v3/edit-chat
请求内自主多步调工具(看页 → 改 → 验证 → 完成)。取代旧的「单次工具路由」
(story/context.py)。设计见 docs/architecture.md §7.12 / contract.md §6.2。

  flow.py        /v3/edit-chat 编排:DB serialized-turn 生命周期 + 主控 loop(契约不变)
  controller.py  loop 编排器(读上下文 → 调工具 → 回喂 → 循环 → 聚合)
  context.py     富上下文组装(根因修复:补上当前页文案)
  tools.py       工具注册表(JSON-schema + 执行分发;复用现有执行器 + 新 edit_text)
  edit_text.py   文案落地工具(零 LLM:校验主控写好的 texts 并落地,回传供验证)
  helpers.py     槽位规格 + 文案清洗助手(自包含;cover_v3 经 tools/text 再导出)
  progress.py    章节完成推进规则
  navigation.py  翻页推进(advance_book)
  skills_registry.py  编辑 skill 的渐进式加载(扫 skills/ 出清单 + read_skill 读全文)
  controller.md  主控 AI 的 system prompt(角色 + 能力 + 边界 + 技能清单占位)
  skills/*.md    手艺指南(writing_copy / choosing_layout / swapping_images),主控按需读取
"""

from __future__ import annotations

from .controller import EditLoopResult, run_edit_loop

__all__ = ["EditLoopResult", "run_edit_loop"]
