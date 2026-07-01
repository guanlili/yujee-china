"""Stage3 编辑环节主控 AI agent loop 测试(NEW 平行模块 src/agents/edit_loop/)。

覆盖根因修复与护栏:
  ① 多步 loop:主控先 get_page_info、再 edit_text(自己写好的英文 texts)、最后无 tool_call 收尾
     —— 验证工具结果**回喂**进 messages、edit_text 落地、最终回复返回、patches/pageTexts 聚合。
  ② 「改成英文」回归:验证**当前文案进了上下文**(根因);主控把英文 texts 传给 edit_text 即落地。
  ③ 护栏:主控永远返回 tool_call => 停在 MAX_TOOL_ITERS,返回已有产物,不挂住。
  ④ 降级:缺 deepseek key / 主控 complete 抛错 => 保守 talk,零 patch。

只有主控一个 LLM 调用被注入(complete),不打真实 provider;文案由主控自己写进 edit_text
的 texts 参数(零写手子调用)。web 数据用 FakeTools 提供(get_page_info 回带当前文案 ——
正是旧路由从没喂的那块)。
"""

from __future__ import annotations

import json
from typing import Any

import pytest

from src.agents.edit_loop import controller as edit_loop
from src.engine import templates
from src.schemas import V3EditChatRequest

# mag-04: 2 张图 + explain1/explain2 文字位;mag-13: 封面 title/explain。
_INTERIOR = "mag-04"


def _img_assignment(template_id: str, photo_ids: list[str]) -> dict[str, str]:
    slot_ids = templates.image_slot_ids(templates.get(template_id))
    return {slot_ids[i]: photo_ids[i] for i in range(min(len(slot_ids), len(photo_ids)))}


def _chapter_payload() -> dict[str, Any]:
    return {
        "chapterId": "c1",
        "description": "A spring trip to the coast.",
        "accentColor": None,
        "artFont": None,
        "photos": [
            {
                "photoId": "p1",
                "sceneDescription": "two people on a beach",
                "width": 800,
                "height": 600,
                "orientation": "landscape",
                "takenAt": "2024-04-01T10:00:00Z",
            },
            {
                "photoId": "p2",
                "sceneDescription": "a lighthouse at dusk",
                "width": 800,
                "height": 600,
                "orientation": "landscape",
                "takenAt": "2024-04-01T18:00:00Z",
            },
        ],
    }


def _pages_payload() -> list[dict[str, Any]]:
    # 聚焦页(index 1)当前是中文文案 —— 这正是「改成英文」要看到的原文。
    return [
        {
            "pageIndex": 1,
            "templateId": _INTERIOR,
            "images": _img_assignment(_INTERIOR, ["p1", "p2"]),
            "texts": {"explain1": "海边的两个人", "explain2": "黄昏的灯塔"},
        },
    ]


def _page_info() -> dict[str, Any]:
    return {"chapter": _chapter_payload(), "pages": _pages_payload()}


class FakeTools:
    """实现 EditTools 协议:get_page_info / get_book_tree / get_page_photos。"""

    def __init__(self) -> None:
        self.page_info_calls: list[dict[str, Any]] = []
        self.book_tree_calls = 0

    async def get_page_info(
        self, *, albumId: str, chapterId: str, scope: str, pageIndex: int | None = None
    ) -> dict[str, Any]:
        self.page_info_calls.append(
            {"albumId": albumId, "chapterId": chapterId, "scope": scope, "pageIndex": pageIndex}
        )
        return _page_info()

    async def get_page_photos(self, *, albumId: str, chapterId: str) -> list[dict[str, Any]]:
        return _chapter_payload()["photos"]

    async def get_book_tree(
        self, *, albumId: str, chapterId: str | None = None, pageIndex: int | None = None
    ) -> dict[str, Any]:
        self.book_tree_calls += 1
        return {
            "chapters": [{"chapterId": "c1", "pageIndexes": [1, 2]}],
            "progress": {"currentChapterId": "c1"},
            "focusedPageIndex": pageIndex,
        }


