"""V3 cover/ending —— 确定性自动填充可选的 封面/封尾 页(§4.4)。

Issue #192 / WP4.1。V3 引擎里没有「page0 必须是 cover」这条约束:
`finalize_v3.validate_v3` 没有 page0-cover 规则,`skeleton_v3.build_skeleton_v3`
只建正文页、cover 作为可选追加项。本模块只负责追加可选的 cover/ending 页。

端点是 `POST /v3/cover`(§8.1 / 4.4:同步 / 确定性 / 可选)。它消费
`V3CoverRequest` DTO(schemas.py ↔ packages/contracts/src/v3.ts —— 单一真相源,
由 WP0.1/0.3 预定义,此处不改)。

cover 做什么(§4.4(a)(b)「选封面/封尾系统模板 → 自动填充成稿;封面可跳过」):

  用户(可选地)挑了一个 封面 系统模板(category=cover)和/或一个
  封尾 系统模板(category=ending)。浏览器发来 相关页 —— 为 cover 和 ending
  预留的页 slot —— 加上这些模板 id。cover-v3:

    * 对每个所选模板,校验它是一个 KNOWN 模板且其 V3 `category` 匹配
      (cover / ending)。未知 id 或 category 不符时抛
      `CoverV3Error`(路由把它映射成 HTTP 错误;§8.3 同步端点走 HTTP 错误码)。
    * 确定性地把页自动填充成成稿(§4.4(b)):cover/ending 模板通常只有 ONE
      hero 图片 slot —— 我们把页的第一张可用照片塞进去(确定性 assign,无
      quality/hero/orientation 匹配,与 `skeleton_v3.assign_images_v3` 一致;比例不符
      是 renderer 的 center-cover 关切)。通用装饰文字(`folio` 页码、`date`
      来自照片 code-filled 的 takenAt)按 generic_copy 给正文页的同样方式 code-fill
      —— 用户正文 slot(title/body/explain)保持 EMPTY(不编造文案;§4.1 不生成正式文案 / §3 隐私:绝不写地点/位置值)。
    * 对每个设计好的页返回一个 `V3LayoutPatchEntry`(templateId + images +
      texts),挂在页原有的 `pageIndex` 上(§3 树边界:仍是 页级,不加树形
      render 字段)。

  **可跳过 (§4.4 「跳过=空」)**:当 coverTemplateId 和 endingTemplateId BOTH
  缺失(null/省略)时,用户不要 cover/ending —— 我们返回 EMPTY patch 且
  不抛错。空 patch 是合法的成功。

无状态(§3 数据归属):Agent 不持 draft/stage。它只返回页级
`layoutPatch`;Web 负责持久化 patch + 推进 `stage` cover→ready(stage 推进权
在 Web)。无模型调用、无 base64、无网络(纯结构变换)。

cover/ending 页选取(§8.3「③④传相关页」):扁平 render 契约里页不带 chapterId/role,
所以规范流程 = Web 恰好把它为 cover(第一页)和 ending(最后一页)预留的页 slot
发来。我们把 cover 设计到 FIRST 给定页、把 ending 设计到 LAST 给定页 —— 当只选了一个模板
且只给了一页时,该页采用所选设计。我们绝不凭空造页;选了模板却没有落地页
是调用方错误,与显式跳过有别。
"""

from __future__ import annotations

import time
from collections.abc import Mapping, Sequence
from typing import Any

from . import templates
from ..logging_config import get_logger
from ..schemas import (
    Page,
    V3CoverRequest,
    V3CoverResponse,
    V3LayoutPatchEntry,
    V3Models,
    V3Usage,
)
from . import generic_copy
from . import skeleton_v3

log = get_logger("cover_v3")


class CoverV3Error(Exception):
    """所选 cover/ending 模板无法渲染时抛。

    路由把它映射成 HTTP 错误码(§8.3 同步端点走 HTTP 错误码);前端可重试而不污染 stage。
    注意:*跳过*(没选模板)NOT 是错误 —— 它返回一个空 patch。"""


def _require_category(template_id: str, expected: str) -> templates.TemplateDef:
    """`template_id` 对应的已知模板,且断言它是期望的 V3 category。

    当 id 未知或其 category 不匹配(`cover` vs `ending`)时抛 `CoverV3Error` ——
    把 interior 模板当 cover 选是调用方 bug,不是可渲染的 spread。"""
    template = templates.get(template_id)
    if template is None:
        raise CoverV3Error(f"unknown {expected} template id: {template_id!r}")
    actual = skeleton_v3.template_category(template)
    if actual != expected:
        raise CoverV3Error(
            f"template {template_id!r} is category={actual!r}, not {expected!r}"
        )
    return template


def _photo_ids(page: Page) -> list[str]:
    """页上已放置的照片 id,按 slot 声明顺序。

    cover/ending 自动填充复用页自己的照片(Web 发来的 相关页 携带 hero 候选);
    我们绝不到给定页之外去取图。"""
    return list(page.images.values())


