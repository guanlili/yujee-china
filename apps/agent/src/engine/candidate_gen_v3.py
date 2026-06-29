"""排版候选生成(确定性随机,P1)。

每章用 `random.Random(seed)` 播种,生成 N 个「整章排版方案」候选,供后续 LLM 评委
挑最好的一个。随机但合法:随机切页(混用不同容量)+ 每页随机选一个容量匹配的模板 +
用 `slot_matcher_v3` 的 3 级兜底把照片填进槽。同一 seed 可复现,不同 seed 出不同方案。

`seed` 用 Stage2 的 requestId(每次请求稳定),测试里锁 seed 即可断言确定性。
随机只在本模块通过注入的 `random.Random` 实例发生,绝不用模块级 `random.*`,
以免破坏其余引擎/测试依赖的确定性。
"""

from __future__ import annotations

import random
from collections.abc import Mapping, Sequence
from typing import Any

from . import skeleton_v3, slot_matcher_v3

_CATEGORY = "interior"

# 每章生成的候选数(默认 3;调用方可覆盖)。
DEFAULT_CANDIDATE_COUNT = 3
# 同一 seed 下,生成 N 个不同候选时最多重试多少轮去重后放弃(允许重复兜底)。
_MAX_VARIANT_ATTEMPTS = 12


def _photo_id(photo: Mapping[str, Any] | Any) -> str:
    if isinstance(photo, Mapping):
        value = photo.get("photoId")
    else:
        value = getattr(photo, "photoId", None)
    if not isinstance(value, str) or not value:
        raise ValueError("photo must carry photoId")
    return value


def _capacities_with_templates(max_cap: int) -> list[int]:
    """1..max_cap 里真有模板的容量档。"""
    return [c for c in range(1, max_cap + 1) if skeleton_v3.candidate_ids(_CATEGORY, c)]


# 枚举页大小拆分时的安全上限:超过这么多张就不全枚举(组合爆炸),退化为逐块随机。
_ENUMERATE_MAX_PHOTOS = 40


def _enumerate_partitions(total: int, caps: Sequence[int]) -> list[tuple[int, ...]]:
    """枚举所有『和为 total』的拆分,每个部件 ∈ caps,部件降序(去重等价拆分)。

    例如 total=7、caps=[1..6] => 6+1 / 5+2 / 5+1+1 / 4+3 / 4+2+1 / 3+3+1 / 2+2+2+1 ... 全部。
    这是『先列出所有可能再挑』的真随机基础,不是贪心一条路径。"""
    desc = sorted({c for c in caps if c >= 1}, reverse=True)
    out: list[tuple[int, ...]] = []

    def rec(remaining: int, max_part: int, acc: list[int]) -> None:
        if remaining == 0:
            out.append(tuple(acc))
            return
        for c in desc:
            if c > max_part or c > remaining:
                continue
            acc.append(c)
            rec(remaining - c, c, acc)  # 降序约束,避免排列重复
            acc.pop()

    rec(total, total, [])
    return out


def _random_page_sizes(total: int, rng: random.Random, usable_caps: Sequence[int]) -> list[int]:
    """随机选一个『和为 total』的整数拆分(每部件 ∈ usable_caps),并打乱页顺序。

    先**枚举所有**满足条件的拆分,再从中**均等随机**挑一个 —— 每个组合机会均等,
    版式多样性远超旧的逐块贪心。照片数过多(组合爆炸)时退化为逐块随机兜底。"""
    caps = [c for c in usable_caps if c >= 1]
    if total <= _ENUMERATE_MAX_PHOTOS:
        partitions = _enumerate_partitions(total, caps)
        if partitions:
            chosen = list(rng.choice(partitions))
            rng.shuffle(chosen)  # 拆分本身降序,打乱成随机页顺序(大小页混排)
            return chosen

    # 兜底(超大章):逐块随机。
    sizes: list[int] = []
    remaining = total
    while remaining > 0:
        choices = [c for c in caps if c <= remaining]
        size = rng.choice(choices)
        sizes.append(size)
        remaining -= size
    return sizes


