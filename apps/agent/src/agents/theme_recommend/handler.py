"""V3 Stage4 主题推荐器(§4.3 / §6 / §8,issue #189 / PR #249 Stage4)。

端点是 `POST /v3/recommend`(§8.1:同步 / DeepSeek planning slot)。它基于全书章节
overview、Stage1 提取色(`extractedColor`)和可选字体倾向(`fontHint`)推荐三组全书级主题:
每组一个 `artFont`、一套逐章最终 `accentColor`、以及可选 label/style。用户选中一组后,
Web 把它展开成 `V3ChapterThemeChoice[]` 交给 apply-theme。

模型【只】产出建议 —— 它绝不臆造 templateId / pageIndex(那些归确定性引擎,§8.3)。
recommend 产出的是 *候选*;树由 WP3.2 `apply-theme` 在用户确认后才写
(§4.1:theme 环节填那些 null 占位)。recommend 不推进 stage(§8.3 stage 推进权在 Web)。

recommend 的输入【只有】文字(章节描述 + 逐照片 sceneDescription + analysis summary +
extractedColor + fontHint);没有 base64 到达此端点(V3RecommendRequest 契约不带),也没有
图片形态的东西可记录(§3 隐私在构造上成立)。

无状态 (§3):Agent 不持 draft/stage;Web 拥有树 + stage 并负责合并。本模块不保留任何
模块级状态。
"""

from __future__ import annotations

import json
import time
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any, get_args

from ...logging_config import get_logger
from ...schemas import (
    ArtFontPack,
    V3BookThemeOption,
    V3ChapterOverview,
    V3ChapterThemeColor,
    V3Models,
    V3RecommendRequest,
    V3RecommendResponse,
    V3Usage,
)
from ...engine.finalize_color import finalize_color
from ...settings import get_settings
from ...skills import SKILLS_DIR, load_prompt, load_replies
from ... import ai_client

_PROMPT_DIR = Path(__file__).resolve().parent

log = get_logger("recommend_v3")

CompleteFn = Callable[..., Awaitable[dict[str, Any]]]

# 封闭的合法集(镜像契约)。漂移的模型输出被强制收回这些集合,使响应总能通过
# V3RecommendResponse 校验。
_ART_FONTS: tuple[str, ...] = tuple(get_args(ArtFontPack))
_DEFAULT_FONT = "serif-classic"
# subject(章节标题)可选;若模型给出则钳到合理长度,免得漂移的长 subject 撑爆槽位。
_MAX_SUBJECT_LEN = 80
_MAX_OPTION_ID_LEN = 80
_MAX_OPTION_TEXT_LEN = 160


class RecommendV3Error(Exception):
    """recommend 模型调用或其 JSON 响应不可用时抛。

    路由把它映射成 HTTP 错误码(§8.3 同步端点走 HTTP 错误码);前端可重试而不污染 stage。"""


# ---------- prompt 组装 ---------------------------------------------------


def _lang_name(language: str) -> str:
    """供 skill `{LANGUAGE}` 占位用的人类语言名(镜像 vision.py)。"""
    return "Chinese" if language == "zh" else "English"


def _chapter_payload(chapter: V3ChapterOverview) -> dict[str, Any]:
    """一章的 recommend 输入(§8 表):description + 逐照片场景。

    在构造上隐私干净 —— `V3ChapterOverview`(`_V3Strict`)在解析时就禁止任何
    GPS/place 字段,而 photoDescs 是自由文本的场景句子。"""
    return {
        "chapterId": chapter.chapterId,
        "description": chapter.description,
        "extractedColor": chapter.extractedColor,
        "photoDescs": list(chapter.photoDescs),
    }


