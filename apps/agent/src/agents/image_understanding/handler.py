"""真实识图环节:Volcano Ark `doubao-seed-1-6-vision`,一次多图调用。V3 设计 §2 用可见的
场景/时间信号来分组;V3 创作树没有 location/place 维度。

隐私:照片 base64 被传进上游 HTTP body,随后丢掉本地引用;我们绝不记录它,也绝不把它交回
给调用方。"""

import asyncio
from pathlib import Path
from typing import Any

from ...logging_config import get_logger
from ...schemas import (
    V3AnalyzePhoto,
    V3Chapter,
    V3ChapterPhoto,
    V3LayoutTree,
)
from ...settings import get_settings
from ...prompts import RULES_DIR, load_prompt
from ... import ai_client
from ...vision_provider import (
    VisionSlot,
    VisionSlotError,
    ark_vision_slot,
    openai_vision_slot,
)
from .schema import V3DescribeResult

_PROMPT_DIR = Path(__file__).resolve().parent

log = get_logger("vision")


class VisionError(Exception):
    """识图环节以一种应作为 AGENT_VISION_FAILED 外抛的方式失败。"""


def _photo_orientation(width: int, height: int) -> str:
    if width > height * 1.05:
        return "landscape"
    if height > width * 1.05:
        return "portrait"
    return "square"


# =============================================================================
# V3 describe-content (issue #182):一次识图模型调用 → 章节树。
#
# 模型【只】撰写 3 样东西(v3-requirements §4.1):
#   ① 把照片分入章节(分章)  ② 每章 `description`
#   ③ 每张照片 `sceneDescription`
# 其它一切(width/height/orientation/takenAt)都由代码填充(WP1.2),从不经 LLM 往返
# —— 见 `_assemble_v3_tree`。
#
# Provider failover(architecture §6.8 第 2 条 / v3-impl-plan §6.2):主 =
# OpenAI (GPT-5.5 Mini, `OPENAI_*`);FAILOVER = 火山 doubao (`ARK_*`)。当 OpenAI slot
# 在 ai_client 的一次重试后、在更紧的 `describe_openai_timeout_seconds` 预算内仍 5xx/超时,
# 或整批超出 `describe_batch_deadline_seconds` 时,我们降级火山。降级语义(先 GPT、自动
# 降级火山)是固定的;数字可调。
# =============================================================================


def _build_v3_system_prompt(language: str) -> str:
    lang_name = "Chinese" if language == "zh" else "English"
    # 固定结构(任务 + 输出 JSON 契约)co-located 在 describe_content.md;
    # 分章启发式是人为可调规则,外置在 prompts/rules/chapter_grouping.md。
    base = load_prompt(
        _PROMPT_DIR / "describe_content.md",
        LANGUAGE=lang_name,
        common=("json_only", "grounding", "privacy"),
    )
    grouping = load_prompt(RULES_DIR / "chapter_grouping.md")
    return f"{base}\n\n{grouping}"