def _design_page(
    page: Page, template: templates.TemplateDef, template_id: str
) -> V3LayoutPatchEntry:
    """把 `page` 在 `template` 上自动填充成成稿 cover/ending spread(§4.4(b))。

    确定性,与 V3 正文路径一致:
      ① 把页已有照片按声明顺序塞进模板的 image slot
         (`skeleton_v3.assign_images_v3`)—— 截到模板容量(cover 通常只有 ONE
         hero;多出的照片被丢弃,绝不复用/编造);
      ② 按 generic_copy 给正文页的同样方式 code-fill 通用装饰(`folio`/`date`);
         用户正文 slot(title/body/explain)保持 EMPTY(§4.1 不生成正式文案;
         §3 隐私:绝不写地点值)。

    返回一个携带 templateId + images + texts 的 `V3LayoutPatchEntry`,挂在页自己的
    `pageIndex` 上(§3 树边界:页级)。"""
    capacity = skeleton_v3.image_capacity(template)
    photos = _photo_ids(page)[:capacity]
    images = skeleton_v3.assign_images_v3(template_id, photos)

    # 通用装饰(folio/date)走正文页用的 SAME 确定性 helper。
    # 页最早照片的 takenAt 驱动 date;缺失 → 无 date(不编造日期)。
    # 用户正文 slot 由 fill_page_generic_copy 按构造留空。
    page_dict: dict[str, Any] = {
        "pageIndex": page.pageIndex,
        "templateId": template_id,
        "images": images,
        "texts": {},
    }
    page_date = _earliest_taken_at_for_page(images, page)
    texts = generic_copy.fill_page_generic_copy(page_dict, page_date)

    return V3LayoutPatchEntry(
        pageIndex=page.pageIndex,
        templateId=template_id,
        images=images,
        texts=texts,
    )


def _earliest_taken_at_for_page(
    images: Mapping[str, str], page: Page
) -> str | None:
    """cover/ending 页的 date 来源。

    扁平 cover 请求不带逐照片 takenAt(树不发到这个端点 —— §8.3 只有 finalize 拿到
    整棵树),所以这里没有 EXIF 可推导 date。我们返回 None:`date` 装饰直接留空
    而非编造(§4.1 / §3)。保留为一处 seam,让未来带 takenAt 的 cover 请求
    能点亮 date 而不动填充逻辑。"""
    return None


def build_cover(req: V3CoverRequest) -> V3CoverResponse:
    """确定性地设计可选的 封面/封尾 页(§4.4)。

    纯函数(无 LLM/网络/DB/base64)。行为:
      * 跳过(两个 template id 都缺失)→ 空 patch,不报错(§4.4 跳过=空)。
      * 选了 cover → 设计到 FIRST 给定页。
      * 选了 ending → 设计到 LAST 给定页。
      * 两个都选且页数 ≥2 → cover 在第一页、ending 在最后一页(不同页)。
      * 任何选了模板却没有落地页的情况都抛 CoverV3Error;不可与跳过混淆。

    在模板无效或缺落地页时抛 `CoverV3Error`。"""
    started = time.monotonic()

    cover_id = req.coverTemplateId
    ending_id = req.endingTemplateId

    if not cover_id and not ending_id:
        # §4.4 「跳过=空」:用户不要 cover/ending。空 patch,NOT 错误。
        log.info("cover_v3.skipped", album_id=req.albumId, pages=len(req.pages))
        return V3CoverResponse(
            layoutPatch=[],
            usage=V3Usage(
                durationMs=int((time.monotonic() - started) * 1000),
                models=V3Models(),
            ),
        )

    # 先校验所选模板(设计任何页之前 fail fast)。
    cover_template = _require_category(cover_id, "cover") if cover_id else None
    ending_template = _require_category(ending_id, "ending") if ending_id else None

    pages = list(req.pages)
    if not pages:
        raise CoverV3Error("chosen cover/ending template has no landing page")
    if (
        cover_template is not None
        and ending_template is not None
        and pages[0].pageIndex == pages[-1].pageIndex
    ):
        raise CoverV3Error(
            "cover and ending templates require distinct landing pages"
        )

    patches: list[V3LayoutPatchEntry] = []
    used_indices: set[int] = set()

    if cover_template is not None and pages:
        first = pages[0]
        patches.append(_design_page(first, cover_template, cover_id))  # type: ignore[arg-type]
        used_indices.add(0)

    if ending_template is not None and pages:
        # 把 ending 落到 LAST 页;如果那一页已被 cover 占用(只给了一页),
        # 就没有独立的 ending slot —— 跳过,而非覆盖 cover 或凭空造页。
        last_pos = len(pages) - 1
        if last_pos not in used_indices:
            patches.append(_design_page(pages[last_pos], ending_template, ending_id))  # type: ignore[arg-type]
            used_indices.add(last_pos)

    duration_ms = int((time.monotonic() - started) * 1000)
    log.info(
        "cover_v3.done",
        album_id=req.albumId,
        pages=len(pages),
        cover=bool(cover_id),
        ending=bool(ending_id),
        patched=len(patches),
    )
    return V3CoverResponse(
        layoutPatch=patches,
        usage=V3Usage(durationMs=duration_ms, models=V3Models()),
    )
