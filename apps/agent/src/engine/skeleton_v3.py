"""V3 确定性 模板选取 + 图片分配引擎。

这是确定性引擎的 V3 路径(issue #179 / WP0.4)。

V3 引擎 **纯由 category + image-slot 数量驱动**(docs/agent/
v3-requirements.md §9 / docs/agent/v3-implementation-plan.md §3 WP0.4):

  * 无照片 quality、无 hero 保护、无 orientation 硬规则、无 scene
    收窄。比例不符在绘制时由 center-cover 渲染吸收,
    绝不在此处拒绝。
  * 模板按其 V3 `category`(cover | interior | toc |
    ending)分池,NOT 按 `slot`(mag-02 是 slot=interior 但 category=toc —— 按
    category 分池)。category 内,模板按 image-slot 数量索引。
  * `select-template`(WP1.4)让识图模型从本引擎暴露的 *合法
    候选*(`legal_candidates`)中挑;当 LLM 调用失败时,
    确定性 fallback(`pick_template_v3` / `build_page_v3`)挑一个
    image-slot 数量能容纳这 N 张照片的模板,并按顺序
    塞入。「10 张照片 → 挑一个能装 10 张的模板,按顺序塞入」。

repeat group(`items`)让 grid 模板能装多张照片:其单个
``items.images`` slot 展开成 ``<base>[0]``..``<base>[k-1]``(k = 固定的
grid 容量,见 `_ITEMS_GRID_CAPACITY`)。`image_slot_keys` / `image_capacity`
隐藏这个展开;分配按顺序把照片塞进这些键。
"""

from __future__ import annotations

from typing import Any, Mapping, Sequence

from . import templates


# V3 模板 category。mag-02 是 slot=interior 但 category=toc —— V3
# 引擎严格按 category 分池,故 category != slot 被正确处理。
Category = str


def template_category(template: templates.TemplateDef) -> Category:
    """模板所属的 category(loader 保证它已设置)。

    Category 是单一分类字段:cover | toc | interior | ending。
    mag-02 是 category=toc,严格按 category 分池。"""
    return template["category"]


# Grid 模板在 ``items.images``(repeat
# group,§9)内声明 ONE image slot,并把它展开成 ``<base>[0..k-1]``。JSON 不再枚举
# 固定 cell 数,所以引擎在此固定 grid 容量。4 保留
# 此前 mag-10 的 4-cell 行为。(若某 grid 该装不同数量,把它
# 挂在模板上并在此读取。)
_ITEMS_GRID_CAPACITY = 4


def _items_image_base(template: templates.TemplateDef) -> str | None:
    """模板是 grid 时,其单个 ``items.images`` repeat-group base id。"""
    items = template.get("items") or {}
    item_images = items.get("images") or []
    if len(item_images) == 1 and not template["images"]:
        return item_images[0]["id"]
    return None


def image_slot_keys(template: templates.TemplateDef) -> list[str]:
    """可供分配寻址的 image-slot 键,按顺序。

    普通模板暴露其声明的顶层 image-slot id。grid
    模板(单个 ``items.images`` repeat slot,无顶层 images)展开成
    ``<base>[0]``..``<base>[k-1]``,k = `_ITEMS_GRID_CAPACITY`。"""
    base = _items_image_base(template)
    if base is not None:
        return [f"{base}[{i}]" for i in range(_ITEMS_GRID_CAPACITY)]
    return templates.image_slot_ids(template)


def image_capacity(template: templates.TemplateDef) -> int:
    """一个模板能装多少张不重复照片。

    普通模板:其声明的顶层 image-slot 数量。Grid 模板
    (单个 ``items.images`` repeat slot):固定 grid 容量。"""
    if _items_image_base(template) is not None:
        return _ITEMS_GRID_CAPACITY
    return len(template["images"])


