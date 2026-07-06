"""排版图槽匹配(确定性,P1)。

给定一组照片和一个模板,尝试把照片映射到模板的图槽。匹配按 3 级兜底阶梯放宽,
保证只要照片数 == 模板容量就一定能产出一个合法映射(最底层退化为顺序填,即
旧 `skeleton_v3.assign_images_v3` 的行为):

  1. 构图 + 朝向 都匹配(槽位未声明 orientation/composition => 接受任意)
  2. 仅朝向匹配(放宽构图)
  3. 顺序填(全放宽)

匹配本身零随机、纯确定性;随机性在 `candidate_gen_v3` 通过打乱照片/模板顺序注入。
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from . import skeleton_v3, templates


def _photo_attr(photo: Mapping[str, Any] | Any, key: str) -> Any:
    if isinstance(photo, Mapping):
        return photo.get(key)
    return getattr(photo, key, None)


def _slot_accepts(
    slot: templates.ImageSlot,
    photo: Mapping[str, Any] | Any,
    *,
    use_composition: bool,
) -> bool:
    """照片能否放进这个槽位。未声明的维度 = 接受任意。"""
    orientations = slot.get("orientation")
    if orientations:
        if _photo_attr(photo, "orientation") not in orientations:
            return False
    if use_composition:
        compositions = slot.get("composition")
        if compositions:
            comp = _photo_attr(photo, "composition")
            # 照片无构图(旧相册/识图缺失)=> 视作任意,不挡。
            if comp is not None and comp not in compositions:
                return False
    return True


def _slot_constraints(template: templates.TemplateDef, slot_ids: Sequence[str]) -> dict[str, templates.ImageSlot]:
    """槽 id -> 约束对象。grid 模板展开的 ``base[i]`` 复用 base repeat-slot 的约束。"""
    slot_map = templates.image_slot_map(template)
    out: dict[str, templates.ImageSlot] = {}
    for sid in slot_ids:
        if sid in slot_map:
            out[sid] = slot_map[sid]
            continue
        # grid 展开键 base[i]:回退到 items.images 的 repeat slot 约束(若有)。
        base = sid.split("[", 1)[0]
        items = template.get("items") or {}
        repeat = next((s for s in (items.get("images") or []) if s.get("id") == base), None)
        out[sid] = repeat if repeat is not None else {"id": sid}
    return out


def _greedy_assign(
    slot_ids: Sequence[str],
    constraints: Mapping[str, templates.ImageSlot],
    photos: Sequence[Any],
    *,
    use_composition: bool,
) -> dict[str, str] | None:
    """贪心:按槽顺序,给每个槽挑第一张未用且匹配的照片。全部槽填满才算成功。"""
    remaining = list(photos)
    mapping: dict[str, str] = {}
    for sid in slot_ids:
        slot = constraints[sid]
        pick_idx = next(
            (
                i
                for i, p in enumerate(remaining)
                if _slot_accepts(slot, p, use_composition=use_composition)
            ),
            None,
        )
        if pick_idx is None:
            return None
        photo = remaining.pop(pick_idx)
        pid = _photo_attr(photo, "photoId")
        if not isinstance(pid, str) or not pid:
            return None
        mapping[sid] = pid
    return mapping


def template_fit_score(template_id: str, photos: Sequence[Any]) -> float:
    """这页照片有多适合这个模板:0(只能硬塞)~ 2(朝向+构图都完美匹配)。

    选模板时用来做软偏好打分(candidate_gen):分越高,照片越契合模板槽位的
    朝向/构图声明。无约束的槽位中性计分(不加不减),所以"不限朝向"的模板不会被
    误判为差。容量不符返回 -1(不该选)。
    """
    template = templates.TEMPLATES.get(template_id)
    if template is None:
        return -1.0
    slot_ids = skeleton_v3.image_slot_keys(template)
    if len(photos) != len(slot_ids):
        return -1.0
    constraints = _slot_constraints(template, slot_ids)

    # 朝向完美匹配 + 构图完美匹配各算一分(都用贪心是否能填满来判定)。
    score = 0.0
    if _greedy_assign(slot_ids, constraints, photos, use_composition=False) is not None:
        score += 1.0  # 朝向能各就各位
    if _greedy_assign(slot_ids, constraints, photos, use_composition=True) is not None:
        score += 1.0  # 构图也能各就各位
    return score


def match_photos_to_template(
    template_id: str,
    photos: Sequence[Any],
) -> dict[str, str] | None:
    """把 photos 映射到模板图槽,3 级兜底。照片数必须 == 模板容量,否则返回 None。

    返回 {slotId: photoId};随机性由调用方对 photos 的顺序负责(本函数确定性)。
    """
    template = templates.TEMPLATES.get(template_id)
    if template is None:
        return None
    slot_ids = skeleton_v3.image_slot_keys(template)
    if len(photos) != len(slot_ids):
        return None
    constraints = _slot_constraints(template, slot_ids)

    # 阶梯 1:构图 + 朝向
    mapping = _greedy_assign(slot_ids, constraints, photos, use_composition=True)
    if mapping is not None:
        return mapping
    # 阶梯 2:仅朝向(放宽构图)
    mapping = _greedy_assign(slot_ids, constraints, photos, use_composition=False)
    if mapping is not None:
        return mapping
    # 阶梯 3:顺序填(全放宽),保证不死锁
    return {sid: _photo_attr(p, "photoId") for sid, p in zip(slot_ids, photos, strict=True)}