def _build_v3_user_content(
    photos: list[V3AnalyzePhoto], prompt_hint: str | None
) -> list[dict[str, Any]]:
    """构建多图 user turn。清单承载每个 photoId + 其代码算出的 `takenAt` 作为分章时间信号
    (§4.1(c)),外加 —— 当浏览器对照片做了预分组(#232)—— 逐照片一个不透明的 `cluster`
    标签,使模型尊重 cluster 边界。清单里绝不放任何 GPS/place(§3 隐私);`cluster` 只是一个
    裸的 same-place/same-time 标签,不是坐标。

    注意:cluster 标签表达在模型看到的简单 id 空间(1,2,3…)里 —— 这里的 `photos` 已被
    `_describe_call` 重映射过,它们的 `clusterId` 随 `model_copy` 一起带过。它们按 cluster
    在【本次】调用清单里首次出现的顺序被重新标记为 c1/c2/…,使模型永远看不到一个与其本地批次
    不匹配的全局 cluster 索引。"""
    # 把本次调用的 cluster 重新标记为稠密的本地 c1/c2/…(按首次出现顺序)。没有 clusterId 的
    # 照片不带标签 → 模型自由分组。
    local_label: dict[str, str] = {}
    for photo in photos:
        cid = photo.clusterId
        if cid is not None and cid not in local_label:
            local_label[cid] = f"c{len(local_label) + 1}"
    has_clusters = bool(local_label)

    manifest_lines = []
    for idx, photo in enumerate(photos):
        taken = (photo.exif.takenAt if photo.exif else None) or "unknown"
        line = f"{idx + 1}. photoId={photo.photoId} takenAt={taken}"
        if photo.clusterId is not None:
            line += f" cluster={local_label[photo.clusterId]}"
        manifest_lines.append(line)
    manifest = "\n".join(manifest_lines)
    hint_block = (
        f"用户的纪念册提示(仅作背景,不要原样照搬):\n{prompt_hint}\n\n"
        if prompt_hint
        else ""
    )
    # cluster 分组规则是人为可调规则,外置在 prompts/rules/cluster_grouping.md。
    cluster_block = (
        "\n\n" + load_prompt(RULES_DIR / "cluster_grouping.md") if has_clusters else ""
    )
    parts: list[dict[str, Any]] = [
        {
            "type": "text",
            "text": (
                f"{hint_block}"
                f"照片按顺序排列如下(共 {len(photos)} 张)。请使用这些确切的 "
                "photoId 值;takenAt 是用于划定章节边界的拍摄时间信号:\n"
                f"{manifest}"
                f"{cluster_block}\n\n"
                '按系统指令返回 {"chapters":[...]}。'
            ),
        }
    ]
    for photo in photos:
        parts.append({"type": "image_url", "image_url": {"url": photo.base64}})
    return parts


def _orientation(width: int, height: int) -> str:
    return _photo_orientation(width, height)


def _assemble_v3_tree(
    parsed: Any, photos: list[V3AnalyzePhoto]
) -> V3LayoutTree:
    """把模型的章节切分(LLM 撰写)与代码填充的确定性照片属性融合成一个经校验的
    V3LayoutTree。

    校验守卫(§4.1 一图一章不跨章 + LLM 只写 3 处):
      * 每张输入照片必须恰好落入【一个】章节;重复、未知或遗漏的 photoId 使模型输出无效。
      * 章节 `description` 和照片 `sceneDescription` 必须存在;代码绝不为那些 LLM 所有的
        字段撰写兜底文案。
      * width/height/orientation/takenAt 【只】来自请求 —— 模型的副本(若有)被忽略。
      * accentColor/artFont 保持 null 占位(theme 环节填它们,§4.1)。
    """
    by_id = {p.photoId: p for p in photos}
    raw_chapters = parsed.get("chapters") if isinstance(parsed, dict) else None
    if not isinstance(raw_chapters, list):
        raise VisionError("describe-content response missing chapters[] array")

    def _required_text(raw: Any, *, field: str, max_len: int) -> str:
        if not isinstance(raw, str):
            raise VisionError(f"describe-content {field} must be a string")
        text = raw.strip()
        if not text:
            raise VisionError(f"describe-content {field} is required")
        if len(text) > max_len:
            raise VisionError(f"describe-content {field} exceeds {max_len} chars")
        return text

    def _photo_node(photo_id: str, scene_raw: Any) -> V3ChapterPhoto:
        src = by_id[photo_id]
        scene = _required_text(
            scene_raw, field=f"scenes.{photo_id}", max_len=300
        )
        return V3ChapterPhoto(
            photoId=photo_id,
            sceneDescription=scene,
            width=src.width,
            height=src.height,
            orientation=_orientation(src.width, src.height),  # type: ignore[arg-type]
            takenAt=src.exif.takenAt if src.exif else None,
        )

    chapters: list[V3Chapter] = []
    claimed: set[str] = set()
    for ch_idx, raw in enumerate(raw_chapters):
        if not isinstance(raw, dict):
            raise VisionError(f"describe-content chapter {ch_idx + 1} must be an object")
        scenes = raw.get("scenes")
        if not isinstance(scenes, dict):
            raise VisionError(f"describe-content chapter {ch_idx + 1} missing scenes object")
        raw_ids = raw.get("photoIds")
        if not isinstance(raw_ids, list) or not raw_ids:
            raise VisionError(f"describe-content chapter {ch_idx + 1} missing photoIds[]")
        description = _required_text(
            raw.get("description"),
            field=f"chapters[{ch_idx}].description",
            max_len=600,
        )
        chapter_photos: list[V3ChapterPhoto] = []
        for raw_pid in raw_ids:
            if not isinstance(raw_pid, str) or not raw_pid.strip():
                raise VisionError(f"describe-content chapter {ch_idx + 1} has invalid photoId")
            pid = raw_pid.strip()
            if pid not in by_id:
                raise VisionError(f"describe-content referenced unknown photoId: {pid}")
            if pid in claimed:
                raise VisionError(f"describe-content duplicated photoId: {pid}")
            claimed.add(pid)
            chapter_photos.append(_photo_node(pid, scenes.get(pid)))
        chapters.append(
            V3Chapter(
                chapterId=f"ch_{len(chapters) + 1}",
                description=description,
                accentColor=None,  # theme 环节填(§4.1)
                artFont=None,
                photos=chapter_photos,
            )
        )

    missed = [p.photoId for p in photos if p.photoId not in claimed]
    if missed:
        raise VisionError(f"describe-content omitted photoIds: {', '.join(missed)}")

    if not chapters:
        raise VisionError("describe-content produced no usable chapters")
    return V3LayoutTree(chapters=chapters)