def _build_pools() -> dict[Category, dict[int, list[str]]]:
    """category -> image-capacity -> 已排序 template id。

    确定性:每个 bucket 内 id 已排序,使 fallback 选取在
    不同运行和进程间稳定。"""
    pools: dict[Category, dict[int, list[str]]] = {}
    for template_id in templates.TEMPLATE_IDS:
        template = templates.TEMPLATES[template_id]
        category = template_category(template)
        capacity = image_capacity(template)
        pools.setdefault(category, {}).setdefault(capacity, []).append(template_id)
    for by_capacity in pools.values():
        for ids in by_capacity.values():
            ids.sort()
    return pools


# category -> imageCount -> [templateId];从 registry 一次性构建。
POOLS: dict[Category, dict[int, list[str]]] = _build_pools()


def candidate_ids(category: Category, image_count: int) -> list[str]:
    """`category` 内 image-slot 数量恰为 `image_count` 的模板。

    精确容量辅助函数,供测试和不需要空槽的调用方使用。
    `legal_candidates` 是 select-template API,会纳入仍能装 N 张照片的更大
    容量。已排序以保确定性。"""
    return list(POOLS.get(category, {}).get(image_count, []))


def legal_candidates(category: Category, image_count: int) -> list[dict[str, Any]]:
    """select-template 的合法候选描述符(WP1.4 / V3TemplateCandidate)。

    每个条目形如 V3TemplateCandidate:
    ``{"templateId": ..., "category": ..., "imageSlotCount": ...}``。
    合法集是目标 category 内 image 容量
    能装 N 张照片的每个模板。精确容量模板排在前,随后是按升序
    的更大容量;每个 bucket 内 id 稳定排序。
    """
    out: list[dict[str, Any]] = []
    for capacity in _fallback_capacities(category, image_count):
        for template_id in POOLS.get(category, {}).get(capacity, []):
            out.append(
                {
                    "templateId": template_id,
                    "category": category,
                    "imageSlotCount": capacity,
                }
            )
    return out


def _fallback_capacities(category: Category, image_count: int) -> list[int]:
    """fallback 要尝试的容量,best-fit 优先。

    §9 fallback:挑一个 image-slot 数量能装 N 张照片的模板 ——
    「== N 或最接近的 >= N 容量」。我们先试精确 N,再按升序试
    更大的容量(浪费最小者优先)。低于 N 的容量
    绝不使用(它们装不下全部 N 张照片)。"""
    available = sorted(POOLS.get(category, {}).keys())
    exact = [c for c in available if c == image_count]
    larger = [c for c in available if c > image_count]
    return exact + larger


def pick_template_v3(category: Category, image_count: int) -> str:
    """给 `category` 内 `image_count` 张照片的确定性 fallback 模板选取。

    纯 code,无 quality/hero/orientation/scene。挑一个 image
    容量能装下全部 N 张照片的模板 —— 精确容量优先,否则最接近的
    更大者 —— 并返回其 id(已排序 bucket 中的第一个,稳定)。

    当 category 内没有模板能装 N 张照片时抛 ValueError(如
    要求的照片数超过任何 interior 模板的声明)。"""
    for capacity in _fallback_capacities(category, image_count):
        bucket = POOLS.get(category, {}).get(capacity)
        if bucket:
            return bucket[0]
    raise ValueError(
        f"no V3 template in category={category!r} can hold {image_count} image(s)"
    )


def _photo_id(photo: Mapping[str, Any] | str | Any) -> str:
    if isinstance(photo, str):
        return photo
    # 兼容纯 mapping 与 V3ChapterPhoto pydantic 对象(后者来自 analyze pipeline)。
    value = photo.get("photoId") if isinstance(photo, Mapping) else getattr(photo, "photoId", None)
    if not isinstance(value, str) or not value:
        raise ValueError("photo must carry a non-empty photoId")
    return value


