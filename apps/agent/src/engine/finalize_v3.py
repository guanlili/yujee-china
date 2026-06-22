"""V3 确定性 finalize —— V3 layout 树 + 页 -> 扁平 AlbumLayoutPlan。

finalize 的 V3 路径(issue #179 / WP0.4)。

V3 finalize(docs/agent/v3-requirements.md §9 / §4.5;v3-implementation-plan §3
WP0.4)有以下规则:

  * **Cover 可选** —— page 0 NOT 被强制为 cover-category
    模板(cover 可跳过,§4.4)。没有「page 0 必须是 cover」规则。
  * **无 quality / hero / orientation** —— V3 里 image slot 不带这些,所以
    没有 fill-in-hero 检查、也没有 hero-slot 保护。比例不符是
    renderer 的 center-cover 关切。
  * **识别 V3 模板字段** —— validation 接受 ``svgs`` slot、``items`` repeat
    group、``variableDecor`` 标志、``category``、章节 accent
    color 和 art font。repeat-group 内容用声明的
    bracket-path slot id(``cells[0].image``)寻址,loader 已枚举好。

本 WP 交付 V3 finalize 基座:flatten + 一个 V3 形态的 validate。

范围说明:对外 render 契约 ``AlbumLayoutPlan`` 仍在每张照片上携带遗留
``quality`` 字段(它镜像 @yujee/contracts
PhotoAnalysis,本 WP 不动)。V3 输入照片没有 quality,所以 finalize
在输出时合成一个中性 ``"detail"`` quality —— quality 在 V3 里是惰性的
(没有 hero 保护消费它)。等契约去掉该字段,这个合成就消失。
"""

from __future__ import annotations

import re
from collections import Counter
from typing import Any

from . import templates as registry
from ..schemas import (
    THEME_ACCENT_CARRIER_SUFFIX,
    THEME_FONT_CARRIER_SUFFIX,
    THEME_USER_PROSE_ROLES,
    AlbumLayoutPlan,
    LayoutPhotoAnalysis,
    Magazine,
    Page,
    V3Chapter,
    V3FinalizeRequest,
    V3LayoutTree,
)


# V3 扁平 layout 页数上限(与 v2 的 [1, 48] 一致;扁平 schema 也强制
# >= 1)。没有页的 V3 相册无法出货。
_MAX_PAGES = 48

# Repeat-group / bracket-path slot key,如 ``cells[0].image`` 或 ``titles[3]``。
# 第一个 ``[`` 之前的部分是模板声明的 base slot(image
# slot 由 loader 逐 index 枚举;repeat 文字 slot 保持为带数字 index 的
# base key)。
_BASE_SLOT_RE = re.compile(r"^([^\[]+)")

# 对外 render 契约用的中性惰性 quality(见模块 docstring)。
_V3_OUTPUT_QUALITY = "detail"

_DEFAULT_TITLE = {"en": "Life in photographs", "zh": "照片里的时光"}

# variableDecor theme-carrier 文法 (§3 树边界):章节 accentColor/artFont 烘焙进
# `page.texts` 的 STRING 值 —— 绝不是树形字段。约定是 `packages/contracts` 的单一真相源
# (`theme-carrier.ts` ↔ `schemas.py`),finalize 不再私有持有,改 import 共享定义:
#   * SVG variableDecor 槽 → 槽自己的 `texts[slotId]` 值即 accentColor(矢量以该色
#     绘制)—— 这把 WP3.2 svg seam 收口为最终扁平形态。
#   * TEXT variableDecor 槽 → 内容保留/缺省,章节色/字体走 sibling carrier 键,
#     prose/值/空值永不被覆盖。
# A real slot id 是普通 id 或 bracket-path(`cells[0].image`),均不含 ``#``,故 carrier
# 键与声明槽零碰撞,validate_v3 只把它们认作 theme carrier。
_ACCENT_SUFFIX = THEME_ACCENT_CARRIER_SUFFIX
_FONT_SUFFIX = THEME_FONT_CARRIER_SUFFIX
_USER_PROSE_ROLES = THEME_USER_PROSE_ROLES


class FinalizeV3Error(Exception):
    """扁平后的 V3 layout 未通过 validate_v3 时抛。"""


