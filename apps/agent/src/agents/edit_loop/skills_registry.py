"""编辑 skill 的渐进式加载(Claude Code 式)。

主控 AI 不需要一开始就把所有「怎么写好文案 / 什么时候换版式 / 换图怎么判断」的经验
全塞进 system prompt(那样上下文会随 skill 增多而膨胀,每次调用都白背)。这里做**渐进式加载**:

  1. 启动扫 `skills/*.md`,只解析每个 skill 的 frontmatter(name + description),
     生成一份**清单**(仅 name+一句话)放进主控上下文 —— 便宜、恒定小。
  2. 主控自己判断这次要不要某个 skill;要就调 `read_skill(name)` 工具,把那个 skill 的
     **完整 markdown** 读进来(回喂进 loop)。只加载真正用到的。

skill 文件格式(YAML-ish frontmatter + markdown 正文):

    ---
    name: writing_copy
    description: 怎么为一页写好文案……
    ---

    # 正文(完整手艺指南)……

frontmatter 只需 name / description 两个键(简单解析,不引 YAML 依赖)。正文是给主控读的
完整内容。按路径 lru_cache。
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

SKILLS_DIR = Path(__file__).resolve().parent / "skills"


@dataclass(frozen=True)
class SkillMeta:
    """一个 skill 的清单条目(不含正文)。"""

    name: str
    description: str


def _parse_frontmatter(text: str) -> tuple[dict[str, str], str]:
    """极简 frontmatter 解析:`--- \n key: value \n --- \n 正文`。

    只认 name/description 这类单行 `key: value`;没有 frontmatter 时返回 ({}, 全文)。
    不引 YAML 依赖(键就两个,单行值,够用且零依赖)。"""
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}, text
    meta: dict[str, str] = {}
    body_start = len(lines)
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            body_start = i + 1
            break
        line = lines[i].strip()
        if not line or ":" not in line:
            continue
        key, _, value = line.partition(":")
        meta[key.strip()] = value.strip()
    body = "\n".join(lines[body_start:]).strip()
    return meta, body


@lru_cache(maxsize=1)
def list_skills() -> tuple[SkillMeta, ...]:
    """扫 skills 目录,返回清单(name+description)。按目录内容 lru_cache(进程内恒定)。

    缺目录 / 缺 frontmatter 的文件被跳过(name 回退成文件名,description 回退空)。"""
    if not SKILLS_DIR.is_dir():
        return ()
    out: list[SkillMeta] = []
    for path in sorted(SKILLS_DIR.glob("*.md")):
        meta, _ = _parse_frontmatter(path.read_text(encoding="utf-8"))
        name = meta.get("name") or path.stem
        out.append(SkillMeta(name=name, description=meta.get("description", "")))
    return tuple(out)


def skills_catalog_text() -> str:
    """把清单渲染成一段可读文本,嵌进主控上下文(只 name+描述,不含正文)。"""
    skills = list_skills()
    if not skills:
        return ""
    lines = [f"- `{s.name}`:{s.description}" for s in skills]
    return "\n".join(lines)


@lru_cache(maxsize=None)
def read_skill(name: str) -> str | None:
    """读某个 skill 的完整正文(不含 frontmatter)。找不到返回 None。按 name lru_cache。

    name 匹配 frontmatter 的 name(回退文件名 stem)。"""
    if not name or not SKILLS_DIR.is_dir():
        return None
    for path in sorted(SKILLS_DIR.glob("*.md")):
        meta, body = _parse_frontmatter(path.read_text(encoding="utf-8"))
        if (meta.get("name") or path.stem) == name:
            return body
    return None