def _remap_describe_photo_ids(parsed: Any, real_by_simple: dict[str, str]) -> Any:
    """识图模型用简单序号 id(1,2,3…)作答 → 映射回真实 photoId(serial→hash)。
    映射 chapters[].photoIds 列表 + chapters[].scenes 的 key。模型偶发幻觉的未知序号
    原样留下(不在映射表里),由 _assemble_v3_tree 的 unknown/omitted 校验拦截。"""
    if not isinstance(parsed, dict):
        return parsed
    chapters = parsed.get("chapters")
    if not isinstance(chapters, list):
        return parsed
    for ch in chapters:
        if not isinstance(ch, dict):
            continue
        ids = ch.get("photoIds")
        if isinstance(ids, list):
            ch["photoIds"] = [
                real_by_simple.get(i.strip(), i.strip()) if isinstance(i, str) else i
                for i in ids
            ]
        scenes = ch.get("scenes")
        if isinstance(scenes, dict):
            ch["scenes"] = {
                (real_by_simple.get(k.strip(), k.strip()) if isinstance(k, str) else k): v
                for k, v in scenes.items()
            }
    return parsed


# =============================================================================
# WP-C (#232):cluster 感知的 describe —— 按 clusterId 切分,按张数把整簇调度进并发
# 路由,再按全局顺序合并各局部树。
# =============================================================================


def _partition_into_clusters(
    photos: list[V3AnalyzePhoto],
) -> list[list[V3AnalyzePhoto]]:
    """按 `clusterId`(浏览器的 same-place/same-time 标签,#232)给照片分组。返回一个 cluster
    列表;每个 cluster 把它的照片保持在输入顺序。Cluster 按其最早的 `takenAt` 排序(时间
    顺序);并列与缺失 takenAt 时回退到 cluster 的首次出现顺序。Cluster = 章节下界:一个
    cluster 绝不跨路由拆分。

    `clusterId` 为 None 的照片不被合并到一起 —— 每张 null 照片自成一个单元素「cluster」,
    使模型可自由分组它。当【每张】照片都是 null 时,这会得到逐照片一个单元素 cluster,基于
    张数的调度器仍把它们收拢成单条遗留路由(≤20)或均衡路由。"""
    order: list[str] = []  # cluster key,按首次出现顺序
    members: dict[str, list[V3AnalyzePhoto]] = {}
    null_seq = 0
    for photo in photos:
        if photo.clusterId is None:
            null_seq += 1
            key = f"\x00null:{null_seq}"  # 唯一哨兵 → 单元素 cluster
        else:
            key = photo.clusterId
        if key not in members:
            members[key] = []
            order.append(key)
        members[key].append(photo)

    appear_idx = {key: i for i, key in enumerate(order)}

    def _earliest(key: str) -> tuple[int, str, int]:
        # 排序键:(有 takenAt?, 最早 takenAt 的 iso, 首次出现索引)。
        # 有 takenAt 的照片排在没有的前面;ISO 字符串按时间顺序排;首次出现索引是稳定的
        # 平局裁决。
        takens = [
            p.exif.takenAt
            for p in members[key]
            if p.exif and p.exif.takenAt
        ]
        if takens:
            return (0, min(takens), appear_idx[key])
        return (1, "", appear_idx[key])

    return [members[k] for k in sorted(order, key=_earliest)]


