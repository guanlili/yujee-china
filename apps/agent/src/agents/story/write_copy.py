"""一次性写满一整章文案(排版后调用)。

背景(流程重构):文案不再等用户进编辑器逐章对话写,而是**排版评委选定版式后当场写满**。
这里把 story handler 的 write 逻辑抽成一个**不依赖 V3ChapterChatRequest** 的纯函数:
只需要 chapter(含 sceneDescription/chapterContext)+ 该章的 pages(版式已定,含模板+图槽),
产出每页每 slot 的文案。

复用 handler 的底层组装(slot 规格 / 场景背景 / 图片映射 / 示例 / 清洗),保证和「章节故事
逐章写」同一套文风与契约(单一真相源)—— 用户进编辑器后在章节故事里「改」的,就是这里写的。

写作 skill(writing_style / grounding / guidance_style)在这一步(写文案时)加载进 prompt,
和 handler.build_messages 完全一致。

降级:某章写文案失败(模型不可用/超时/解析失败)=> 返回「只填页码、用户 slot 留空」的 pages,
绝不抛错、绝不拖垮整个排版任务(judge_layout 逐章隔离调用)。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ... import ai_client
from ...schemas import Page, V3Chapter, V3PageTextsPatch
from ...settings import get_settings
from ...skills import SKILLS_DIR, load_prompt
from . import handler

_PROMPT_DIR = Path(__file__).resolve().parent


def _write_system_prompt() -> str:
    """写文案 system prompt:write_all.md(一次性写满整章的契约)+ 写作 skill(与章节故事同源)。

    写作 skill(writing_style / grounding)在这一步加载 —— 保证一次性写文案和「章节故事逐章写」
    同一套文风。不加载 guidance_style / chapter_chat_turns(那些是对话引导/kind 分诊,写满整章
    不需要)。"""
    system = load_prompt(_PROMPT_DIR / "write_all.md")
    system += "\n\n" + load_prompt(SKILLS_DIR / "writing_style.md", skills=("grounding",))
    return system


def _build_write_messages(
    chapter: V3Chapter, pages: list[Page], language: str
) -> list[dict[str, str]]:
    """组装一次性写文案的 messages。复用 handler 的逐页组装,但 payload 去掉对话专用字段
    (history / userMessage / focusedPageNumber)—— 这是「写满整章」,不是对话轮次。"""
    slot_specs = handler._page_slot_specs_by_index(pages)
    page_images = handler._page_images_by_index(pages)
    page_examples = handler._page_output_examples_by_index(pages, slot_specs)

    payload: dict[str, Any] = {
        "language": language,
        # 章节背景(采访答案):第一手真实素材,优先于识图推断。空串=用户跳过采访 => 照图写。
        "chapterContext": (chapter.chapterContext or "") if chapter else "",
        # 画面背景:逐照片 sceneDescription。
        "sceneBackground": handler._scene_background(chapter),
        # 逐页创作槽规格 / 示例 / 图片映射。
        "pageSlots": {str(idx): specs for idx, specs in slot_specs.items()},
        "pageOutputExamples": {str(idx): ex for idx, ex in page_examples.items()},
        "pageImages": {str(idx): imgs for idx, imgs in page_images.items()},
    }
    return [
        {"role": "system", "content": _write_system_prompt()},
        {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
    ]


def _pages_texts_from_raw(raw: Any, pages: list[Page]) -> list[V3PageTextsPatch]:
    """把模型输出转成逐页 V3PageTextsPatch。每页只保留其模板创作槽、钳到 maxChars;
    模型遗漏的页返回空 texts(绝不丢页、绝不臆造槽)。与 handler._coerce_pages_texts 同语义。"""
    raw_by_index = handler._raw_texts_by_index(raw)
    slot_specs = handler._page_slot_specs_by_index(pages)
    out: list[V3PageTextsPatch] = []
    for page in pages:
        specs = slot_specs.get(page.pageIndex, [])
        texts = handler._clean_texts(
            raw_by_index.get(page.pageIndex, {}), specs, template_id=page.templateId
        )
        out.append(V3PageTextsPatch(pageIndex=page.pageIndex, texts=texts))
    return out


def _empty_pages_texts(pages: list[Page]) -> list[V3PageTextsPatch]:
    """降级产物:每页空 texts(用户 slot 留空)。等同「今天排版后的空文案态」,不破坏流程。"""
    return [V3PageTextsPatch(pageIndex=page.pageIndex, texts={}) for page in pages]


async def write_chapter_copy(
    chapter: V3Chapter,
    pages: list[Page],
    language: str,
    *,
    complete: Any = None,
) -> tuple[list[V3PageTextsPatch], int, int]:
    """为一整章一次性写满文案。返回 (pages_texts, input_tokens, output_tokens)。

    `complete` 注入 LLM 调用(测试覆盖);None 走真实 DeepSeek 写作槽。
    任何失败都**降级为空文案**(不抛),让排版继续、用户进编辑器再改。
    """
    if not pages:
        return [], 0, 0
    try:
        messages = _build_write_messages(chapter, pages, language)
        response = await handler._complete(
            messages, complete=complete, max_tokens=1800, temperature=0.35
        )
        parsed = handler._parse_model_json(response)
        raw_pages = parsed.get("pagesTexts") if isinstance(parsed, dict) else None
        pages_texts = _pages_texts_from_raw(raw_pages, pages)
        in_tok, out_tok = ai_client.extract_usage(response)
        return pages_texts, in_tok, out_tok
    except Exception as exc:  # noqa: BLE001 —— 写文案失败绝不拖垮排版;该章留空,用户再改
        ai_client.trace_marker(
            "write_chapter_copy.degrade",
            input=f"chapterId={getattr(chapter, 'chapterId', '?')}; err={type(exc).__name__}",
        )
        return _empty_pages_texts(pages), 0, 0
