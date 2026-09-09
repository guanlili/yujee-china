"""把档案回填进章节树的两个死字段。

`V3ChapterPhoto.sceneDescription` 和 `.composition` 契约里本来就有,但生产里一个
恒空串、一个恒 None:

- sceneDescription 恒空 => design-agent 每次 read_page 收到空串,skills.ts 在教
  模型用一个死字段,search_book 搜照片描述那条分支永远搜不到
- composition 恒 None  => 模板槽位声明的构图约束**在生产里完全没生效**
  (slot_matcher_v3 遇到 None 就「视作任意,不挡」,三级兜底阶梯第 1、2 级等价)

填回去立即生效,是白捡的收益。**但存量书没有档案,必须能退回原值。**
"""

from src.contracts.schemas import V3AnalyzePhoto
from src.workflows.core.chaptering.schema import GroupingChapter, GroupingResult
from src.workflows.core.chaptering.tree_builder import assemble_stage1_tree
from src.workflows.core.chaptering.unplaced import UnplacedAssignments

_PIXEL = "data:image/jpeg;base64,AA=="


def _photo(photo_id: str) -> V3AnalyzePhoto:
    return V3AnalyzePhoto(
        photoId=photo_id,
        base64=_PIXEL,
        width=800,
        height=600,
        exif={"takenAt": "2024-03-01T09:00:00Z"},
    )


def _fixture():
    photos_by_id = {pid: _photo(pid) for pid in ("p1", "p2")}
    grouping = GroupingResult(
        chapters=[GroupingChapter(chapterId="ch_1", photoIds=["p1", "p2"])],
        unplacedPhotoIds=[],
    )
    return grouping, UnplacedAssignments(assignments={}), photos_by_id


def _photos_of(tree):
    return {p.photoId: p for c in tree.chapters for p in c.photos}


def test_without_profiles_keeps_todays_behavior():
    """存量书没有档案 —— 必须退回原值('' / None),不能炸也不能填垃圾。"""
    tree = assemble_stage1_tree(*_fixture())
    photos = _photos_of(tree)
    assert photos["p1"].sceneDescription == ""
    assert photos["p1"].composition is None


def test_none_profiles_argument_is_same_as_absent():
    grouping, assignments, photos_by_id = _fixture()
    tree = assemble_stage1_tree(grouping, assignments, photos_by_id, profiles=None)
    assert _photos_of(tree)["p1"].composition is None


def test_profiles_backfill_both_dead_fields():
    grouping, assignments, photos_by_id = _fixture()
    profiles = {
        "p1": {"description": "傍晚的礁石", "composition": "wide"},
        "p2": {"description": "窗边侧脸", "composition": "closeup"},
    }
    tree = assemble_stage1_tree(grouping, assignments, photos_by_id, profiles=profiles)
    photos = _photos_of(tree)
    assert photos["p1"].sceneDescription == "傍晚的礁石"
    assert photos["p1"].composition == "wide"
    assert photos["p2"].composition == "closeup"


def test_partial_profiles_only_fill_the_photos_that_have_one():
    """一张建档失败不该影响别的照片 —— 建档是尽力而为的。"""
    grouping, assignments, photos_by_id = _fixture()
    profiles = {"p1": {"description": "傍晚的礁石", "composition": "wide"}}
    photos = _photos_of(assemble_stage1_tree(grouping, assignments, photos_by_id, profiles=profiles))
    assert photos["p1"].composition == "wide"
    assert photos["p2"].composition is None
    assert photos["p2"].sceneDescription == ""


def test_profile_missing_keys_fall_back_not_crash():
    """档案形状不全(老版本档案/降级产物)时退回原值,别把整次 analyze 打挂。"""
    grouping, assignments, photos_by_id = _fixture()
    profiles = {"p1": {}, "p2": {"composition": "focal"}}
    photos = _photos_of(assemble_stage1_tree(grouping, assignments, photos_by_id, profiles=profiles))
    assert photos["p1"].sceneDescription == "" and photos["p1"].composition is None
    assert photos["p2"].composition == "focal" and photos["p2"].sceneDescription == ""


def test_out_of_enum_composition_is_dropped_not_forwarded():
    """契约里 composition 是 Literal —— 塞个枚举外的值进去会让 pydantic 直接把
    整次 analyze 打成 failed。回填层必须自己挡住。"""
    grouping, assignments, photos_by_id = _fixture()
    profiles = {"p1": {"composition": "panorama", "description": "x"}}
    photos = _photos_of(assemble_stage1_tree(grouping, assignments, photos_by_id, profiles=profiles))
    assert photos["p1"].composition is None
    assert photos["p1"].sceneDescription == "x"


def test_overlong_description_is_truncated_not_fatal():
    """sceneDescription 契约 max_length=300,超了同样会打挂 analyze。"""
    grouping, assignments, photos_by_id = _fixture()
    profiles = {"p1": {"description": "很长" * 400, "composition": "focal"}}
    photos = _photos_of(assemble_stage1_tree(grouping, assignments, photos_by_id, profiles=profiles))
    assert len(photos["p1"].sceneDescription) <= 300