def _plan_describe_routes(
    clusters: list[list[V3AnalyzePhoto]], route_count: int
) -> list[list[V3AnalyzePhoto]]:
    """把整簇装箱进 `route_count` 条路由,按照片数均衡(贪心:最大簇优先放进当前最轻的
    路由)。一个 cluster 绝不跨路由拆分(簇不跨路)。Cluster 的全局顺序在合并时可从每张
    照片的位置恢复,所以这里的装箱顺序与最终章节序列无关。空路由被丢弃。"""
    if route_count <= 1:
        flat = [p for cluster in clusters for p in cluster]
        return [flat] if flat else []

    # 最大簇优先,使单个超大簇大致独占一路、小簇填补空隙 → 均衡张数(装箱 first-fit-decreasing)。
    ordered = sorted(clusters, key=len, reverse=True)
    routes: list[list[V3AnalyzePhoto]] = [[] for _ in range(route_count)]
    loads = [0] * route_count
    for cluster in ordered:
        target = min(range(route_count), key=lambda i: loads[i])
        routes[target].extend(cluster)
        loads[target] += len(cluster)
    return [r for r in routes if r]


def _route_count_for(total: int, settings: Any) -> int:
    """张数驱动的并发宽度(#232):≤lo → 1,>lo → 2,>hi → 3(受 describe_max_concurrency
    封顶)。阈值绝不重新切割语义 cluster。"""
    lo = settings.describe_concurrency_threshold_lo
    hi = settings.describe_concurrency_threshold_hi
    if total <= lo:
        return 1
    width = 3 if total > hi else 2
    return min(width, max(1, settings.describe_max_concurrency))


def _merge_route_trees(
    sequenced_photos: list[V3AnalyzePhoto], route_trees: list[V3LayoutTree]
) -> V3LayoutTree:
    """把各路由的局部章节树拼接成一个全局树(#232)。

    `sequenced_photos` 是已按【全局 cluster 顺序】(cluster 按最早 takenAt 排序 ——
    见 `_partition_into_clusters`)展平的照片列表,【不是】原始请求顺序。各路由承载互不相交
    的整簇集合,所以按每路由各章首照片的 sequenced 索引来排序,就让跨路由的章节落在 cluster
    (时间)顺序上;某路由内被再分成子章节的一个 cluster 仍保持连续,因为它占据 sequenced
    顺序里一段连续区间。随后章节被重编号 ch_1..N;章节内的照片顺序按撰写保持不变。这个并集
    必须恰好覆盖每张照片一次(每条路由已在自己的切片上通过 `_assemble_v3_tree` 的一图一章
    守卫;这里我们再断言全局覆盖,使调度/合并 bug 无法悄悄丢掉或重复一张照片)。我们【还】
    确定性地强制 cluster 边界:单个章节不得混入两个不同(非 null)cluster 的照片 —— prompt
    已这样要求,而一个把 cluster 合并的失常模型在这里被拒,使异簇不并章即便模型无视指令也成立。"""
    global_pos = {p.photoId: i for i, p in enumerate(sequenced_photos)}
    cluster_of = {p.photoId: p.clusterId for p in sequenced_photos}

    ordered_chapters: list[V3Chapter] = []
    for tree in route_trees:
        for ch in tree.chapters:
            ordered_chapters.append(ch)
    # 按每章首照片的 sequenced(cluster/时间)索引做稳定排序 → 跨路由的章节落在全局
    # cluster 顺序上。
    ordered_chapters.sort(
        key=lambda ch: global_pos.get(ch.photos[0].photoId, len(global_pos))
        if ch.photos
        else len(global_pos)
    )

    seen: set[str] = set()
    renumbered: list[V3Chapter] = []
    for ch in ordered_chapters:
        chapter_clusters: set[str] = set()
        for ph in ch.photos:
            if ph.photoId in seen:
                raise VisionError(
                    f"describe-content merge duplicated photoId: {ph.photoId}"
                )
            seen.add(ph.photoId)
            cid = cluster_of.get(ph.photoId)
            if cid is not None:  # null-cluster 照片不带边界约束
                chapter_clusters.add(cid)
        if len(chapter_clusters) > 1:
            raise VisionError(
                "describe-content merge mixed distinct clusters in one chapter: "
                + ", ".join(sorted(chapter_clusters))
            )
        renumbered.append(
            V3Chapter(
                chapterId=f"ch_{len(renumbered) + 1}",
                description=ch.description,
                accentColor=ch.accentColor,
                artFont=ch.artFont,
                photos=ch.photos,
            )
        )

    missed = [p.photoId for p in sequenced_photos if p.photoId not in seen]
    if missed:
        raise VisionError(
            f"describe-content merge omitted photoIds: {', '.join(missed)}"
        )
    if not renumbered:
        raise VisionError("describe-content merge produced no chapters")
    return V3LayoutTree(chapters=renumbered)


