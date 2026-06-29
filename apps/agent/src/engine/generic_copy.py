"""V3 generic copy + generic color:预览态层(WP1.5 / #184)。

analyze环节 结束时,用户能立刻看到一本「已排好版、填了通用
文案/通用色」的书(v3-requirements §4.1(e) / §7.1)。WP1.4(`select_template`)产出了
扁平预览页 —— 每页用哪个模板、每个 image
slot 里坐着哪张照片 —— 但 `texts` 为 EMPTY。本模块把通用文案叠到这些
页上,使预览读起来像成稿 spread,且 WITHOUT 生成任何正式文案。

这里「通用文案」的含义(§4.1(e):不生成正式文案,直接用模板自带通用文案):

  * `decoration` 角色的文字 slot 被 CODE-FILL 上确定性、模板驱动的
    装饰 —— 绝非用户内容(templates/README.md:decoration id 是
    像 `folio` / `date` 的函数名,"filled with code-generated decoration like
    dates/numbers/labels, never user content"):
      - `folio`  → 页码(从 1 起),按 slot 的 maxChars 补零。
      - `date` / `dateNum` → 由页内照片最早的
        `takenAt`(code-filled EXIF,§4.1(c))推出的紧凑日期;当页上没有照片
        携带 takenAt 时省略(不编造日期 —— §3 / writing skill红线)。
  * 其余 EVERY 文字 slot —— `title` / `body` / `explain`(lang=user),以及我们
    没有确定性值的装饰 slot(`location` / `topRight` / `sideText`
    / `numbers`)—— 都留 EMPTY。用户 slot 的正式文案稍后由
    章节故事环节 撰写(§7.1:"章节故事: 覆盖成正式文案");现在写假文案会违反
    §4.1「不生成正式文案」。`location` 尤其 MUST 留空(§3 隐私:无地点)。

这里「通用色 / 占位 accentColor/artFont」的含义(§4.1):

  * 章节树把 `accentColor` / `artFont` 作为 REQUIRED-NULLABLE 键携带;
    describe-content 步骤(WP1.3)已把它们设为 `null` 占位,而
    theme环节(WP3.x)通过采样每章 hero 照片填入真实值。本
    模块 NOT 凭空造逐章颜色 —— `null` IS 那个通用占位,renderer
    会对其回退到一个中性默认值。现在烘一个假 accent 会在 theme 阶段被覆盖,
    并冒着把错色发进预览的风险。所以通用色 = 保持
    null 占位不动 + 上面的确定性装饰;本模块把这个契约显式化,让后续 WP 知道这处 seam。

纯 code,无 LLM,无 base64(§3):本阶段只读页/模板结构与
树已携带的 code-filled `takenAt`。它 NEVER 硬失败预览 ——
未知模板或缺失 slot 只会产出更少的已填装饰。
"""

from __future__ import annotations

from typing import Any, Mapping, Sequence

from . import templates
from ..logging_config import get_logger
from ..schemas import V3Chapter

log = get_logger("generic_copy")

# 我们拥有确定性通用值的装饰 slot id。其余任何
# (location/topRight/sideText/numbers/…)都刻意留空 —— 见模块
# docstring。`location` MUST 绝不填(§3 隐私:无地点)。
_FOLIO_IDS = frozenset({"folio"})
_DATE_IDS = frozenset({"date", "dateNum"})


def _photo_taken_at_index(chapters: Sequence[V3Chapter]) -> dict[str, str]:
    """对每张携带 takenAt 的照片建 photoId -> takenAt(code-filled EXIF)。

    从章节树一次性构建,使逐页 date 装饰能查到落在该页上任意照片的
    拍摄时间。没有 takenAt 的照片被
    省略(不编造日期)。"""
    index: dict[str, str] = {}
    for chapter in chapters:
        for photo in chapter.photos:
            if photo.takenAt:
                index[photo.photoId] = photo.takenAt
    return index


def _earliest_taken_at(photo_ids: Sequence[str], taken_at: Mapping[str, str]) -> str | None:
    """页内照片里已知最早的拍摄时间(ISO 字符串按
    时间顺序排序),或当它们都不带 takenAt 时返回 None。"""
    stamps = [taken_at[pid] for pid in photo_ids if pid in taken_at]
    return min(stamps) if stamps else None


