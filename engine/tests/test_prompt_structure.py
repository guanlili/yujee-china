"""Prompt 的存放结构:加载器在 workflows/prompts.py,正文紧挨着加载它的 handler。

这个文件此前叫 test_prompt_skill_structure.py,断言的是【相反】的结构 ——
`src/skills/` 必须存在、`prompts` 是禁用词。可 `src/skills/` 里一个 skill 都没有,
只有一个 prompt 加载器;真正的 skill 在 packages/contracts/skills/(design-agent 消费,
engine 不读)。那些断言在保护一个名不副实的目录名,顺带把重命名也禁掉了。
它还有两个断言 glob 的是早已删除的 `src/agents/` —— 空目录恒为空,永远通过,等于没测。
"""

from pathlib import Path

AGENT_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = AGENT_ROOT / "src"
WORKFLOWS_ROOT = SRC_ROOT / "workflows"


def _prompt_mds():
    """workflows 下的【提示词】.md。排除纯文档(README / *-reference.md)——
    它们紧挨模块放是为了就近参考,不是喂 AI 的 prompt,不必被 handler 加载。"""
    for md in sorted(WORKFLOWS_ROOT.glob("**/*.md")):
        if md.name == "README.md" or md.name.endswith("-reference.md"):
            continue
        yield md


def test_prompt_loader_lives_with_the_workflows_it_serves():
    """加载器在 workflows/ 下,不再是个名不副实的顶层 skills/ 包。"""
    assert (WORKFLOWS_ROOT / "prompts.py").is_file()
    assert not (SRC_ROOT / "skills").exists(), "src/skills/ 里没有 skill,不该复活"


def test_every_prompt_sits_next_to_its_handler():
    """prompt 正文不集中存放 —— 每份 .md 的同级目录里必须有 handler.py。

    集中放 prompt 的代价是:改一个环节的 AI 行为要跨目录找文件,而且很容易改错另一个
    环节的 prompt。就地存放让"改哪个环节就在哪个环节的目录里改"成为结构上的必然。
    """
    prompts = list(_prompt_mds())
    assert prompts, "workflows 下一份 prompt 都没有,肯定哪里错了"

    orphans = [
        str(p.relative_to(SRC_ROOT))
        for p in prompts
        if not (p.parent / "handler.py").is_file()
    ]
    assert orphans == [], f"这些 prompt 旁边没有 handler.py:{orphans}"


def test_every_prompt_is_actually_loaded_by_its_handler():
    """没有孤儿 prompt:每份 .md 都要被同级 handler.py 按文件名引用。

    改了 prompt 却没人读,或删了调用却留下 .md —— 两种都会让人以为某段提示词还在生效。
    """
    unreferenced: list[str] = []
    for prompt in _prompt_mds():
        handler = prompt.parent / "handler.py"
        if not handler.is_file():
            continue  # 上一个测试会报它
        if prompt.name not in handler.read_text(encoding="utf-8"):
            unreferenced.append(str(prompt.relative_to(SRC_ROOT)))
    assert unreferenced == [], f"这些 prompt 没有任何 handler 加载:{unreferenced}"


def test_prompt_loader_fills_placeholders_without_breaking_json_examples():
    """`{KEY}` 用 str.replace 填,不是 str.format —— prompt 正文里有 JSON 示例,
    format 会把那些花括号当占位符炸掉。这是加载器存在的全部理由,必须钉死。"""
    from src.workflows.prompts import load_prompt

    fixture = AGENT_ROOT / "tests" / "_tmp_prompt.md"
    fixture.write_text('语言:{LANGUAGE}\n输出 {"pages":[{"a":1}]}', encoding="utf-8")
    try:
        out = load_prompt(fixture, LANGUAGE="中文")
        assert "语言:中文" in out
        assert '{"pages":[{"a":1}]}' in out, "JSON 示例的花括号被吃掉了"
    finally:
        fixture.unlink()


def test_compose_global_prompt_states_new_rules():
    """三条硬规则必须在 prompt 里:多 title 槽分主副、只用给定时间地点、不许留空。
    同时验证旧 bullet 已删除(防止合并冲突时旧新并存)。"""
    from pathlib import Path

    text = Path("engine/src/workflows/core/compose/compose_global.md").read_text("utf-8")

    # Extract 「规则(硬性)」section for structural anchor (prevents false positives in comments/examples)
    rules_start = text.find("# 规则(硬性)")
    rules_end = text.find("\n# ", rules_start + 1)
    rules_section = text[rules_start:rules_end] if rules_end != -1 else text[rules_start:]

    # Extract 「输入」section for input spec validation
    input_start = text.find("# 输入")
    input_end = text.find("\n# ", input_start + 1)
    input_section = text[input_start:input_end] if input_end != -1 else text[input_start:]

    # New rule 1: Multiple title slots with subtitle distinction
    assert "副标题" in rules_section, "规则必须提及「副标题」—— 主副标题须分别处理"
    assert "绝不重复同一句" in rules_section, "规则必须禁止重复同一句(多 title 防重)"

    # New rule 2: Use only given place/years fields
    assert "place" in input_section and "years" in input_section, \
        "输入描述必须提及 place 和 years 字段"
    assert "只能用" in rules_section and "place" in rules_section and "years" in rules_section, \
        "规则必须明确「时间和地点只能用给出的 place/years」"

    # New rule 3: Never leave slot empty
    assert "不许留空" in rules_section, "规则必须明确禁止「不许留空」"

    # Old bullets must be gone (prevent regression from merge conflicts)
    assert "不要编造具体日期、地名、人名;背景里没有的细节不写。" not in text, \
        "旧 bullet「不要编造具体日期...」已被新规则替换,不应残留"
    assert "- `chapters`:每章一条 `{title, chapterContext}`。" not in text, \
        "chapters 定义已升级到 place/years,旧版本签名不应残留"