# 小模型(豆包)非确定性偷懒:照片一多就漏几张/重复/错认序号。这类是可恢复失误,
# 带「必须覆盖全部 N 张」纠正提示 + 升温在同一 slot 内重抽,通常能修;结构性错误
# (缺 chapters[] 等)重试无益,直接上抛。注:浏览器侧 geo+date 预分组上线后单批变小,
# 此重试退化为纯兜底保险。
MAX_DESCRIBE_ATTEMPTS = 3


def _is_recoverable_describe_error(exc: VisionError) -> bool:
    """模型漏/重/错认 photoId 是非确定性失误,值得带纠正提示重抽。"""
    msg = str(exc)
    return (
        "omitted photoIds" in msg
        or "duplicated photoId" in msg
        or "referenced unknown photoId" in msg
    )


async def _describe_call(
    slot: VisionSlot, photos: list[V3AnalyzePhoto], language: str, prompt_hint: str | None
) -> tuple[V3LayoutTree, int]:
    """在 `slot` 上做一次识图模型调用。返回 (tree, tokens_billed)。上游失败时抛
    ai_client.AIRequestError(由调用方决定 failover),响应不可用时抛 VisionError。

    模型漏/重/错认 photoId 时,在同一 slot 内带纠正提示重抽,最多 MAX_DESCRIBE_ATTEMPTS
    次(累计计费 tokens);用尽仍不完整才抛 VisionError。"""
    # 给识图模型只喂简单序号 id(1,2,3…),它抄不错;拿回结果再映射回真实 photoId。
    # 真实 photoId 是长 hash,小模型(豆包)常抄岔/截断 → 「unknown photoId」失败。
    simple_photos = [
        p.model_copy(update={"photoId": str(i + 1)}) for i, p in enumerate(photos)
    ]
    real_by_simple = {str(i + 1): p.photoId for i, p in enumerate(photos)}
    n = len(simple_photos)
    system_prompt = _build_v3_system_prompt(language)
    user_content = _build_v3_user_content(simple_photos, prompt_hint)

    total_tokens = 0
    last_err: VisionError | None = None
    for attempt in range(MAX_DESCRIBE_ATTEMPTS):
        messages: list[dict[str, Any]] = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ]
        if attempt > 0 and last_err is not None:
            # 上一次漏/重/错认照片 → 明确要求覆盖全部 N 张再重抽(升温打破确定性偷懒)。
            # 重试纠正语是人为可调规则,外置在 prompts/rules/describe_retry.md。
            messages.append(
                {
                    "role": "user",
                    "content": load_prompt(
                        RULES_DIR / "describe_retry.md", N=str(n), ERR=str(last_err)
                    ),
                }
            )
        response = await ai_client.chat_completion(
            base_url=slot.base_url,
            api_key=slot.api_key,
            model=slot.model,
            messages=messages,
            timeout_seconds=slot.timeout_seconds,
            temperature=0.2 if attempt == 0 else 0.5,
            max_tokens=8192,
            response_format=slot.response_format,
            extra_body=slot.extra_body,
        )
        # 解析前丢掉对 user content(base64)的本地引用(§3 隐私)。
        messages = []  # noqa: F841
        del messages

        prompt_tokens, completion_tokens = ai_client.extract_usage(response)
        total_tokens += prompt_tokens + completion_tokens

        try:
            raw_text = ai_client.extract_text(response)
            parsed = ai_client.parse_json_loose(raw_text)
        except ValueError as exc:
            # 解析失败保持原行为(同类畸形输出不靠重试,直接抛)。
            raise VisionError(f"describe-content response unparseable: {exc}") from exc

        parsed = _remap_describe_photo_ids(parsed, real_by_simple)
        try:
            tree = _assemble_v3_tree(parsed, photos)
        except VisionError as exc:
            if (
                not _is_recoverable_describe_error(exc)
                or attempt == MAX_DESCRIBE_ATTEMPTS - 1
            ):
                raise
            last_err = exc
            log.warning(
                "v3_describe.retry",
                provider=slot.provider,
                attempt=attempt + 1,
                reason=str(exc)[:120],
            )
            continue
        return tree, total_tokens

    # 末次可恢复错误已在循环里 raise;此处仅防御性兜底。
    raise last_err or VisionError("describe-content failed after retries")