def _req(user_message: str, *, page_index: int | None = 1) -> V3EditChatRequest:
    focus: dict[str, Any] = {"chapterId": "c1"}
    if page_index is not None:
        focus["pageIndex"] = page_index
    return V3EditChatRequest(
        albumId="alb_v3",
        language="en",
        userMessage=user_message,
        focus=focus,
        progress={"currentChapterId": "c1", "doneChapterIds": []},
    )


def _tool_call_response(name: str, arguments: dict[str, Any], *, call_id: str = "call_1") -> dict[str, Any]:
    return {
        "choices": [
            {
                "message": {
                    "tool_calls": [
                        {
                            "id": call_id,
                            "type": "function",
                            "function": {"name": name, "arguments": json.dumps(arguments)},
                        }
                    ]
                }
            }
        ],
        "usage": {"prompt_tokens": 5, "completion_tokens": 3},
    }


def _final_text_response(text: str) -> dict[str, Any]:
    return {
        "choices": [{"message": {"content": text, "tool_calls": None}}],
        "usage": {"prompt_tokens": 4, "completion_tokens": 6},
    }


def _scripted_controller(steps: list[dict[str, Any]]):
    """主控 stub:按 steps 顺序逐轮返回(超出长度则一直返回最后一项)。

    记录每轮收到的 messages,供断言「工具结果回喂」。"""
    seen_messages: list[list[dict[str, Any]]] = []

    async def complete(*, messages, max_tokens, temperature, tools=None, tool_choice=None):  # noqa: ANN001
        seen_messages.append([dict(m) for m in messages])
        idx = min(len(seen_messages) - 1, len(steps) - 1)
        return steps[idx]

    complete.seen_messages = seen_messages  # type: ignore[attr-defined]
    return complete


_ENGLISH_TEXTS = {"explain1": "Two people on the beach", "explain2": "A lighthouse at dusk"}


@pytest.mark.asyncio
async def test_multi_step_loop_feeds_results_and_applies_edit():
    """① get_page_info -> edit_text(主控自己写的英文 texts)-> 收尾。验证回喂 + 应用 + 聚合。"""
    steps = [
        _tool_call_response("get_page_info", {"page": 2}, call_id="c_info"),
        _tool_call_response(
            "edit_text", {"page": 2, "texts": _ENGLISH_TEXTS}, call_id="c_edit"
        ),
        _final_text_response("All set — I rewrote that page in English."),
    ]
    controller = _scripted_controller(steps)
    tools = FakeTools()

    result = await edit_loop.run_edit_loop(
        _req("change it to English"),
        tools_data=tools,
        complete=controller,
    )

    # 主控被调了 3 轮(2 个工具轮 + 1 个收尾轮)。
    assert len(controller.seen_messages) == 3  # type: ignore[attr-defined]
    # 第 2、3 轮的 messages 必须含回喂的 tool 结果(role=="tool")。
    roles_round2 = [m["role"] for m in controller.seen_messages[1]]  # type: ignore[attr-defined]
    assert "tool" in roles_round2
    roles_round3 = [m["role"] for m in controller.seen_messages[2]]  # type: ignore[attr-defined]
    assert roles_round3.count("tool") == 2  # get_page_info + edit_text 都回喂了

    # edit_text 应用:pageTexts 聚合到 pageIndex 1。
    assert result.pagesTexts == {1: _ENGLISH_TEXTS}
    assert result.assistantReply == "All set — I rewrote that page in English."
    assert result.tool_iters == 2
    assert not result.degraded