def finalize_v3(request: V3FinalizeRequest) -> AlbumLayoutPlan:
    """把 V3 layout 树 + 预览页扁平化成对外 AlbumLayoutPlan。

    纯函数(无 LLM/网络/DB)。步骤:
      ① 收集树引用的每张照片,塑形成对外
         render 契约(合成惰性遗留 quality 字段);
      ② 原样扁平化预览 `pages`(cover 可选 —— 不强制 page 0),
         按顺序重排 pageIndex;
      ②b 把每章的 variableDecor 主题(accentColor / artFont,含
         WP3.2 svg seam)烘进该章的扁平页 —— 逐章
         color/font 在此之前只活在树里(§3 树边界),并在这里
         落到 `pages[].texts`,使扁平 render 契约绝不
         携带树形字段;
      ③ 从 language + 第一章构建 magazine header;
      ④ 用 SINGLE `validate_v3`(§6.8 第 7
         条 校验单一真相源)硬校验扁平 layout,遇首个违规即抛。
    """
    language = request.language

    photos = _collect_photos(request)
    pages = _flatten_pages(request.pages)
    pages = _bake_variable_decor(pages, request.tree)
    magazine = _magazine(request, language)

    layout = AlbumLayoutPlan(magazine=magazine, photos=photos, pages=pages)

    problem = validate_v3(layout)
    if problem is not None:
        raise FinalizeV3Error(problem)
    return layout


# ---------- ① photos ----------------------------------------------------------


def _collect_photos(request: V3FinalizeRequest) -> list[LayoutPhotoAnalysis]:
    """树里每张不重复的照片,按 first-seen 顺序,塑形成输出。

    Description 来自章节照片的 ``sceneDescription``;tags 默认
    空(V3 这里没有 tag 维度);``quality`` 是惰性中性值
    (见模块 docstring);orientation 直接透传;focal 省略(V3 章节照片里没有
    focal 维度 → renderer 50/50 默认)。"""
    out: list[LayoutPhotoAnalysis] = []
    seen: set[str] = set()
    for chapter in request.tree.chapters:
        for photo in chapter.photos:
            if photo.photoId in seen:
                continue
            seen.add(photo.photoId)
            out.append(
                LayoutPhotoAnalysis(
                    photoId=photo.photoId,
                    description=photo.sceneDescription,
                    tags=[],
                    quality=_V3_OUTPUT_QUALITY,
                    orientation=photo.orientation,
                )
            )
    return out


# ---------- ② flatten ---------------------------------------------------------


def _flatten_pages(pages: list[Page]) -> list[Page]:
    """把预览页从 0 起按顺序重排 index,保持原顺序。

    Cover 的可选性体现在这里:我们 NOT 注入或要求 cover 页 ——
    页按其创作顺序到达,我们只重排 pageIndex 让
    扁平 layout 连续。"""
    return [page.model_copy(update={"pageIndex": idx}) for idx, page in enumerate(pages)]


# ---------- ②b variableDecor bake (章节色/字体/SVG → 扁平页, §3 树边界 收口) ----


def _bake_variable_decor(pages: list[Page], tree: V3LayoutTree) -> list[Page]:
    """把每章的 `{accentColor, artFont}` 烘进该章的扁平页。

    这落地 §3 树边界 契约:逐章主题在 analyze/story/theme/cover 过程中 ONLY 活在树里
    (`V3Chapter.accentColor/artFont`);finalize 是
    唯一把它烘进扁平 `page.texts` 的点,使 render
    契约(`magazine + photos + pages[]`)绝不携带树形字段。

    页→章映射:V3 是 一图一章不跨章,所以正文页的照片都属于
    一章。我们把每页映射到 FIRST 拥有该页任一
    image photoId 的章节。没有归属章节的页(如未绑定章节的 WP4.1 cover/ending
    spread,或其章节主题为 null 的页)原样
    保留 —— 没有主题可烘。幂等:对同一棵树重复烘出相同的
    texts(它覆盖 carrier / svg-seam 值,绝不追加)。"""
    owner = _page_chapter_index(pages, tree)
    out: list[Page] = []
    for page in pages:
        chapter = owner.get(page.pageIndex)
        if chapter is None or chapter.accentColor is None:
            # 没有可解析的章节,或章节主题尚未选定 → 没什么可烘。
            out.append(page)
            continue
        out.append(_bake_page(page, chapter.accentColor, chapter.artFont))
    return out