async def _describe_on_slot(
    slot: VisionSlot,
    photos: list[V3AnalyzePhoto],
    language: str,
    prompt_hint: str | None,
    *,
    settings: Any,
) -> tuple[V3LayoutTree, int, int]:
    """在【单个】provider slot 上做 cluster 感知的 describe(#232)。返回
    (merged_tree, tokens_billed, route_count)。

    - 按 clusterId 切分照片,把整簇调度进 N 条张数驱动的并发路由(N=1 退化为遗留的单次调用)。
    - 经 asyncio.gather 并发跑每条路由的 `_describe_call`;每条路由在自己的切片上保留各自的
      漏图重试安全网。
    - 按全局 cluster 顺序合并各路由的局部树,重编号 ch_1..N。

    若【任一】路由命中上游传输失败,抛 ai_client.AIRequestError(由调用方决定 failover);
    响应不可用/合并非法时抛 VisionError。gather(return_exceptions=False) 意味着首个传输错误
    传播、慢但健康的路径被取消 —— 然后 failover 对整批在另一个 slot 上跑【一次】,绝不逐路由,
    使并发绝不放大 failover 的扇出。"""
    clusters = _partition_into_clusters(photos)
    route_count = _route_count_for(len(photos), settings)
    routes = _plan_describe_routes(clusters, route_count)

    if len(routes) <= 1:
        # 遗留的单批路径(也是全 null 的向后兼容情形)。
        tree, tokens = await _describe_call(slot, photos, language, prompt_hint)
        return tree, tokens, 1

    log.info(
        "v3_describe.routes.plan",
        provider=slot.provider,
        routes=len(routes),
        sizes=[len(r) for r in routes],
    )
    results = await asyncio.gather(
        *(
            _describe_call(slot, route_photos, language, prompt_hint)
            for route_photos in routes
        )
    )
    route_trees = [tree for tree, _ in results]
    total_tokens = sum(tokens for _, tokens in results)
    # 按【全局 cluster 顺序】合并:把 takenAt 排序后的切分展平,使合并按 cluster/时间
    # 而非原始请求顺序来排跨路由的章节。
    sequenced = [p for cluster in clusters for p in cluster]
    merged = _merge_route_trees(sequenced, route_trees)
    return merged, total_tokens, len(routes)