def assign_images_v3(
    template_id: str, photos: Sequence[Mapping[str, Any] | str]
) -> dict[str, str]:
    """按声明顺序把照片塞进 `template_id` —— 无匹配。

    §9:「按顺序塞入」。每个模板 image slot(按声明顺序)
    接收下一张照片的 id。无 quality/hero/orientation 匹配;
    比例不符是 renderer 的 center-cover 关切,不归我们。

    `photos` 可以是 photo-id 字符串或携带 ``photoId`` 的 mapping。照片数
    不得超过模板的 image 容量。多余 slot(当挑了
    最接近的更大模板时)留空 —— V3 renderer 只显示
    已填 slot;确定性 fallback 只会挑容量
    >= N,所以每张照片都被放下。"""
    template = templates.get(template_id)
    if template is None:
        raise ValueError(f"unknown template id: {template_id}")
    slot_ids = image_slot_keys(template)
    if len(photos) > len(slot_ids):
        raise ValueError(
            f"template {template_id} holds {len(slot_ids)} image(s); got {len(photos)}"
        )
    return {slot_id: _photo_id(photo) for slot_id, photo in zip(slot_ids, photos)}


def max_capacity(category: Category) -> int:
    """`category` 内任一模板声明的最大 image-slot 数量(category
    没有模板时为 0)。正文分块器用 interior 最大值决定一页
    能放多少张照片。"""
    capacities = POOLS.get(category, {}).keys()
    return max(capacities, default=0)


def partition_photos_v3(
    photos: Sequence[Mapping[str, Any] | str],
    *,
    category: Category = "interior",
) -> list[list[Mapping[str, Any] | str]]:
    """把一章的照片切成 fallback 能放下的逐页 chunk。

    §9 fallback 意图 —— 「挑一个能装下这些照片的模板,按顺序
    塞入」—— 推广到模板 image 容量有上限的库:把照片贪心地
    装进不大于 category 最大模板的 chunk,使每个 chunk 恰好
    映射到一个 fallback 模板(精确
    容量优先,否则最接近的更大者)。在当前 interior 最大值 4 下,
    一个 10 张照片的章节变成 4 + 4 + 2。仅在给了照片时返回至少一个(可能为空)
    list;空输入产出 ``[]``。"""
    items = list(photos)
    if not items:
        return []
    chunk = max_capacity(category)
    if chunk <= 0:
        raise ValueError(f"no V3 template in category={category!r} holds any image")
    return [items[i : i + chunk] for i in range(0, len(items), chunk)]


def build_page_v3(
    category: Category,
    photos: Sequence[Mapping[str, Any] | str],
    *,
    template_id: str | None = None,
    page_index: int = 0,
) -> dict[str, Any]:
    """给 `category` 内 `photos` 构建一个扁平 V3 页 dict。

    当给了 `template_id`(如模型的 select-template 选择)时按
    原样使用;否则确定性 fallback 挑一个。返回一个普通
    dict,形如 `schemas.Page`(pageIndex/templateId/images/texts),texts 为
    空 —— 通用文案/颜色稍后叠加(WP1.5 / finalize)。"""
    image_count = len(photos)
    chosen = template_id or pick_template_v3(category, image_count)
    return {
        "pageIndex": page_index,
        "templateId": chosen,
        "images": assign_images_v3(chosen, photos),
        "texts": {},
    }