def _page_chapter_index(
    pages: list[Page], tree: V3LayoutTree
) -> dict[int, V3Chapter]:
    """通过 photoId 归属把每页的 `pageIndex` 映射到其所属章节。

    构建一个 photoId → chapter 查找表(first-seen 章节胜出,与
    `_collect_photos` 里的 first-seen 去重一致),再把每页分配给
    拥有其第一个可解析 image photoId 的章节。照片不属于任何
    章节的页在结果里直接缺席(由调用方留作未着主题)。"""
    photo_owner: dict[str, V3Chapter] = {}
    for chapter in tree.chapters:
        for photo in chapter.photos:
            photo_owner.setdefault(photo.photoId, chapter)

    mapping: dict[int, V3Chapter] = {}
    for page in pages:
        for photo_id in page.images.values():
            chapter = photo_owner.get(photo_id)
            if chapter is not None:
                mapping[page.pageIndex] = chapter
                break
    return mapping


def _bake_page(page: Page, accent_color: str, art_font: str | None) -> Page:
    """返回 `page` 的一份副本,其模板的 variableDecor slot 已被着主题。

    * SVG variableDecor slot → `texts[svgId] = accent_color`(矢量以
      accent color 绘制;把 WP3.2 apply-theme svg seam 落地为最终扁平
      形态,从树重新推导,使树是单一真相源)。
    * variableDecor TEXT slot(独立 + 在 `items` repeat group 内):
      可见内容原样保留,含缺失/空的装饰 slot。
      章节 color/font 走 sibling carrier 键 `texts[slotId#accentColor]` /
      `texts[slotId#artFont]`,绝不覆盖可见 slot 值。
    非 variableDecor slot 与 普通正文(body/explain)值绝不触碰。"""
    template = registry.get(page.templateId)
    if template is None:
        # 未知模板(validate_v3 稍后会拒它);没什么可烘。
        return page

    texts = dict(page.texts)

    for svg in template.get("svgs") or []:
        if not svg.get("variableDecor"):
            continue
        slot_id = svg.get("id")
        if slot_id:
            texts[slot_id] = accent_color

    _bake_text_slots(texts, registry.text_slots(template), accent_color, art_font)
    items = template.get("items")
    if items:
        _bake_text_slots(texts, items.get("texts") or [], accent_color, art_font)

    return page.model_copy(update={"texts": texts})


def _bake_text_slots(
    texts: dict[str, str],
    slots: list[dict[str, Any]],
    accent_color: str,
    art_font: str | None,
) -> None:
    """把章节主题烘进一个 slot 列表的 variableDecor TEXT slot。

    就地修改 `texts`。对 repeat-group(`items`)slot,声明的 base id
    在页里可能按 index 寻址(`caption[0]`);我们给每个 base 匹配 variableDecor slot
    的现存键、以及裸 base 键(如存在)着主题。"""
    for slot in slots:
        if not slot.get("variableDecor"):
            continue
        slot_id = slot.get("id")
        if not slot_id:
            continue
        role = str(slot.get("role") or "")
        matching_keys = _matching_text_keys(texts, slot_id)
        for key in matching_keys:
            existing = texts.get(key)
            if existing is None:
                continue
            # 用户正文、code 持有的装饰值、空装饰
            # 字符串都原样保留;主题走 carrier。
            texts[f"{key}{_ACCENT_SUFFIX}"] = accent_color
            if art_font is not None:
                texts[f"{key}{_FONT_SUFFIX}"] = art_font
        if not matching_keys:
            # slot 声明了 variableDecor 但页上没有(如 generic
            # copy 从未填过某装饰):保持可见内容缺席,只通过
            # sibling 键携带主题。
            texts[f"{slot_id}{_ACCENT_SUFFIX}"] = accent_color
            if art_font is not None:
                texts[f"{slot_id}{_FONT_SUFFIX}"] = art_font


def _matching_text_keys(texts: dict[str, str], base_slot: str) -> list[str]:
    """base slot == `base_slot`(裸 id 或 bracket-path)的现存文字键。

    repeat-group base ``caption`` 匹配 ``caption``、``caption[0]``、``caption[1]``;
    carrier 键(``…#accentColor``)被排除,使重复烘焙幂等。"""
    out: list[str] = []
    for key in texts:
        if _ACCENT_SUFFIX in key or _FONT_SUFFIX in key:
            continue
        if _base_slot(key) == base_slot:
            out.append(key)
    return out


# ---------- ③ magazine header -------------------------------------------------