def build_messages(req: V3RecommendRequest) -> list[dict[str, str]]:
    """从章节 overview + analysis summary 构建 recommend prompt。

    system prompt 固定 STRICT JSON 契约 + 两个 skill 任务以及封闭的字体/颜色合法集;
    user payload 承载章节 overview、全局 analysis summary,以及任何用户引导
    (`userMessage`)。两个 skill 都作为 prompt 资产加载(集中维护);recommend_theme
    的语言不再强制(SUBJECT/assistantReply 跟随用户语言)。"""
    lang_name = _lang_name(req.language)
    system = (
        load_prompt(_PROMPT_DIR / "recommend_theme.md", skills=("book_theme_options",))
        # === 章节配色与艺术字体 === 标题已并入 theme_colors.md 顶部,这里只拼接。
        + "\n\n"
        + load_prompt(
            SKILLS_DIR / "theme_colors.md",
            LANGUAGE=lang_name,
            ART_FONTS=", ".join(_ART_FONTS),
            skills=("grounding",),
        )
    )
    payload: dict[str, Any] = {
        "language": req.language,
        "analysisSummary": req.analysisSummary or "",
        "userMessage": req.userMessage or "",
        "fontHint": req.fontHint or "",
        "chapters": [_chapter_payload(c) for c in req.chapters],
    }
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
    ]


# ---------- 模型调用 --------------------------------------------------------


async def run(
    req: V3RecommendRequest,
    *,
    complete: CompleteFn | None = None,
) -> V3RecommendResponse:
    """③ recommend(§8 同步)。一次 DeepSeek 调用 → 3 组全书级主题选项。"""
    started = time.monotonic()
    messages = build_messages(req)
    response, model = await _complete(messages, complete=complete)
    parsed = _parse_model_json(response)
    duration_ms = int((time.monotonic() - started) * 1000)
    usage = _usage_from_response(response, duration_ms, model)
    return _coerce_response(req, parsed, usage)


async def _complete(
    messages: list[dict[str, str]],
    *,
    complete: CompleteFn | None,
) -> tuple[dict[str, Any], str | None]:
    """跑 recommend 调用。返回 (response, resolved_model)。"""
    if complete is not None:
        return await complete(messages=messages), None

    settings = get_settings()
    if not settings.deepseek_api_key:
        raise RecommendV3Error("DEEPSEEK_API_KEY missing; cannot run recommend")
    try:
        response = await ai_client.chat_completion(
            base_url=settings.deepseek_base_url,
            api_key=settings.deepseek_api_key,
            model=settings.deepseek_model,
            messages=messages,
            timeout_seconds=settings.deepseek_timeout_seconds,
            response_format=(
                {"type": "json_object"} if settings.deepseek_use_json_object else None
            ),
            max_tokens=2400,
            temperature=0.4,
            extra_body=(
                {"thinking": {"type": "disabled"}} if settings.deepseek_disable_thinking else None
            ),
        )
    except ai_client.AIRequestError as exc:
        raise RecommendV3Error(f"recommend model call failed: {exc}") from exc
    log.info("v3_recommend.call.ok", provider="deepseek", model=settings.deepseek_model)
    return response, settings.deepseek_model


def _parse_model_json(response: dict[str, Any]) -> dict[str, Any]:
    try:
        parsed = ai_client.parse_json_loose(ai_client.extract_text(response))
    except ValueError as exc:
        raise RecommendV3Error(
            f"recommend model response was not valid JSON: {exc}"
        ) from exc
    if not isinstance(parsed, dict):
        raise RecommendV3Error(
            f"recommend model response must be an object, got {type(parsed).__name__}"
        )
    return parsed


def _usage_from_response(
    response: dict[str, Any], duration_ms: int, model: str | None
) -> V3Usage:
    prompt_tokens, completion_tokens = ai_client.extract_usage(response)
    return V3Usage(
        durationMs=duration_ms,
        planningInputTokens=prompt_tokens,
        planningOutputTokens=completion_tokens,
        models=V3Models(**({"planning": model} if model else {"planning": get_settings().deepseek_model})),
    )


# ---------- 响应矫正 -------------------------------------------------


def _coerce_response(
    req: V3RecommendRequest,
    parsed: dict[str, Any],
    usage: V3Usage,
) -> V3RecommendResponse:
    options = _coerce_book_theme_options(req, parsed.get("bookThemeOptions"))
    reply = _text(parsed.get("assistantReply")) or _default_reply(req.language)
    return V3RecommendResponse(
        bookThemeOptions=options,
        assistantReply=reply[:500],
        usage=usage,
    )