def build_skeleton_v3(chapters: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """确定性 V3 skeleton:每章一个 interior 页,装该章的
    照片,外加一个 pageIndex 顺序连续的扁平页列表。

    这是 analyze pipeline(WP1.1/1.4)在 select-template LLM 调用失败时
    回退到的纯 code fallback:每章变成一个其模板能装下其照片数的
    interior 页,照片按顺序塞入。Cover
    在 V3 里 OPTIONAL(不强制为 page 0)—— analyze/cover 阶段(WP4.1)单独
    追加它,所以这里只建正文页。

    照片数超过最大 interior 模板容量的章节会被拆到
    多个 interior 页(`partition_photos_v3`),每页由一个
    能装下其 chunk 的 fallback 模板填充。

    `chapters` 是一个 mapping 序列,每个携带 ``photos``(一个
    photo-id 字符串或带 ``photoId`` 的 mapping 序列)。返回一个 pageIndex 顺序连续的
    扁平页 dict 列表。"""
    pages: list[dict[str, Any]] = []
    for chapter in chapters:
        photos = list(chapter.get("photos", []))
        if not photos:
            continue
        for chunk in partition_photos_v3(photos, category="interior"):
            pages.append(build_page_v3("interior", chunk, page_index=len(pages)))
    return pages


def default_cover_template_id() -> str | None:
    """默认封面模板 id(cover 类别里稳定排序的第一个),没有 cover 模板时为 None。"""
    bucket = sorted(tid for ids in POOLS.get("cover", {}).values() for tid in ids)
    return bucket[0] if bucket else None


def default_ending_template_id() -> str | None:
    """默认封底模板 id(ending 类别里稳定排序的第一个),没有 ending 模板时为 None。"""
    bucket = sorted(tid for ids in POOLS.get("ending", {}).values() for tid in ids)
    return bucket[0] if bucket else None


def _chapter_photos(chapter: Mapping[str, Any] | Any) -> list[Any]:
    """一章的照片序列,兼容纯 mapping 与 V3Chapter pydantic 对象。

    与 `build_skeleton_v3`(收 mapping)和 `select_template.plan_pages`(收 V3Chapter)
    两条调用路径都对齐 —— `wrap_with_cover_ending` 在 analyze pipeline 里收到的是
    V3Chapter 对象,纯代码 fallback / 单测里可能是 mapping。"""
    if isinstance(chapter, Mapping):
        return list(chapter.get("photos", []))
    return list(getattr(chapter, "photos", []) or [])


def _first_photo_id(chapters: Sequence[Mapping[str, Any] | Any]) -> str | None:
    """整本书第一张照片的 photoId(按章节、章内声明顺序),无照片时 None。"""
    for chapter in chapters:
        for photo in _chapter_photos(chapter):
            return _photo_id(photo)
    return None


def _last_photo_id(chapters: Sequence[Mapping[str, Any] | Any]) -> str | None:
    """整本书最后一张照片的 photoId(按章节、章内声明顺序),无照片时 None。"""
    last: str | None = None
    for chapter in chapters:
        for photo in _chapter_photos(chapter):
            last = _photo_id(photo)
    return last


def wrap_with_cover_ending(
    interior_pages: Sequence[Mapping[str, Any]],
    chapters: Sequence[Mapping[str, Any] | Any],
) -> list[dict[str, Any]]:
    """在正文页前后补一张默认封面页 + 一张默认封底页,并把整列页重排成
    pageIndex 连续。

    封面环节(§4.4)需要 draft skeleton 里真的有 ``category=cover`` / ``category=ending``
    的页,Web 才能渲染封面卡片;analyze 默认只建正文页(`build_skeleton_v3` /
    `select_template_pages`),于是封面卡片找不到封面页而 auto-skip(本次缺口)。这里
    确定性地补齐这两页:

      * 封面 = 默认 cover 模板(`default_cover_template_id`),hero 槽放整本书第一张照片;
      * 封底 = 默认 ending 模板(`default_ending_template_id`),hero 槽放整本书最后一张照片。

    封面/封底 hero 复用首/尾照片(照片可同时出现在封面与正文 —— 真实影集封面常如此);
    封底与封面在只有一张照片时仍各自成页(都放那一张)。补出的页 ``texts`` 留空,通用
    装饰(folio/date)由调用方随后的 `generic_copy.fill_generic_copy` 统一叠加,与正文页
    一致。

    无可用 cover/ending 模板,或整本书没有照片时,对应页跳过(优雅降级,绝不抛错);
    封面在最前、封底在最后,中间正文页保持原相对顺序。返回 pageIndex 从 0 起连续的
    新页 dict 列表(不改动入参)。"""
    cover_tid = default_cover_template_id()
    ending_tid = default_ending_template_id()
    first_photo = _first_photo_id(chapters)
    last_photo = _last_photo_id(chapters)

    ordered: list[dict[str, Any]] = []
    if cover_tid is not None and first_photo is not None:
        ordered.append(build_page_v3("cover", [first_photo], template_id=cover_tid))
    ordered.extend(dict(page) for page in interior_pages)
    if ending_tid is not None and last_photo is not None:
        ordered.append(build_page_v3("ending", [last_photo], template_id=ending_tid))

    for index, page in enumerate(ordered):
        page["pageIndex"] = index
    return ordered
