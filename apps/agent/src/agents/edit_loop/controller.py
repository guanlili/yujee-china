"""Stage3 编辑环节的主控 AI agent loop —— 编排器(实现)。

设计(docs/architecture.md §7.12 / contract.md §6.2):
  旧的「单次工具路由」(story/context.py:_run_tool_router)把 LLM 只调一次挑一个工具,
  工具结果不回喂、AI 看不到当前文案 —— 所以「改成英文」说改了却没变。

  这里换成真正的 agent loop:一个**主控 AI**,持有完整上下文(含当前页文案)、知道自己的
  能力与边界,在**单次 /v3/edit-chat 请求内**自主多步调用工具(看页 → 改 → 验证 → 完成),
  每个工具结果**回喂**给模型,直到模型不再调工具或触发护栏,最后聚合 patch + 回复返回。

控制流(一次用户消息 = 一个 serialized turn,内部多轮):
  1. build_context(req, tools)        组装富上下文(system=角色/能力/边界;含当前文案)
  2. loop(最多 MAX_TOOL_ITERS 轮,整体 < LOOP_BUDGET_SECONDS):
       a. resp = await complete(messages, tools=registry)   主控 AI 决定下一步
       b. 无 tool_calls => 收尾(模型给出最终回复),break
       c. 有 tool_calls => 逐个 execute_tool,把结果作为 `tool` message 追加回 messages(回喂)
  3. aggregate => EditLoopResult(patches, pagesTexts, reply, progress, navigation)

护栏(同步 in-request,绝不挂住 HTTP):
  - MAX_TOOL_ITERS 轮上限(防模型无限调工具)
  - LOOP_BUDGET_SECONDS 整体超时(asyncio.wait_for)
  - 模型不可用 / 超时 => 降级保守 talk,零 draft 改动(不破坏本轮)

模型:DeepSeek 槽(settings.deepseek_*)作主控。DeepSeek 是 OpenAI 兼容、支持 function-calling
  的弱推理槽;问题从来不是模型不够聪明,而是脚手架不足(上下文缺当前文案 + 不回喂 + 不循环)。
  主控**自己写文案**:它在上下文里已看到当前文案 + slot 规格,直接把新文案当 edit_text 的
  参数传出 —— edit 是它的一项能力(skill),不再有独立「写手」LLM 子调用。
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from ... import ai_client
from ...schemas import V3EditChatRequest
from ...settings import get_settings
from . import context as edit_context
from . import tools as edit_tools

# 护栏常量(对齐 contract.md §6.2.2 / page-edit 的 58s 预算)。
MAX_TOOL_ITERS = 6
LOOP_BUDGET_SECONDS = 58.0
CONTROLLER_TEMPERATURE = 0.2
CONTROLLER_MAX_TOKENS = 800


@dataclass(frozen=True)
class EditLoopResult:
    """主控 loop 的最终聚合产物,映射回 V3EditChatResponse(契约不变)。"""

    patches: list[Any] = field(default_factory=list)        # V3LayoutPatchEntry[]
    pagesTexts: dict[int, dict[str, str]] = field(default_factory=dict)  # pageIndex -> texts
    assistantReply: str = ""
    progressDecision: Any | None = None                     # V3EditProgressDecision | None
    navigation: Any | None = None                           # V3EditNavigation | None
    # 计费/可观测(不进契约响应,只内部记账 + trace)。
    tool_iters: int = 0
    model: str = ""
    input_tokens: int = 0
    output_tokens: int = 0
    degraded: bool = False


# 注入点:测试可替换真实 LLM 调用(同既有 complete= 模式)。
CompleteFn = Callable[..., Awaitable[Mapping[str, Any]]]

_DEFAULT_REPLY = {
    "zh": "好的,我看了一下,已经按你说的处理。",
    "en": "Done — I've taken care of that for you.",
}
_DEGRADE_REPLY = {
    "zh": "我暂时没法完成这个改动,等会儿再试一下好吗?",
    "en": "I couldn't complete that change just now — could you try again in a moment?",
}


def _reply_for(language: Any, table: dict[str, str]) -> str:
    return table["zh"] if language == "zh" else table["en"]


async def run_edit_loop(
    req: V3EditChatRequest,
    *,
    tools_data: Any,                # LayoutDataTools / web fetch 客户端
    complete: CompleteFn | None = None,
    history: list[dict[str, str]] | None = None,
) -> EditLoopResult:
    """主控 AI agent loop 入口。单次请求内多轮调工具直到完成。

    `complete`     注入主控 LLM 调用(测试覆盖;None 走真实 DeepSeek 槽)。
    `history`      调用方(flow serialized turn)注入的对话历史。
    """
    settings = get_settings()
    # 缺主控 key 且无注入 => 直接保守降级(绝不打真实空 key 请求)。
    if complete is None and not settings.deepseek_api_key:
        return _degrade_to_talk(req, "missing_deepseek_key")

    try:
        return await asyncio.wait_for(
            _run_loop(
                req,
                tools_data=tools_data,
                complete=complete,
                history=history,
            ),
            timeout=LOOP_BUDGET_SECONDS,
        )
    except asyncio.TimeoutError:
        ai_client.trace_marker("edit_loop.timeout", input=req.userMessage)
        return _degrade_to_talk(req, "loop_timeout")
    except Exception as exc:  # noqa: BLE001 —— 模型/网络/解析失败一律保守降级,不破坏本轮
        ai_client.trace_marker("edit_loop.degrade", input=str(exc))
        return _degrade_to_talk(req, f"loop_error:{type(exc).__name__}")


async def _run_loop(
    req: V3EditChatRequest,
    *,
    tools_data: Any,
    complete: CompleteFn | None,
    history: list[dict[str, str]] | None,
) -> EditLoopResult:
    settings = get_settings()
    ctx = await edit_context.build_context(req, tools_data, history=history)
    registry = edit_tools.build_registry(tools_data, ctx)

    messages: list[dict[str, Any]] = list(ctx.messages)

    patches: list[Any] = []
    pages_texts: dict[int, dict[str, str]] = {}
    progress_decision: Any | None = None
    navigation: Any | None = None
    reply = ""
    input_tokens = 0
    output_tokens = 0
    iters = 0

    while iters < MAX_TOOL_ITERS:
        response = await _complete_controller(messages, registry, complete)
        in_tok, out_tok = ai_client.extract_usage(response)
        input_tokens += in_tok
        output_tokens += out_tok

        calls = ai_client.extract_tool_calls(response)
        if not calls:
            reply = ai_client.extract_text_optional(response)
            break

        # 回喂:先把模型这一步的 assistant(tool_calls)消息追加,再逐个工具结果。
        messages.append(
            {"role": "assistant", "content": "", "tool_calls": list(calls)}
        )
        for call in calls:
            name, args, call_id = _parse_call(call)
            if name is None:
                messages.append(
                    edit_context.tool_result_message(
                        call_id, "unknown", {"error": "malformed_tool_call"}
                    )
                )
                continue
            result = await registry.execute(name, args)
            messages.append(
                edit_context.tool_result_message(call_id, name, result.observation)
            )
            _merge_result(patches, pages_texts, result)
            if result.progressDecision is not None:
                progress_decision = result.progressDecision
            if result.navigation is not None:
                navigation = result.navigation
        iters += 1
    else:
        # 触顶 MAX_TOOL_ITERS:用已有产物收尾,不再调模型(护栏:不挂住)。
        ai_client.trace_marker("edit_loop.max_iters", output=str(iters))

    if not reply:
        reply = _reply_for(req.language, _DEFAULT_REPLY)

    return EditLoopResult(
        patches=patches,
        pagesTexts=pages_texts,
        assistantReply=reply[:500],
        progressDecision=progress_decision,
        navigation=navigation,
        tool_iters=iters,
        model=settings.deepseek_model,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
    )


def _parse_call(call: Mapping[str, Any]) -> tuple[str | None, dict[str, Any], str]:
    """从 OpenAI tool_call dict 解析 (name, args, id)。args 是 JSON 字符串,宽容解析。"""
    call_id = str(call.get("id") or "call_0")
    function = call.get("function")
    if not isinstance(function, dict):
        return None, {}, call_id
    name = function.get("name")
    if not isinstance(name, str) or not name:
        return None, {}, call_id
    try:
        args = ai_client.parse_json_loose(str(function.get("arguments") or "{}"))
    except ValueError:
        args = {}
    if not isinstance(args, dict):
        args = {}
    return name, args, call_id


def _merge_result(
    patches: list[Any],
    pages_texts: dict[int, dict[str, str]],
    result: edit_tools.ToolResult,
) -> None:
    """把单个工具产物聚合进 loop 的累积态。后写的页文案覆盖先写的(同页多次改取最后)。"""
    if result.patches:
        patches.extend(result.patches)
    if result.pageTexts is not None:
        page_index, texts = result.pageTexts
        pages_texts[page_index] = texts


async def _complete_controller(
    messages: Sequence[Mapping[str, Any]],
    registry: Any,
    complete: CompleteFn | None,
) -> Mapping[str, Any]:
    """调主控模型(DeepSeek 槽),带 tools=registry.schemas、tool_choice='auto'。

    `complete` 注入(测试)优先;否则走真实 DeepSeek 槽。注入的 stub 可能不接受 tools/
    tool_choice 关键字(老式 stub),TypeError 时降级为不带 tools 再调一次(同旧路由模式)。"""
    msgs = list(messages)
    if complete is not None:
        try:
            return await complete(
                messages=msgs,
                max_tokens=CONTROLLER_MAX_TOKENS,
                temperature=CONTROLLER_TEMPERATURE,
                tools=registry.schemas,
                tool_choice="auto",
            )
        except TypeError:
            return await complete(
                messages=msgs,
                max_tokens=CONTROLLER_MAX_TOKENS,
                temperature=CONTROLLER_TEMPERATURE,
            )

    settings = get_settings()
    if not settings.deepseek_api_key:
        raise RuntimeError("DEEPSEEK_API_KEY missing; cannot run edit-loop controller")
    return await ai_client.chat_completion(
        base_url=settings.deepseek_base_url,
        api_key=settings.deepseek_api_key,
        model=settings.deepseek_model,
        messages=msgs,
        timeout_seconds=settings.deepseek_timeout_seconds,
        max_tokens=CONTROLLER_MAX_TOKENS,
        temperature=CONTROLLER_TEMPERATURE,
        extra_body=(
            {"thinking": {"type": "disabled"}} if settings.deepseek_disable_thinking else None
        ),
        tools=registry.schemas,
        tool_choice="auto",
    )


def _degrade_to_talk(req: V3EditChatRequest, reason: str) -> EditLoopResult:
    """模型不可用/超时的保守降级:只回一句话,零 draft 改动,本轮不失败。"""
    return EditLoopResult(
        patches=[],
        pagesTexts={},
        assistantReply=_reply_for(req.language, _DEGRADE_REPLY),
        progressDecision=None,
        navigation=None,
        tool_iters=0,
        model=get_settings().deepseek_model,
        degraded=True,
    )