async def describe_content(
    photos: list[V3AnalyzePhoto],
    *,
    language: str,
    prompt_hint: str | None = None,
) -> V3DescribeResult:
    """V3 analyze 步骤 (b):一次识图模型调用 → 章节树(§4.1)。

    Failover:先在更紧的 describe 预算内试 OpenAI (GPT-5.5 Mini);遇 AIRequestError
    (ai_client 重试后仍 5xx/超时),或整批超过 `describe_batch_deadline_seconds` 时,
    降级火山 doubao (ARK)。OpenAI 的 4xx/缺 key 失败是配置/请求错误,不做 failover。整次
    调用还额外受 `describe_batch_deadline_seconds` 约束,使一个慢但不报错的主 provider 仍会
    触发 failover,而非把 analyze 作业卡死。

    若【两个】provider 都失败或都没配,抛 VisionError —— 路由把它映射成 AGENT_VISION_FAILED。"""
    settings = get_settings()
    photo_count = len(photos)
    if photo_count == 0:
        raise VisionError("describe-content called with no photos")

    deadline = settings.describe_batch_deadline_seconds

    try:
        # 本地/豆包模式:vision_provider="ark" 时识图直接用火山 doubao 主力(带 thinking
        # 配置,避免 JSON 截断),不走打不通的 OpenAI。生产用 OpenAI 时设 vision_provider="openai"。
        if settings.vision_provider == "ark":
            primary_slot = ark_vision_slot(settings)
        else:
            primary_slot = openai_vision_slot(
                settings,
                timeout_seconds=settings.describe_openai_timeout_seconds,
                model=settings.describe_openai_model,
            )
    except VisionSlotError as exc:
        log.warning("v3_describe.primary_unconfigured", error=str(exc))
        raise VisionError(f"describe-content primary unavailable: {exc}") from exc

    log.info(
        "v3_describe.call.start",
        provider=primary_slot.provider,
        model=primary_slot.model,
        photo_count=photo_count,
    )
    try:
        # 这个 deadline 包住【整个】并发路由集合(_describe_on_slot 内部的 asyncio.gather)。
        # 因此一条慢路由对整批触发 failover【一次】—— 绝不逐路由 —— 使并发绝不放大 failover
        # 扇出。挂钟 ≈ 最慢的那条路由,而非它们之和(#232)。
        tree, tokens, routes = await asyncio.wait_for(
            _describe_on_slot(
                primary_slot, photos, language, prompt_hint, settings=settings
            ),
            timeout=deadline,
        )
        log.info(
            "v3_describe.call.ok",
            provider=primary_slot.provider,
            model=primary_slot.model,
            chapters=len(tree.chapters),
            routes=routes,
        )
        return V3DescribeResult(
            tree=tree,
            tokens_billed=tokens,
            model=primary_slot.model,
            provider=primary_slot.provider,
            call_count=routes,
        )
    except asyncio.TimeoutError as exc:
        # 整批超出 deadline → 降级火山。
        log.warning(
            "v3_describe.primary_failover",
            provider=primary_slot.provider,
            reason=type(exc).__name__,
        )
    except ai_client.AIRequestError as exc:
        if not exc.failover_eligible:
            raise VisionError(f"describe-content primary failed: {exc}") from exc
        log.warning(
            "v3_describe.primary_failover",
            provider=primary_slot.provider,
            reason=exc.kind or type(exc).__name__,
        )
    # VisionError(无法解析 / 不可用的响应)【不是】传输失败;它向外传播,而不是把第二个
    # provider 浪费在同一类畸形输出的 bug 上。

    # --- FAILOVER:火山 doubao (ARK) -----------------------------------------
    try:
        fallback_slot = ark_vision_slot(settings)
    except VisionSlotError as exc:
        raise VisionError(
            f"describe-content failover unavailable (火山 slot): {exc}"
        ) from exc

    log.info(
        "v3_describe.failover.start",
        provider=fallback_slot.provider,
        model=fallback_slot.model,
        photo_count=photo_count,
    )
    # failover 调用受 ark slot 自己的逐次调用超时约束(ark_timeout_seconds + ai_client 的
    # 一次重试);整个 analyze 作业则受 background_task_timeout_seconds 封顶。我们刻意【不】
    # 把它也包进主 provider 那更紧的 `describe_batch_deadline_seconds` 预算 —— 那个 deadline
    # 存在的意义是把慢但健康的 GPT 翻向火山,而非过早切断火山(火山自己的逐次调用上限是更大的
    # ark 预算)。
    try:
        tree, tokens, routes = await _describe_on_slot(
            fallback_slot, photos, language, prompt_hint, settings=settings
        )
    except ai_client.AIRequestError as exc:
        raise VisionError(f"describe-content火山 failover failed: {exc}") from exc

    log.info(
        "v3_describe.failover.ok",
        provider=fallback_slot.provider,
        model=fallback_slot.model,
        chapters=len(tree.chapters),
        routes=routes,
    )
    # call_count = 主 provider 的尝试(1)+ failover slot 的真实路数,使 Usage 既反映
    # failover 发生过,也反映是多少次并发调用产出了它。
    return V3DescribeResult(
        tree=tree,
        tokens_billed=tokens,
        model=fallback_slot.model,
        provider=fallback_slot.provider,
        call_count=1 + routes,
    )
