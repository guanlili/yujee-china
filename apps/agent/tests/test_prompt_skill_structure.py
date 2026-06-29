from pathlib import Path


AGENT_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = AGENT_ROOT / "src"
SKILLS_ROOT = SRC_ROOT / "skills"
AGENTS_ROOT = SRC_ROOT / "agents"


def test_human_authored_prompt_assets_live_under_skills():
    assert SKILLS_ROOT.is_dir()
    assert not (SRC_ROOT / "prompts").exists()

    expected = {
        "grounding.md",
        "chapter_grouping.md",
        "cluster_grouping.md",
        "describe_retry.md",
        "page_assignment.md",
        "writing_style.md",
        "guidance_style.md",
        "theme_colors.md",
        "image_edit_selection.md",
        "page_intent_routing.md",
        "page_text_editing.md",
        "chapter_chat_turns.md",
        "book_theme_options.md",
        "replies/page_edit.md",
        "replies/theme_recommend.md",
        "replies/writing.md",
    }
    removed = {"json_only.md", "persona.md", "privacy.md"}
    missing = [name for name in sorted(expected) if not (SKILLS_ROOT / name).is_file()]
    lingering = [name for name in sorted(removed) if (SKILLS_ROOT / name).exists()]
    assert missing == []
    assert lingering == []


def test_agents_markdown_only_describes_role_input_and_output_contracts():
    assert list(AGENTS_ROOT.glob("*/replies.md")) == []

    banned_rule_markers = (
        "## 怎么",
        "## 主动推进",
        "## 风格",
        "兜底/默认",
        "可手调",
        "遵循下方",
    )
    offenders: list[str] = []
    for path in sorted(AGENTS_ROOT.glob("*/*.md")):
        text = path.read_text(encoding="utf-8")
        if any(marker in text for marker in banned_rule_markers):
            offenders.append(str(path.relative_to(AGENT_ROOT)))
    assert offenders == []


def test_chapter_describer_and_unplaced_refiner_have_separate_prompts():
    describe_content = (
        AGENTS_ROOT / "image_understanding" / "describe_content.md"
    ).read_text(encoding="utf-8")
    chapter_prompt = (
        AGENTS_ROOT / "chapter_describer" / "describe_chapters.md"
    ).read_text(encoding="utf-8")
    refiner_prompt = (
        AGENTS_ROOT / "unplaced_refiner" / "refine_unplaced.md"
    ).read_text(encoding="utf-8")

    assert "prompt:describe_chapters" not in describe_content
    assert "prompt:refine_unplaced" not in describe_content
    assert "章节级理解" in chapter_prompt
    assert "你是补充分章使徒" not in chapter_prompt
    assert "你是补充分章使徒" in refiner_prompt
    assert "章节级理解" not in refiner_prompt
    assert "Focus on chapter-level understanding" not in chapter_prompt
    assert "You refine memoir chapter assignments" not in refiner_prompt


def test_prompt_loader_and_agents_use_skills_terms():
    scanned = [SKILLS_ROOT / "__init__.py", *sorted(AGENTS_ROOT.glob("**/*.py"))]
    offenders: dict[str, list[str]] = {}
    banned_terms = (
        "RULES_DIR",
        "COMMON_DIR",
        "common=(",
        "prompts/",
        "src.prompts",
        "...prompts",
        "json_only",
        "privacy",
        "persona_block",
    )
    for path in scanned:
        text = path.read_text(encoding="utf-8")
        hits = [term for term in banned_terms if term in text]
        if hits:
            offenders[str(path.relative_to(AGENT_ROOT))] = hits
    assert offenders == {}
