"""V3 apply-theme —— 确定性「一键刷」variableDecor 槽(含 SVG,§4.3 / §9)。

Issue #190 / WP3.2。端点是 `POST /v3/apply-theme`(§8.1:同步 / 确定性 / 无模型调用);
消费 `V3ApplyThemeRequest` DTO(schemas.py ↔ packages/contracts/src/v3.ts —— 单一真相源,
由 WP0.1/0.3 预定义,此处不改)。

apply-theme 做什么(§4.3(b) / §9 `variableDecor`):

  用户已按章选定一组 `{accentColor, artFont}`(§6 第 1 条 章级粒度:每章一色一字体,无逐槽
  自定义)。apply-theme 拿当前扁平页,一键批量刷模板标了 `variableDecor:true` 的每一个槽
  —— 且仅这些槽 —— 刷上该章的主题:

    * variableDecor **svg** 槽(花饰/分隔线/图标,如 mag-13 `divider`):槽内容本身就是装饰,
      所以设为该章 `accentColor`(矢量以该强调色渲染)。这就是「含 SVG 图层填充」验收点。
    * variableDecor **decoration** 文字槽不是颜色的内容载体:已有值(`date`/`dateNum`/`folio`)
      与空值都原样保留。样式挂在树里的章节节点上,颜色字符串只经 SVG 装饰载体传递。
    * variableDecor **title** 文字槽放的是「章节标题」。自 #236 起,主题环节带一个逐章 `subject`
      (用户确认的单行章节标题);apply-theme 把它写进该章各页的每个 `title` 角色文字槽,使标题
      被持久化(问题5 方向 A 变体)。其颜色/字体仍由树里的章节节点承载
      (`V3Chapter.accentColor/artFont`,Web 写),并在 finalize 时烘进扁平页(§3 树边界:渲染
      契约不新增树形字段,所以逐页颜色不随扁平 Page 走 —— 留在树里直到 finalize)。这是一次
      确定性、用户确认的写入 —— 不是 §4.1 analyze 不变式(那管 analyze 阶段 LLM 写什么,此处不碰)。

  普通正文槽(`body`/`explain`,以及任何无 `variableDecor` 的槽)绝不触碰。

无状态(§3 数据归属):Agent 不持 draft/stage。它返回页级 `layoutPatch`(§3 树边界:仍是页级,
不给渲染契约加树形字段)。Web 负责持久化 —— 把逐章 `accentColor/artFont` 写进树的 `V3Chapter`
节点,并把本 patch 合并进页,然后推进 `stage` story→…。无模型调用、无 base64、无网络(纯结构变换)。

页→章映射(§8.3 layout 树流转:「③④传相关页」):扁平渲染契约里页不带 chapterId,所以一个请求
同时带页 + 多个章节选择是有歧义的,会被拒。Web 必须一次只对一章 apply-theme(单章选择 + 该章
的页),或只提供一个章节选择。
"""

from __future__ import annotations

import time
from collections.abc import Mapping, Sequence

from . import templates
from ..logging_config import get_logger
from ..schemas import (
    THEME_USER_PROSE_ROLES,
    Page,
    V3ApplyThemeRequest,
    V3ApplyThemeResponse,
    V3ChapterThemeChoice,
    V3LayoutPatchEntry,
    V3Models,
    V3Usage,
)

log = get_logger("apply_theme_v3")


class ApplyThemeV3Error(Exception):
    """apply-theme 无法产出有效 patch 时抛(例如空方案)。

    路由把它映射成 HTTP 错误码(§8.3 同步端点走 HTTP 错误码);前端可重试而不污染 stage。"""


# 内容为用户正文的文字槽角色 —— apply-theme 绝不覆盖它们(它们的样式挂在树的章节强调色/字体上,
# finalize 时烘入)。`title` 的 variableDecor 槽经树重新着色,而非在此重写内容。
# 约定以 `packages/contracts` 为单一真相源(theme-carrier.ts ↔ schemas.py);此处 import 共享
# 定义,消除与 finalize_v3 的重复(行为不变)。
_USER_PROSE_ROLES = THEME_USER_PROSE_ROLES


def _resolve_page_chapter(
    chapters: Sequence[V3ChapterThemeChoice],
) -> V3ChapterThemeChoice:
    """应用到给定页上的章节主题。

    §8.3 规范流程 = 每次调用只传一章的页,所以第一个(也是唯一的)章节选择统辖每一页。有歧义的
    多选页请求在调用本辅助函数前就被 `apply_theme` 拒掉。`chapters` 是 `min(1)`,所以这里绝不会
    索引空。"""
    return chapters[0]