def _format_date_decor(taken_at_iso: str, max_chars: int | None) -> str:
    """从 ISO `takenAt` 生成紧凑通用日期标签,截到 slot 的
    maxChars。优先 `MM/YY`(如 ``03/24`` —— 匹配 templates/README 的「如 08/24」,
    5 字符);slot 太窄时回退到裸补零月份,再回退到截断。
    仅 EXIF 时间 —— 无地点(§3)。"""
    # takenAt 匹配契约的 ISO datetime(上游已校验);从开头切出
    # 日期部分而非解析,故 `Z`/offset 后缀无关紧要。
    year = taken_at_iso[0:4]
    month = taken_at_iso[5:7]
    if not (year.isdigit() and month.isdigit()):
        return ""
    full = f"{month}/{year[2:]}"  # 如 "03/24"
    if max_chars is None or len(full) <= max_chars:
        return full
    if max_chars >= len(month):
        return month
    return full[:max_chars]


def _format_folio(page_index: int, max_chars: int | None) -> str:
    """给 `folio` slot 的从 1 起页码,按 maxChars 补零(默认
    2 位 —— `02` —— 与现有装饰约定一致)。"""
    width = max_chars if (max_chars and max_chars > 0) else 2
    return str(page_index + 1).zfill(width)[:width]


def _decor_for_slot(slot: Mapping[str, Any], page_index: int, page_date: str | None) -> str | None:
    """单个装饰 slot 的确定性通用值,或返回 None 表示留空。

    仅 `folio`(页码)由 code 持有 —— 页码是真装饰,用户不会「之后填」。
    `date`/`dateNum` 已归用户文案:预览阶段不再 code-fill,留空由 Web 用模板 `sample`
    示例占位,等用户之后填写(`page_date` 参数保留以兼容调用签名,当前不消费)。"""
    del page_date
    slot_id = slot.get("id", "")
    max_chars = slot.get("maxChars")
    if slot_id in _FOLIO_IDS:
        return _format_folio(page_index, max_chars)
    return None


def fill_page_generic_copy(page: Mapping[str, Any], page_date: str | None) -> dict[str, str]:
    """单个预览页的通用文案 `texts`:仅确定性装饰。

    读页的 `templateId` 找到其 text-slot 声明,填入我们拥有的
    装饰 slot(`folio`、`date`/`dateNum`),其余一律留
    空。合并到页上已有的 texts 之上(保留显式值,绝不
    覆盖非空 slot)。返回一个普通 `{slotId: str}` dict(Page.texts
    形态)。未知模板时原样返回页已有 texts —— 本
    阶段绝不硬失败预览。"""
    existing = dict(page.get("texts") or {})
    template_id = page.get("templateId")
    template = templates.get(template_id) if isinstance(template_id, str) else None
    if template is None:
        return existing

    page_index = int(page.get("pageIndex") or 0)
    out = dict(existing)
    for slot in templates.text_slots(template):
        if slot.get("role") != "decoration":
            continue
        slot_id = slot.get("id", "")
        if out.get(slot_id):
            continue  # 绝不覆盖显式/非空值
        value = _decor_for_slot(slot, page_index, page_date)
        if value:
            out[slot_id] = value
    return out


def fill_generic_copy(
    pages: Sequence[Mapping[str, Any]], chapters: Sequence[V3Chapter]
) -> list[dict[str, Any]]:
    """把通用 文案 叠到 WP1.4 预览页上 → 预览态页(§4.1(e))。

    对每页:确定性装饰(`folio` 页码、`date` 来自
    页内照片最早的 code-filled `takenAt`)被填入 `texts`;用户内容
    和未拥有的装饰 slot 留空,交给章节故事环节 撰写。章节
    树的 `accentColor`/`artFont` null 占位保持不动(通用色 = 那个 null
    占位;theme环节 填真实值)。纯 code,绝不抛错。

    返回 NEW 的页 dict(Page 形态:pageIndex/templateId/images/texts/…),使
    调用方的输入不被改动。页顺序和图片分配不动 ——
    本阶段只添加通用装饰文字。"""
    taken_at = _photo_taken_at_index(chapters)
    out: list[dict[str, Any]] = []
    filled_decor = 0
    for page in pages:
        photo_ids = list((page.get("images") or {}).values())
        page_date = _earliest_taken_at(photo_ids, taken_at)
        texts = fill_page_generic_copy(page, page_date)
        new_page = dict(page)
        new_page["texts"] = texts
        filled_decor += sum(1 for v in texts.values() if v)
        out.append(new_page)
    log.info("generic_copy.filled", pages=len(out), decorations=filled_decor)
    return out
