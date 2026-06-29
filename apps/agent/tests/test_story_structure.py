from __future__ import annotations

import importlib
from pathlib import Path


AGENT_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = AGENT_ROOT / "src"


def test_story_business_modules_are_grouped_under_story_package():
    modules = (
        "src.story.context",
        "src.story.flow",
        "src.story.patches",
        "src.story.progress",
        "src.story.schema",
        "src.story.web_client",
    )

    for name in modules:
        importlib.import_module(name)


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


def test_legacy_story_imports_remain_compatible():
    from src.agents.editing import handler as edit_handler
    from src.agents.writing import handler as writing_handler

    assert callable(edit_handler.run)
    assert callable(writing_handler.run)
    assert callable(writing_handler.build_messages)