def _decor_value_for_text_slot(
    slot: Mapping[str, object], existing: str | None, subject: str
) -> str | None:
    """一个 variableDecor 文字槽的主题化取值,或返回 None 表示原样不动。

    * `title`(章节标题)→ 逐章 `subject`(问题5 / #236),但仅当该槽当前为空(空串或缺失)时。
      非空的 title 是已有的章名(例如用户在编辑里改过),所以原样保留、绝不被
      subject 覆盖(#236 保留已有章名)。写入时 subject 截到槽的 `maxChars`,不会溢出模板。
      这让 apply-theme 幂等:已持有 subject 的槽是非空的,重复应用同一主题不动它。
    * `body`/`explain`(用户正文)→ None:内容从不重写;颜色/字体挂在树的章节节点上(finalize 烘入)。
    * `decoration` 文字槽 → 已有或空的内容从不用颜色字符串重写。SVG variableDecor 槽是扁平页上
      唯一的强调色载体。

    绝不返回地点/位置值或颜色 token,所以 §3 隐私(无地点)与文字内容保留都由构造保证。"""
    role = str(slot.get("role") or "")
    if role == "title":
        # 仅给空(空串/缺失)的 title 填入 subject;非空 title 是已有章名(如编辑里改过)→ 保留(#236)。
        if existing:
            return None
        max_chars = slot.get("maxChars")
        if isinstance(max_chars, int) and max_chars > 0:
            return subject[:max_chars]
        return subject
    if role in _USER_PROSE_ROLES:
        return None
    return existing if existing is not None else None


def _apply_page(page: Page, choice: V3ChapterThemeChoice) -> V3LayoutPatchEntry | None:
    """一页的 variableDecor patch,或当该页没有可主题化的槽时返回 None。

    读该页模板,找出哪些槽是 `variableDecor:true`,把 svg 槽 + 合格的 decoration 文字槽刷上该章
    强调色,其余(用户正文、非 variableDecor 槽)一律原样不动。

    只要该页至少有一个 variableDecor 槽,就返回带合并后 `texts` 的 `V3LayoutPatchEntry` —— 即使
    这次应用什么都没改(槽已刷过)。这让 apply-theme 幂等:重复应用同一主题会重新发出一模一样的
    `texts`,而不是把页丢掉。模板完全没有 variableDecor 槽的页返回 None(它不可主题化)。"""
    template = templates.get(page.templateId)
    if template is None:
        # 未知模板:没什么可刷(apply-theme 绝不把一页硬失败)。
        return None

    texts = dict(page.texts)
    themable = False

    # variableDecor SVG 槽(花饰/分隔线):内容本身就是装饰 → 强调色。
    for svg in template.get("svgs") or []:
        if not svg.get("variableDecor"):
            continue
        slot_id = svg.get("id")
        if not slot_id:
            continue
        themable = True
        texts[slot_id] = choice.accentColor

    # variableDecor 文字槽从不是颜色载体;用户正文与 decoration 文字值都保留(样式挂在树上)。
    for slot in templates.text_slots(template):
        if not slot.get("variableDecor"):
            continue
        slot_id = slot.get("id")
        if not slot_id:
            continue
        themable = True
        value = _decor_value_for_text_slot(slot, texts.get(slot_id), choice.subject)
        if value is not None:
            texts[slot_id] = value

    if not themable:
        return None
    return V3LayoutPatchEntry(pageIndex=page.pageIndex, texts=texts)


def apply_theme(req: V3ApplyThemeRequest) -> V3ApplyThemeResponse:
    """确定性地刷给定页的每个 variableDecor 槽(§4.3/§9)。

    纯函数(无 LLM/网络/DB/base64)。该章的 `{accentColor, artFont}` 刷页的 svg + decoration
    variableDecor 槽;用户正文与非 variableDecor 槽不碰(普通正文不碰)。章节颜色/字体本身由 Web
    写进树(§3 树边界)—— 本函数只返回页级 `layoutPatch`。

    当没有任何页带可主题化的槽时抛 `ApplyThemeV3Error`,以保证成功时 `layoutPatch`(契约 `min(1)`)
    永远非空。"""
    started = time.monotonic()
    if len(req.chapters) > 1 and req.pages:
        raise ApplyThemeV3Error(
            "ambiguous multi-chapter apply-theme request: pages carry no chapterId; "
            "send one chapter choice with that chapter's pages"
        )
    choice = _resolve_page_chapter(req.chapters)

    patches: list[V3LayoutPatchEntry] = []
    for page in req.pages:
        entry = _apply_page(page, choice)
        if entry is not None:
            patches.append(entry)

    if not patches:
        # 每页要么是未知模板、要么不带 variableDecor 槽,所以没什么可刷。契约要求
        # layoutPatch.min(1);一次空应用是调用方的 bug(recommend 总会产出逐章颜色)。
        raise ApplyThemeV3Error("no variableDecor slot to apply theme to")

    duration_ms = int((time.monotonic() - started) * 1000)
    log.info(
        "apply_theme_v3.done",
        album_id=req.albumId,
        pages=len(req.pages),
        patched=len(patches),
        font=choice.artFont,
    )
    return V3ApplyThemeResponse(
        layoutPatch=patches,
        usage=V3Usage(durationMs=duration_ms, models=V3Models()),
    )