@pytest.mark.asyncio
async def test_change_to_english_has_current_texts_in_context():
    """② 「改成英文」回归:当前文案进上下文(根因);主控写英文 texts -> 落地返回。"""
    steps = [
        _tool_call_response(
            "edit_text", {"texts": _ENGLISH_TEXTS}, call_id="c_edit"
        ),
        _final_text_response("Rewritten in English."),
    ]
    controller = _scripted_controller(steps)
    tools = FakeTools()

    result = await edit_loop.run_edit_loop(
        _req("change to English", page_index=1),
        tools_data=tools,
        complete=controller,
    )

    # 根因:主控的第一条 user message(上下文 payload)必须带 focusedPageTexts = 当前中文文案。
    ctx_user = controller.seen_messages[0][1]["content"]  # type: ignore[attr-defined]
    payload = json.loads(ctx_user)
    assert payload["focusedPageTexts"] == {"explain1": "海边的两个人", "explain2": "黄昏的灯塔"}
    # 主控写的英文 texts 落地返回。
    assert result.pagesTexts[1]["explain1"] == "Two people on the beach"


@pytest.mark.asyncio
async def test_skills_catalog_in_context_and_read_skill_feeds_back():
    """⑤ 渐进式加载:清单进 system(只 name+描述,不含正文);主控 read_skill 读全文并回喂。"""
    steps = [
        _tool_call_response("read_skill", {"name": "writing_copy"}, call_id="c_skill"),
        _tool_call_response("edit_text", {"texts": _ENGLISH_TEXTS}, call_id="c_edit"),
        _final_text_response("Done."),
    ]
    controller = _scripted_controller(steps)
    tools = FakeTools()

    result = await edit_loop.run_edit_loop(
        _req("make the copy warmer", page_index=1),
        tools_data=tools,
        complete=controller,
    )

    # 清单进了 system:能看到 skill 的名字,但**不含正文**(正文只在 read_skill 后才来)。
    system_text = controller.seen_messages[0][0]["content"]  # type: ignore[attr-defined]
    assert "writing_copy" in system_text  # 清单里有名字
    assert "# 改文案 / 写文案" not in system_text  # 但正文没塞进 system(渐进式的关键)

    # read_skill 的结果(skill 正文)回喂进了第 2 轮 messages。
    round2 = controller.seen_messages[1]  # type: ignore[attr-defined]
    tool_msgs = [m for m in round2 if m["role"] == "tool"]
    assert any("# 改文案 / 写文案" in m["content"] for m in tool_msgs)

    # read_skill 是只读的,不产生 patch;后续 edit_text 才落地。
    assert result.pagesTexts[1]["explain1"] == "Two people on the beach"
    assert not result.degraded


@pytest.mark.asyncio
async def test_read_unknown_skill_returns_catalog_not_crash():
    """⑥ read_skill 读不存在的 skill => 回喂可用清单(主控可自纠),不崩、不降级。"""
    steps = [
        _tool_call_response("read_skill", {"name": "does_not_exist"}, call_id="c_skill"),
        _final_text_response("Let me try differently."),
    ]
    controller = _scripted_controller(steps)

    result = await edit_loop.run_edit_loop(
        _req("help me", page_index=1),
        tools_data=FakeTools(),
        complete=controller,
    )

    # 第 2 轮回喂里应含错误 observation + 可用 skill 名字列表。
    round2 = controller.seen_messages[1]  # type: ignore[attr-defined]
    tool_msgs = [m for m in round2 if m["role"] == "tool"]
    assert any("unknown_skill" in m["content"] and "writing_copy" in m["content"] for m in tool_msgs)
    assert not result.degraded
    assert result.patches == []


@pytest.mark.asyncio
async def test_guard_stops_at_max_iters_and_does_not_hang():
    """③ 主控永远调工具 => 停在 MAX_TOOL_ITERS,返回已有产物,不挂住。"""
    # 每轮都返回同一个 get_page_info tool_call(永不收尾)。
    always_tool = [_tool_call_response("get_page_info", {}, call_id="loop")]
    controller = _scripted_controller(always_tool)
    tools = FakeTools()

    result = await edit_loop.run_edit_loop(
        _req("show me the page"),
        tools_data=tools,
        complete=controller,
    )

    assert result.tool_iters == edit_loop.MAX_TOOL_ITERS
    # 调用次数 == MAX_TOOL_ITERS(每轮一次主控调用,触顶后不再调)。
    assert len(controller.seen_messages) == edit_loop.MAX_TOOL_ITERS  # type: ignore[attr-defined]
    # 触顶仍有一句兜底回复,且零 patch。
    assert result.assistantReply
    assert result.patches == []


