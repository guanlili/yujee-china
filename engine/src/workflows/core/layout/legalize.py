"""Stage2 排版的确定性收尾:把评委选中的『代码随机候选』最终化成页。

这层只做确定性逻辑,零 LLM/agent import。两端共用的章节/照片字段读取辅助也放这里
(compose 复用 `_photos` / `_photo_id`)。

【已拆除的旧线框流程】这里原本还有 `build_candidate_catalog`(骨架预览目录,喂给
旧的 slots-JSON 线框评委)和 `legalize_layout`(夹紧 Gemini 输出的 slot 映射),
连同 `template_previews` 加载器 —— 自从评委改为「浏览器真照片缩略图直接看图选」,
生产里它们零调用,只剩自己的测试在跑。骨架 PNG 不再进 engine 镜像;
manifest.json 也已废除 —— design-agent 的 catalog 改为直接从模板 JSON 推导
(structureDescription 运行时生成),template-previews 整个目录已删。
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any


def _get(obj: Mapping[str, Any] | Any, key: str, default: Any = None) -> Any:
    if isinstance(obj, Mapping):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _photos(chapter: Mapping[str, Any] | Any) -> list[Any]:
    return list(_get(chapter, "photos", []) or [])


def _photo_id(photo: Mapping[str, Any] | Any) -> str:
    value = _get(photo, "photoId")
    if not isinstance(value, str) or not value:
        raise ValueError("photo must carry photoId")
    return value


def _page_slots(page: Mapping[str, Any]) -> Mapping[str, Any]:
    """页的 slot→photoId 映射。兼容两种来源:Gemini 输出用 `slots`,
    代码候选生成器(candidate_gen_v3)产出的最终页用 `images`。"""
    slots = page.get("slots")
    if isinstance(slots, Mapping) and slots:
        return slots
    images = page.get("images")
    return images if isinstance(images, Mapping) else {}


def finalize_candidate_pages(
    chapter: Mapping[str, Any] | Any,
    pages: Sequence[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    """最终化一个『代码随机候选』:候选由 candidate_gen 按容量拆分+按容量选模板生成,
    天然填满、不重不漏,所以这里只重排 pageIndex,不做夹紧/重排/校验。
    `chapter` 参数保留以对齐调用签名(当前未使用)。"""
    del chapter  # 候选自洽,无需按章校验。
    return [
        {
            "pageIndex": idx,
            "templateId": page["templateId"],
            "images": dict(_page_slots(page)),
            "texts": page.get("texts") if isinstance(page.get("texts"), dict) else {},
        }
        for idx, page in enumerate(pages)
    ]