def _coerce_book_theme_options(
    req: V3RecommendRequest, raw: Any
) -> list[V3BookThemeOption]:
    """Coerce model output into exactly three complete book-level theme options."""
    raw_options = raw if isinstance(raw, list) else []
    out: list[V3BookThemeOption] = []
    used_ids: set[str] = set()

    for index in range(3):
        item = raw_options[index] if index < len(raw_options) and isinstance(raw_options[index], dict) else {}
        fallback_id = f"opt-{index + 1}"
        option_id = _coerce_option_id(item.get("optionId"), fallback_id, used_ids)
        used_ids.add(option_id)
        out.append(
            V3BookThemeOption(
                optionId=option_id,
                artFont=_coerce_font(item.get("artFont")),  # type: ignore[arg-type]
                chapters=_coerce_option_chapters(req, item.get("chapters")),
                **_optional_text_fields(item),
            )
        )
    return out


def _coerce_option_id(raw: Any, fallback: str, used: set[str]) -> str:
    candidate = _text(raw)[:_MAX_OPTION_ID_LEN]
    if candidate and candidate not in used:
        return candidate
    if fallback not in used:
        return fallback
    counter = 2
    while True:
        suffix = f"-{counter}"
        base = fallback[: _MAX_OPTION_ID_LEN - len(suffix)]
        candidate = f"{base}{suffix}"
        if candidate not in used:
            return candidate
        counter += 1


def _optional_text_fields(item: dict[str, Any]) -> dict[str, str]:
    out: dict[str, str] = {}
    for key in ("style", "label"):
        value = _text(item.get(key))
        if value:
            out[key] = value[:_MAX_OPTION_TEXT_LEN]
    return out


def _coerce_option_chapters(
    req: V3RecommendRequest, raw: Any
) -> list[V3ChapterThemeColor]:
    """Each option covers every requested chapter exactly once, in request order."""
    by_id: dict[str, dict[str, Any]] = {}
    if isinstance(raw, list):
        for item in raw:
            if not isinstance(item, dict):
                continue
            cid = _text(item.get("chapterId"))
            if cid and cid not in by_id:
                by_id[cid] = item

    out: list[V3ChapterThemeColor] = []
    for chapter in req.chapters:
        item = by_id.get(chapter.chapterId, {})
        subject = _coerce_subject(item.get("subject"))
        accent = _coerce_accent(item.get("accentColor"))
        kwargs: dict[str, Any] = {"chapterId": chapter.chapterId, "accentColor": accent}
        if subject:
            kwargs["subject"] = subject
        out.append(V3ChapterThemeColor(**kwargs))
    return out


def _replies() -> dict[str, str]:
    """recommend 的兜底/默认文案(skills/replies/theme_recommend.md;按路径缓存)。"""
    return load_replies(SKILLS_DIR / "replies" / "theme_recommend.md")


def _coerce_subject(raw: Any) -> str:
    """Trim + 钳章节 subject(标题);空值保持缺省。

    去掉一个结尾的句点/句号(skill 已要求模型省略),使漂移的输出仍读起来是一行干净的标题。"""
    subject = _text(raw)
    subject = subject.rstrip(".。!! ?? ")
    return subject[:_MAX_SUBJECT_LEN]


def _coerce_font(raw: Any) -> str:
    candidate = raw.strip() if isinstance(raw, str) else ""
    return candidate if candidate in _ART_FONTS else _DEFAULT_FONT


def _coerce_accent(raw: Any) -> str:
    """Normalize model color through the shared design-color owner."""
    return finalize_color(raw)


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) and value.strip() else ""


def _default_reply(language: str) -> str:
    """从 skills/replies/theme_recommend.md 读兜底回复(`reply.语言`),按路径缓存。"""
    lang = "zh" if language == "zh" else "en"
    return _replies().get(f"reply.{lang}", "")
