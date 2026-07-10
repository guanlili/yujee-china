from pathlib import Path


AGENT_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = AGENT_ROOT / "src"
SKILLS_ROOT = SRC_ROOT / "skills"
AGENTS_ROOT = SRC_ROOT / "agents"
# 识图/排版的模型调用单元已并入 workflow 内核层(chaptering/layout 下)。
CHAPTERING_ROOT = SRC_ROOT / "workflows" / "core" / "chaptering"


def test_no_markdown_assets_left_under_skills():
    assert SKILLS_ROOT.is_dir()
    assert not (SRC_ROOT / "prompts").exists()

    # 写作/排版/主题这类共享 skill 的单一真相源已迁到
    # packages/contracts/skills/<name>/SKILL.md(带 frontmatter,只有 design-agent 消费)。
    # engine 侧 skills/ 只剩 prompt 加载器;各 workflow 的 prompt 正文放在自己模块目录下。
    lingering = sorted(str(p.relative_to(SKILLS_ROOT)) for p in SKILLS_ROOT.glob("**/*.md"))
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
    chapter_prompt = (
        CHAPTERING_ROOT / "chapter_describer" / "describe_chapters.md"
    ).read_text(encoding="utf-8")
    refiner_prompt = (
        CHAPTERING_ROOT / "unplaced_refiner" / "refine_unplaced.md"
    ).read_text(encoding="utf-8")

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
