"""V3 主题/章节配色推荐器(§4.3 / §6 / §8,issue #189 / WP3.1)。

端点是 `POST /v3/recommend`(§8.1:同步 / 识图模型);它承载两个 recommend Skill
(现在纯按章 —— 没有 album 级 themeOptions,#236):

  * recommend-theme          → 每章一个 `subject`(单行章节标题,扎根于该章照片 + 故事)。
                               用户确认;apply-theme 把它持久化为章节标题。
  * recommend-chapter-colors → 每章一组 {accentColor, artFont}。`artFont` 必须是 4 个
                               ArtFontPack 成员之一;`accentColor` 必须是 `#hex`。两者都
                               在下面被钳/校验,使漂移的模型绝无法注入非法字体或非 hex 颜色。

模型【只】产出建议 —— 它绝不臆造 templateId / pageIndex(那些归确定性引擎,§8.3)。
recommend 产出的是 *候选*;树由 WP3.2 `apply-theme` 在用户确认后才写
(§4.1:theme 环节填那些 null 占位)。recommend 不推进 stage(§8.3 stage 推进权在 Web)。

识图模型 slot 复用(§6.8 第 2 条):与 describe-content(`vision.describe_content`)相同
的 OpenAI 主 /火山-failover 策略。recommend 的输入【只有】文字(章节描述 + 逐照片
sceneDescription + analysis summary);没有 base64 到达此端点(V3RecommendRequest 契约
不带),所以这里没有东西可供 `color_sampling.sample_dominant_color` 取样,也没有图片形态
的东西可记录(§3 隐私在构造上成立)。

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
    V3ChapterColorRecommendation,
    V3ChapterOverview,
    V3Models,
    V3RecommendRequest,
    V3RecommendResponse,
    V3Usage,
)
from ...engine.finalize_color import finalize_color
from ...settings import get_settings
from ...prompts import RULES_DIR, load_prompt, load_replies
from ... import ai_client
from ...vision_provider import (
    VisionSlot,
    VisionSlotError,
    ark_vision_slot,
    openai_vision_slot,
)

_PROMPT_DIR = Path(__file__).resolve().parent

log = get_logger("recommend_v3")

CompleteFn = Callable[..., Awaitable[dict[str, Any]]]

# 封闭的合法集(镜像契约)。漂移的模型输出被强制收回这些集合,使响应总能通过
# V3RecommendResponse 校验。
_ART_FONTS: tuple[str, ...] = tuple(get_args(ArtFontPack))
_DEFAULT_FONT = "serif-classic"
# 契约里 subject(章节标题)是 min(1);钳到一个合理的标题长度,免得漂移的长 subject 撑爆
# 槽位。Fallback 文本外置在可手调的 replies.md(subject_fallback),保持响应有效。
_MAX_SUBJECT_LEN = 80


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
        load_prompt(_PROMPT_DIR / "recommend_theme.md")
        # === 章节配色与艺术字体 === 标题已并入 theme_colors.md 顶部,这里只拼接。
        + "\n\n"
        + load_prompt(
            RULES_DIR / "theme_colors.md",
            LANGUAGE=lang_name,
            ART_FONTS=", ".join(_ART_FONTS),
            common=("json_only", "grounding", "privacy"),
        )
    )
    payload: dict[str, Any] = {
        "language": req.language,
        "analysisSummary": req.analysisSummary or "",
        "userMessage": req.userMessage or "",
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
    """③ recommend(§8 同步)。一次识图模型调用 → 主题候选 + 每章
    {accentColor, artFont}。`complete` 在测试里注入;生产用 OpenAI 主 /火山-failover 的
    slot 策略(`_complete`)。"""
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
    """跑 recommend 调用。返回 (response, resolved_model)。

    测试路径:注入的 `complete` 顶替上游调用(模型名未知 → None)。生产路径:识图模型
    slot 复用 —— 先试 OpenAI (GPT-5.5 Mini),传输失败 / 缺 key 时降级火山 doubao,与
    describe-content 完全一致(§6.8 第 2 条)。VisionError 类的不可用【响应】归调用方处理
    (RecommendV3Error),不是烧掉第二个 provider 的理由。"""
    if complete is not None:
        return await complete(messages=messages), None

    settings = get_settings()

    # --- 主:OpenAI (GPT-5.5 Mini) --------------------------------------
    primary_slot: VisionSlot | None = None
    try:
        primary_slot = openai_vision_slot(
            settings,
            timeout_seconds=settings.describe_openai_timeout_seconds,
            model=settings.describe_openai_model,
        )
    except VisionSlotError as exc:
        log.warning("v3_recommend.primary_unconfigured", error=str(exc))

    if primary_slot is not None:
        try:
            response = await _call_slot(primary_slot, messages)
            log.info("v3_recommend.call.ok", provider=primary_slot.provider, model=primary_slot.model)
            return response, primary_slot.model
        except ai_client.AIRequestError as exc:
            log.warning(
                "v3_recommend.primary_failover",
                provider=primary_slot.provider,
                reason=type(exc).__name__,
            )

    # --- FAILOVER:火山 doubao (ARK) -----------------------------------------
    try:
        fallback_slot = ark_vision_slot(settings)
    except VisionSlotError as exc:
        raise RecommendV3Error(
            f"recommend failover unavailable (火山 slot): {exc}"
        ) from exc
    try:
        response = await _call_slot(fallback_slot, messages)
    except ai_client.AIRequestError as exc:
        raise RecommendV3Error(f"recommend火山 failover failed: {exc}") from exc
    log.info("v3_recommend.failover.ok", provider=fallback_slot.provider, model=fallback_slot.model)
    return response, fallback_slot.model


async def _call_slot(slot: VisionSlot, messages: list[dict[str, str]]) -> dict[str, Any]:
    """在 `slot` 上做一次 recommend 调用。纯文字(无图)—— recommend 从不发送
    base64 —— 但它复用 vision slot 的 provider 怪癖(json_object / thinking 开关),
    因为这一环节归识图模型所有(§8.1)。"""
    return await ai_client.chat_completion(
        base_url=slot.base_url,
        api_key=slot.api_key,
        model=slot.model,
        messages=messages,
        timeout_seconds=slot.timeout_seconds,
        temperature=0.4,
        max_tokens=1800,
        response_format=slot.response_format,
        extra_body=slot.extra_body,
    )


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
        visionCallCount=1,
        planningInputTokens=prompt_tokens,
        planningOutputTokens=completion_tokens,
        # recommend 跑在识图(vision)slot 上;已知时把它报告为 models.vision。strict
        # schema 拒绝给可选 model-name 字段显式传 None,所以仅在解析出来时才包含它。
        models=V3Models(**({"vision": model} if model else {})),
    )


# ---------- 响应矫正 -------------------------------------------------


def _coerce_response(
    req: V3RecommendRequest,
    parsed: dict[str, Any],
    usage: V3Usage,
) -> V3RecommendResponse:
    chapter_colors = _coerce_chapter_colors(req, parsed.get("chapterColors"))
    reply = _text(parsed.get("assistantReply")) or _default_reply(req.language)
    return V3RecommendResponse(
        chapterColors=chapter_colors,
        assistantReply=reply[:500],
        usage=usage,
    )


def _coerce_chapter_colors(
    req: V3RecommendRequest, raw: Any
) -> list[V3ChapterColorRecommendation]:
    """每个输入章节恰好一组 {subject, accentColor, artFont},按输入顺序。

    Grounding 护栏(§8.3 模型出意图、代码保合法):
      * subject(章节标题)被 trim + 钳到合理的标题长度;缺失/空的 subject → 一个中性
        占位,使响应总能通过校验(契约 min(1))。
      * artFont 被钳到 4 成员的 ArtFontPack —— 非法/缺失的字体 → 默认字体,绝不用注入值。
      * accentColor 被归一化为 `#RRGGBB`;非法/缺失的颜色 → 中性 fallback。模型绝无法把
        非 hex 颜色发进树里。
      * 每个输入章节恰好得到一条(模型遗漏的章节用 fallback 的 subject+颜色+字体填上)——
        recommend 绝不丢章,apply-theme 可依赖完整覆盖。
    """
    by_id: dict[str, dict[str, Any]] = {}
    if isinstance(raw, list):
        for item in raw:
            if not isinstance(item, dict):
                continue
            cid = _text(item.get("chapterId"))
            if cid and cid not in by_id:
                by_id[cid] = item

    out: list[V3ChapterColorRecommendation] = []
    for chapter in req.chapters:
        item = by_id.get(chapter.chapterId, {})
        subject = _coerce_subject(item.get("subject"))
        accent = _coerce_accent(item.get("accentColor"))
        font = _coerce_font(item.get("artFont"))
        out.append(
            V3ChapterColorRecommendation(
                chapterId=chapter.chapterId,
                subject=subject,
                accentColor=accent,
                artFont=font,  # type: ignore[arg-type]
            )
        )
    return out


def _replies() -> dict[str, str]:
    """recommend 的兜底/默认文案(可手调,replies.md;按路径缓存)。"""
    return load_replies(_PROMPT_DIR / "replies.md")


def _coerce_subject(raw: Any) -> str:
    """Trim + 钳章节 subject(标题);回退到一个中性占位(replies.md 的 subject_fallback)。

    去掉一个结尾的句点/句号(skill 已要求模型省略),使漂移的输出仍读起来是一行干净的标题。"""
    subject = _text(raw)
    subject = subject.rstrip(".。!! ?? ")
    if not subject:
        return _replies().get("subject_fallback", "")
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
    """从可手调的 replies.md 读兜底回复(`reply.语言`),按路径缓存。"""
    lang = "zh" if language == "zh" else "en"
    return _replies().get(f"reply.{lang}", "")