def _magazine(request: V3FinalizeRequest, language: str) -> Magazine:
    title = _first_nonempty_description(request) or _DEFAULT_TITLE.get(
        language, _DEFAULT_TITLE["en"]
    )
    return Magazine(
        title=_clamp(title, 60),
        subtitle=None,
        style="editorial",
        language=language,
    )


def _first_nonempty_description(request: V3FinalizeRequest) -> str:
    for chapter in request.tree.chapters:
        text = (chapter.description or "").strip()
        if text:
            return text
    return ""


def _clamp(text: str, max_chars: int) -> str:
    return text if len(text) <= max_chars else text[:max_chars].rstrip()


# ---------- ④ validate_v3 -----------------------------------------------------


def _base_slot(slot: str) -> str:
    match = _BASE_SLOT_RE.match(slot)
    return match.group(1) if match else slot


def _carrier_base(slot: str) -> str | None:
    """theme-carrier 键所属的 slot id,若 `slot` 不是 carrier 则返回 None。

    `title#accentColor` → `title`;`caption[0]#artFont` → `caption[0]`。对普通 slot id
    返回 None,以便走正常的 slot 归属检查。"""
    for suffix in (_ACCENT_SUFFIX, _FONT_SUFFIX):
        if slot.endswith(suffix):
            return slot[: -len(suffix)]
    return None


def _is_variable_decor_slot(
    slot_key: str,
    text_by_id: dict[str, Any],
    item_text_by_id: dict[str, Any],
) -> bool:
    """`slot_key`(裸 id 或 bracket-path)是否指向一个 text variableDecor slot。

    sibling carrier 键只属于 text 和 `items.texts` slot。SVG
    variableDecor slot 是 value-as-color,按裸 svg id 校验。"""
    base = _base_slot(slot_key)
    text_slot = text_by_id.get(base)
    if text_slot is not None and text_slot.get("variableDecor"):
        return True
    item_text_slot = item_text_by_id.get(base)
    if item_text_slot is not None and item_text_slot.get("variableDecor"):
        return True
    return False