# 适配度对选模板权重的放大系数:权重 = 1 + score*K(score 0~2)。
# K=3 时满分模板权重 7、零分 1,高度偏向匹配但不排他。
_FIT_WEIGHT = 3.0


def _weighted_pick_template(
    template_ids: Sequence[str],
    page_photos: Sequence[Any],
    rng: random.Random,
) -> str:
    """按"照片适配度"加权随机选一个模板(软偏好)。"""
    weights = [
        1.0 + _FIT_WEIGHT * max(0.0, slot_matcher_v3.template_fit_score(tid, page_photos))
        for tid in template_ids
    ]
    # 加权随机:rng.choices 支持 weights;同 seed 可复现。
    return rng.choices(list(template_ids), weights=weights, k=1)[0]


def _build_one_candidate(
    photos: Sequence[Any],
    rng: random.Random,
) -> list[dict[str, Any]] | None:
    """生成一个整章方案:随机切页 + 每页随机选模板 + 匹配填槽。失败返回 None。"""
    max_cap = skeleton_v3.max_capacity(_CATEGORY)
    usable_caps = _capacities_with_templates(max_cap)
    if not usable_caps:
        return None

    ordered = list(photos)  # 章内顺序为时序基准
    sizes = _random_page_sizes(len(ordered), rng, usable_caps)

    pages: list[dict[str, Any]] = []
    cursor = 0
    for size in sizes:
        page_photos = ordered[cursor : cursor + size]
        cursor += size
        template_ids = list(skeleton_v3.candidate_ids(_CATEGORY, size))
        if not template_ids:
            return None
        # 软偏好:按"照片适配度"加权随机选模板,而不是瞎选再硬塞。适配高(朝向/构图
        # 都合槽位)的模板权重大,但低分也留小概率,保留版式多样性、不死板。
        template_id = _weighted_pick_template(template_ids, page_photos, rng)
        # 页内照片顺序也打乱,让构图/朝向匹配有随机性(匹配器本身确定性)。
        shuffled = list(page_photos)
        rng.shuffle(shuffled)
        slots = slot_matcher_v3.match_photos_to_template(template_id, shuffled)
        if slots is None:
            return None
        pages.append(
            {
                "pageIndex": len(pages),
                "templateId": template_id,
                "images": slots,
                "texts": {},
            }
        )
    return pages


def _candidate_signature(pages: Sequence[Mapping[str, Any]]) -> tuple:
    """用于去重:模板序列 + 每页槽映射。"""
    return tuple(
        (p["templateId"], tuple(sorted(p["images"].items()))) for p in pages
    )


def generate_candidates(
    photos: Sequence[Any],
    *,
    seed: str,
    count: int = DEFAULT_CANDIDATE_COUNT,
) -> list[list[dict[str, Any]]]:
    """为一章生成最多 `count` 个不同的整章排版候选(确定性随机,seed 播种)。

    返回候选列表,每个候选是 pages[](pageIndex/templateId/images/texts)。
    至少返回 1 个(只要 photos 非空)。同 seed+photos 输出可复现。
    """
    if not photos:
        return []

    candidates: list[list[dict[str, Any]]] = []
    seen: set[tuple] = set()
    attempt = 0
    while len(candidates) < count and attempt < count + _MAX_VARIANT_ATTEMPTS:
        rng = random.Random(f"{seed}#{attempt}")
        pages = _build_one_candidate(photos, rng)
        attempt += 1
        if pages is None:
            continue
        sig = _candidate_signature(pages)
        if sig in seen:
            continue
        seen.add(sig)
        candidates.append(pages)

    # 一个都没生成出来(极端兜底):退化为确定性 skeleton 单候选。
    if not candidates:
        fallback = skeleton_v3.build_skeleton_v3(
            [{"photos": [_photo_id(p) for p in photos]}]
        )
        candidates.append(fallback)
    return candidates