@pytest.mark.asyncio
async def test_degrade_on_controller_error_returns_conservative_talk():
    """④ 主控 complete 抛错 => 保守 talk,零 patch,不抛。"""

    async def boom(*, messages, max_tokens, temperature, tools=None, tool_choice=None):  # noqa: ANN001
        raise RuntimeError("model unavailable")

    result = await edit_loop.run_edit_loop(
        _req("change to English"),
        tools_data=FakeTools(),
        complete=boom,
    )

    assert result.degraded is True
    assert result.patches == []
    assert result.pagesTexts == {}
    assert result.assistantReply  # 一句保守回复


@pytest.mark.asyncio
async def test_history_keeps_only_clean_dialogue_before_current_turn():
    """⑦ 两层记忆:跨轮历史只留 user/assistant 干净对话,剔除 tool 痕迹,且排在本轮 user 之前。"""
    # 注入的历史里混入了脏数据:tool 结果、system 行、带 tool_calls 的 assistant —— 都该被剔除。
    dirty_history = [
        {"role": "user", "content": "把第一页改温柔点"},
        {"role": "assistant", "content": "", "tool_calls": [{"id": "x"}]},  # loop 产物,该丢
        {"role": "tool", "content": '{"appliedTexts": {...}}'},              # 工具结果,该丢
        {"role": "assistant", "content": "好的,已经把第一页改得更温柔了。"},   # 最终回复,保留
        {"role": "system", "content": "sneaky"},                             # 非对话,该丢
    ]
    steps = [_final_text_response("这次也搞定了。")]  # 直接收尾,不调工具
    controller = _scripted_controller(steps)

    await edit_loop.run_edit_loop(
        _req("再改一次", page_index=1),
        tools_data=FakeTools(),
        complete=controller,
        history=dirty_history,
    )

    msgs = controller.seen_messages[0]  # type: ignore[attr-defined]
    # 历史只剩两条干净对话(1 user + 1 assistant 最终回复);tool/tool_calls/system 全被剔。
    history_part = [m for m in msgs if m["role"] in {"user", "assistant"}][:-1]  # 去掉最后的本轮 user
    assert history_part == [
        {"role": "user", "content": "把第一页改温柔点"},
        {"role": "assistant", "content": "好的,已经把第一页改得更温柔了。"},
    ]
    # 结构顺序:system 在最前,本轮富上下文 user(带 focusedPageTexts)在最后。
    assert msgs[0]["role"] == "system"
    assert msgs[-1]["role"] == "user"
    last_payload = json.loads(msgs[-1]["content"])
    assert "focusedPageTexts" in last_payload  # 最后一条才是本轮富上下文
    # 历史里没有任何 tool 消息 / tool_calls 残留。
    assert all(m["role"] != "tool" for m in msgs)
    assert all("tool_calls" not in m for m in msgs[:-1])


@pytest.mark.asyncio
async def test_degrade_on_missing_deepseek_key(monkeypatch):
    """④ 缺 deepseek key 且无注入 complete => 保守降级,绝不打空 key 请求。"""
    from src.settings import get_settings

    settings = get_settings()
    monkeypatch.setattr(settings, "deepseek_api_key", None, raising=False)

    result = await edit_loop.run_edit_loop(
        _req("change to English"),
        tools_data=FakeTools(),
        complete=None,
    )

    assert result.degraded is True
    assert result.patches == []
    assert result.pagesTexts == {}