def validate_v3(layout: AlbumLayoutPlan) -> str | None:
    """V3 扁平 layout 硬规则。返回首个违规的人类可读
    字符串,或在 layout 可出货时返回 None。

    与 v2 ``finalize.validate_v2`` 的不同:
      * 没有「page 0 必须是 cover」规则 —— V3 里 cover 可选。
      * 没有 fill-in-hero / quality / orientation 检查 —— 这些维度已移除。
      * 通过 loader 声明的 slot id 识别 V3 repeat-group / bracket-path slot、``svgs`` 和 ``items``。

    强制约束:
      * 1..48 页,pageIndex 顺序连续。
      * 每个 template id 已知。
      * 每个 image/text slot 键都属于其模板。V3 允许在合法候选只需
        容量 >= N 时,较大模板留有空槽,所以只校验
        present image 键。
      * bracket-path 文字键仅对声明的 repeat base 接受。
      * 每个被引用的 photoId 都存在于 photos[];同一页不重复用一张照片;
        全册任一照片复用不超过两次;无未使用照片。
    """
    pages = layout.pages
    photo_ids = {photo.photoId for photo in layout.photos}

    if not 1 <= len(pages) <= _MAX_PAGES:
        return f"pages count {len(pages)} outside supported range 1..{_MAX_PAGES}"

    for expected_idx, page in enumerate(pages):
        if page.pageIndex != expected_idx:
            return (
                f"pageIndex {page.pageIndex} at position {expected_idx} "
                f"(must be sequential)"
            )

    # used_counts 计所有页(含 cover/ending)→ unused 检查;reuse_counts 只计正文页
    # → 全册复用上限。封面/封底页复用首尾照片是 wrap_with_cover_ending 的确定性设计
    # (真实影集封面常复用正文照片),不该算进「最多复用 2 次」的滥用上限 —— 否则单照片
    # 相册那张图在 cover + interior + ending 出现 3 次会被误判。恢复 v2 豁免 cover page0
    # 的精神,并扩展到 V3 的 cover + ending 页。
    used_counts: Counter[str] = Counter()
    reuse_counts: Counter[str] = Counter()
    for page in pages:
        template = registry.get(page.templateId)
        if template is None:
            return f"page {page.pageIndex}: templateId {page.templateId} not in TemplateRegistry"
        is_cover_or_ending = template.get("category") in ("cover", "ending")

        image_by_id = registry.image_slot_map(template)
        text_by_id = registry.text_slot_map(template)
        # svg 装饰 slot(§9)以 finalize 烘出的 themed-decoration carrier 形态
        # 活在 `page.texts`(WP5.1;seam 来自 apply-theme WP3.2 #190):slot 的值
        # 是 renderer 给矢量上色用的章节 accent color。它们 NOT
        # 是 text slot,所以这里也接受它们的 id(增量、仅 V3 —— v2 finalize.py
        # 不动)。
        svg_ids = {svg["id"] for svg in (template.get("svgs") or [])}
        # `items` repeat-group 声明的 text-slot base(§9):V3 唯一的 repeat
        # carrier(取代已弃用的顶层 `repeat:true`)。一个 items text slot
        # 在 page.texts 里可能以裸 base(`caption`)或按 index
        # (`caption[0]`)出现。variableDecor 标志挂在 slot 定义本身上。
        items = template.get("items") or {}
        item_text_by_id = {slot["id"]: slot for slot in (items.get("texts") or [])}
        # `items.images` repeat-group base(§9):grid 模板把它的 image
        # slot 在 items 下声明一次,并把每个 cell 寻址为 `<base>[i]`。
        item_image_by_id = {slot["id"]: slot for slot in (items.get("images") or [])}

        for slot in page.images:
            if slot in image_by_id:
                continue
            base = _base_slot(slot)
            if base in item_image_by_id:
                continue  # 声明的 `items` repeat-group image cell(裸或 [i])
            return (
                f"page {page.pageIndex}: image slot '{slot}' not in "
                f"template {page.templateId}"
            )
        for slot in page.texts:
            # ②b theme carrier(§3 树边界):当 slot 持有用户正文 / code 持有的值时,
            # finalize 把章节 accentColor/artFont 烘进 `<slotId>#accentColor` /
            # `<slotId>#artFont` 字符串键。仅当 carrier 所属 slot 是声明的
            # text/items.text variableDecor slot 时才接受。SVG
            # variableDecor 改用裸 svg slot 值作为颜色。
            carrier_base = _carrier_base(slot)
            if carrier_base is not None:
                if _is_variable_decor_slot(carrier_base, text_by_id, item_text_by_id):
                    continue
                return (
                    f"page {page.pageIndex}: theme carrier '{slot}' has no "
                    f"text variableDecor slot in template {page.templateId}"
                )
            base = _base_slot(slot)
            # bracket-path 键(`base[i]`)优先对 `items.texts`
            # repeat base 解析 —— 即便存在同名的普通顶层 slot
            # (mag-02 同时有顶层 `title` 和 items `title`)。
            if "[" in slot and base in item_text_by_id:
                continue
            text_slot = text_by_id.get(base)
            if text_slot is None:
                if slot in svg_ids:
                    continue  # 已烘的 themed svg-decoration 键,不是 text slot
                item_slot = item_text_by_id.get(base)
                if item_slot is not None:
                    continue  # 声明的 `items` repeat-group text slot(裸或 [i])
                return (
                    f"page {page.pageIndex}: text slot '{slot}' not in "
                    f"template {page.templateId}"
                )
            if "[" in slot and not text_slot.get("repeat"):
                return (
                    f"page {page.pageIndex}: text slot '{slot}' is not a repeat "
                    f"slot in template {page.templateId}"
                )

        seen_on_page: set[str] = set()
        for slot, pid in page.images.items():
            if pid not in photo_ids:
                return f"page {page.pageIndex}: photoId {pid} not in photos[]"
            if pid in seen_on_page:
                return f"page {page.pageIndex}: photoId {pid} used twice on same page"
            seen_on_page.add(pid)
            used_counts[pid] += 1
            if not is_cover_or_ending:
                reuse_counts[pid] += 1

    unused = [pid for pid in photo_ids if used_counts[pid] == 0]
    if unused:
        return f"unused photos: {sorted(unused)[:3]}"

    # 全册复用上限:一张照片在正文页最多出现 TOTAL 两次。封面/封底页复用首尾照片
    # (wrap_with_cover_ending)不计入此上限 —— 否则单照片相册的那张图会在 cover +
    # interior + ending 出现 3 次而被误判滥用。正文复用仍严格 ≤2。
    overused = [pid for pid, count in reuse_counts.items() if count > 2]
    if overused:
        return f"photos reused more than 2 times: {sorted(overused)[:3]}"

    return None
