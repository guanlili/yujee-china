from __future__ import annotations

import importlib
from pathlib import Path


AGENT_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = AGENT_ROOT / "src"


def test_shared_story_business_modules_are_grouped_under_story_package():
    """编辑环节迁到 agents/edit_loop 后,story 包只留跨流程共享的纯工具。"""
    modules = (
        "src.story.patches",
        "src.story.schema",
        "src.story.web_client",
    )

    for name in modules:
        importlib.import_module(name)


def test_edit_loop_is_self_contained():
    """Stage3 编辑全部住在 agents/edit_loop:flow / controller / context / tools /
    edit_text / helpers / progress / navigation。"""
    modules = (
        "src.agents.edit_loop.flow",
        "src.agents.edit_loop.controller",
        "src.agents.edit_loop.context",
        "src.agents.edit_loop.tools",
        "src.agents.edit_loop.edit_text",
        "src.agents.edit_loop.helpers",
        "src.agents.edit_loop.progress",
        "src.agents.edit_loop.navigation",
    )

    for name in modules:
        importlib.import_module(name)

    from src.agents.edit_loop import run_edit_loop
    from src.agents.edit_loop.flow import EditChatError, run

    assert callable(run_edit_loop)
    assert callable(run)
    assert issubclass(EditChatError, RuntimeError)


def test_old_editing_modules_are_gone():
    """旧分散的编辑代码已删除(flow / context / progress / editing / page_edit)。"""
    for path in (
        SRC_ROOT / "story" / "flow.py",
        SRC_ROOT / "story" / "context.py",
        SRC_ROOT / "story" / "progress.py",
        SRC_ROOT / "agents" / "editing",
        SRC_ROOT / "agents" / "page_edit",
    ):
        assert not path.exists(), f"expected {path} to be deleted"


def test_story_agent_and_tool_modules_have_clear_homes():
    modules = (
        "src.agents.story.handler",
        "src.agents.story.schema",
        "src.agents.tools.image_edit",
        "src.agents.tools.image_inspect",
        "src.agents.tools.layout",
        "src.agents.tools.text",
    )

    for name in modules:
        importlib.import_module(name)

    assert (SRC_ROOT / "agents" / "story" / "story.md").is_file()


def test_chapter_chat_writer_imports_remain_compatible():
    from src.agents.writing import handler as writing_handler

    assert callable(writing_handler.run)
    assert callable(writing_handler.build_messages)
