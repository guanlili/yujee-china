"""WP-C (#232): cluster-aware concurrent describe — partition / schedule / merge.

These tests cover the four new layers added on top of the existing single-batch
describe pipeline:
  * clustering (partition by clusterId, sequence by takenAt),
  * scheduling (count-driven concurrency width, whole-cluster bin-pack),
  * merge (global cluster order, ch_N renumber, full coverage),
  * backward compatibility (all clusterId null → legacy single-batch behavior),
  * cluster-boundary prompt injection in the SIMPLE-id space,
  * omitted-photo retry net still firing per concurrent route,
  * deadline/failover interaction (one slow route → single batch failover).
"""

import asyncio
import json
from typing import Any

import pytest

from src.schemas import V3AnalyzePhoto, V3Chapter, V3ChapterPhoto, V3LayoutTree
from src import ai_client
from src.agents.image_understanding import handler as vision


@pytest.fixture
def _describe_env(monkeypatch):
    """Both slots keyed; primary forced to OpenAI (GPT-5.5 Mini) for determinism
    so route/merge assertions don't depend on the ark-default provider pick."""
    monkeypatch.setenv("AGENT_PIPELINE_MODE", "real")
    monkeypatch.setenv("VISION_PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_VISION_MODEL", "gpt-4o-mini")
    monkeypatch.setenv("OPENAI_API_KEY", "fake_oai")
    monkeypatch.setenv("ARK_API_KEY", "fake_ark")
    from src import settings as s

    s.reset_settings_cache()
    yield
    s.reset_settings_cache()


def _photo(idx: int, cluster: str | None, taken: str | None) -> V3AnalyzePhoto:
    exif = {"takenAt": taken} if taken else {}
    return V3AnalyzePhoto(
        photoId=f"p{idx}",
        base64="data:image/jpeg;base64,AA==",
        width=800,
        height=600,
        clusterId=cluster,
        exif=exif,
    )


def _photos(specs: list[tuple[str | None, str | None]]) -> list[V3AnalyzePhoto]:
    return [_photo(i + 1, c, t) for i, (c, t) in enumerate(specs)]


# ---------------------------------------------------------------------------
# Layer 1 · clustering (partition + sequence by takenAt)
# ---------------------------------------------------------------------------


def test_partition_groups_by_cluster_and_sequences_by_takenat():
    # c2 photos are earliest → c2 cluster must come first; input order kept inside.
    photos = _photos(
        [
            ("c1", "2024-03-02T09:00:00"),
            ("c2", "2024-03-01T08:00:00"),
            ("c1", "2024-03-02T10:00:00"),
            ("c2", "2024-03-01T07:00:00"),
        ]
    )
    clusters = vision._partition_into_clusters(photos)
    ids = [[p.photoId for p in c] for c in clusters]
    assert ids == [["p2", "p4"], ["p1", "p3"]]  # c2 (earliest 07:00) before c1


def test_partition_missing_takenat_falls_back_to_appearance_order():
    photos = _photos([("c1", None), ("c2", None)])
    clusters = vision._partition_into_clusters(photos)
    assert [[p.photoId for p in c] for c in clusters] == [["p1"], ["p2"]]


def test_partition_null_cluster_photos_are_singletons_not_merged():
    # All-null → every photo its own singleton "cluster" (model free to group).
    photos = _photos([(None, "2024-03-01T08:00:00"), (None, "2024-03-01T09:00:00")])
    clusters = vision._partition_into_clusters(photos)
    assert [[p.photoId for p in c] for c in clusters] == [["p1"], ["p2"]]


# ---------------------------------------------------------------------------
# Layer 2 · scheduling (count-driven width + whole-cluster bin-pack)
# ---------------------------------------------------------------------------


def _settings():
    from src.settings import get_settings

    return get_settings()


def test_route_count_thresholds(_describe_env):
    s = _settings()
    assert vision._route_count_for(20, s) == 1  # ≤20 → single route
    assert vision._route_count_for(21, s) == 2  # >20 → two routes
    assert vision._route_count_for(40, s) == 2
    assert vision._route_count_for(41, s) == 3  # >40 → three routes


def test_schedule_packs_whole_clusters_balanced_never_splitting():
    # 4 clusters of sizes 10/6/3/2 → 2 routes. Greedy lightest-first bin-pack:
    # 10→r0; 6→r1; 3→r1(9); 2→r1(11). Assert no cluster is split and the two
    # routes are balanced within one cluster's granularity.
    clusters = [
        [
            _photo(idx, f"c{ci}", "2024-03-01T08:00:00")
            for idx in range(ci * 100, ci * 100 + size)
        ]
        for ci, size in [(1, 10), (2, 6), (3, 3), (4, 2)]
    ]
    routes = vision._plan_describe_routes(clusters, 2)
    assert len(routes) == 2
    # No cluster split: every cluster's photos all land in exactly one route.
    for cluster in clusters:
        cluster_ids = {p.photoId for p in cluster}
        landed = [
            ri for ri, route in enumerate(routes)
            if cluster_ids & {p.photoId for p in route}
        ]
        assert len(landed) == 1, f"cluster split across routes: {landed}"
    # Balanced: the two routes differ by no more than the largest single cluster.
    sizes = sorted(len(r) for r in routes)
    assert sizes[1] - sizes[0] <= 10


def test_schedule_single_route_flattens_all():
    clusters = [_photos([("c1", "2024-03-01T08:00:00")]), _photos([("c2", "2024-03-01T08:00:00")])]
    routes = vision._plan_describe_routes(clusters, 1)
    assert len(routes) == 1
    assert len(routes[0]) == 2


# ---------------------------------------------------------------------------
# Layer 3 · merge (global order + ch renumber + coverage + token sum)
# ---------------------------------------------------------------------------


def _chapter(desc: str, photo_ids: list[str]) -> V3Chapter:
    return V3Chapter(
        chapterId="ch_local",
        description=desc,
        accentColor=None,
        artFont=None,
        photos=[
            V3ChapterPhoto(
                photoId=pid,
                sceneDescription=f"scene {pid}",
                width=800,
                height=600,
                orientation="landscape",
                takenAt=None,
            )
            for pid in photo_ids
        ],
    )


def test_merge_orders_by_sequenced_cluster_position_and_renumbers():
    # `sequenced_photos` is already in global cluster order p1..p4; route B (p3,p4)
    # comes BEFORE route A (p1,p2) in the trees list — merge must still emit
    # chapters in sequenced order and renumber ch_1..N.
    sequenced = _photos(
        [("cA", "2024-03-01T08:00:00"), ("cA", "2024-03-01T08:00:00"), ("cB", "2024-03-01T08:00:00"), ("cB", "2024-03-01T08:00:00")]
    )
    route_a = V3LayoutTree(chapters=[_chapter("A.", ["p1", "p2"])])
    route_b = V3LayoutTree(chapters=[_chapter("B.", ["p3", "p4"])])
    merged = vision._merge_route_trees(sequenced, [route_b, route_a])
    assert [c.chapterId for c in merged.chapters] == ["ch_1", "ch_2"]
    assert [[p.photoId for p in c.photos] for c in merged.chapters] == [
        ["p1", "p2"],
        ["p3", "p4"],
    ]
    assert [c.description for c in merged.chapters] == ["A.", "B."]


def test_merge_keeps_sub_chaptered_cluster_contiguous():
    # One cluster (cA: p1,p2,p3) sub-chaptered into 2 chapters within route A;
    # cB (p4) is a later cluster in route B. Merge must keep cA's sub-chapters
    # contiguous and before cB — never interleave.
    sequenced = _photos(
        [
            ("cA", "2024-03-01T08:00:00"),
            ("cA", "2024-03-01T08:10:00"),
            ("cA", "2024-03-01T08:20:00"),
            ("cB", "2024-03-02T08:00:00"),
        ]
    )
    route_a = V3LayoutTree(
        chapters=[_chapter("A1.", ["p1", "p2"]), _chapter("A2.", ["p3"])]
    )
    route_b = V3LayoutTree(chapters=[_chapter("B.", ["p4"])])
    merged = vision._merge_route_trees(sequenced, [route_b, route_a])
    assert [[p.photoId for p in c.photos] for c in merged.chapters] == [
        ["p1", "p2"],
        ["p3"],
        ["p4"],
    ]
    assert [c.description for c in merged.chapters] == ["A1.", "A2.", "B."]


def test_merge_rejects_omitted_photo():
    photos = _photos([("cA", "2024-03-01T08:00:00"), ("cA", "2024-03-01T08:00:00"), ("cB", "2024-03-01T08:00:00")])
    route_a = V3LayoutTree(chapters=[_chapter("A.", ["p1", "p2"])])
    with pytest.raises(vision.VisionError, match="merge omitted photoIds"):
        vision._merge_route_trees(photos, [route_a])


def test_merge_rejects_duplicate_photo_across_routes():
    photos = _photos([("cA", "2024-03-01T08:00:00"), ("cB", "2024-03-01T08:00:00")])
    route_a = V3LayoutTree(chapters=[_chapter("A.", ["p1"])])
    route_b = V3LayoutTree(chapters=[_chapter("B.", ["p1", "p2"])])  # p1 dup
    with pytest.raises(vision.VisionError, match="merge duplicated photoId"):
        vision._merge_route_trees(photos, [route_a, route_b])


def test_merge_rejects_two_clusters_merged_into_one_chapter():
    # 异簇不并章: a single chapter holding photos from cA AND cB is a boundary
    # violation, rejected deterministically even if the model produced it.
    photos = _photos([("cA", "2024-03-01T08:00:00"), ("cB", "2024-03-02T08:00:00")])
    bad = V3LayoutTree(chapters=[_chapter("merged.", ["p1", "p2"])])
    with pytest.raises(vision.VisionError, match="mixed distinct clusters"):
        vision._merge_route_trees(photos, [bad])


def test_merge_allows_null_cluster_photos_in_one_chapter():
    # Null-cluster photos carry no boundary constraint → may share a chapter.
    photos = _photos([(None, "2024-03-01T08:00:00"), (None, "2024-03-02T08:00:00")])
    ok = V3LayoutTree(chapters=[_chapter("free.", ["p1", "p2"])])
    merged = vision._merge_route_trees(photos, [ok])
    assert [[p.photoId for p in c.photos] for c in merged.chapters] == [["p1", "p2"]]


# ---------------------------------------------------------------------------
# Prompt: cluster labels injected in the SIMPLE-id space
# ---------------------------------------------------------------------------


def test_prompt_injects_cluster_labels_relabeled_locally():
    photos = _photos([("clusterX", "2024-03-01T08:00:00"), ("clusterY", None)])
    parts = vision._build_v3_user_content(photos, None)
    text = parts[0]["text"]
    # Clusters re-labeled to dense local c1/c2 (opaque ids never leak to model).
    assert "cluster=c1" in text and "cluster=c2" in text
    assert "clusterX" not in text and "clusterY" not in text
    # cluster 规则已外置并中文化(prompts/rules/cluster_grouping.md)。
    assert "必须】待在一起" in text
    assert "绝不】合并进同一个章节" in text


def test_prompt_no_cluster_block_when_all_null():
    photos = _photos([(None, "2024-03-01T08:00:00"), (None, None)])
    parts = vision._build_v3_user_content(photos, None)
    text = parts[0]["text"]
    assert "cluster=" not in text
    assert "预分组" not in text


def test_prompt_never_leaks_gps_even_with_clusters():
    photos = _photos([("c1", "2024-03-01T08:00:00")])
    text = vision._build_v3_user_content(photos, None)[0]["text"].lower()
    for banned in ("lat", "lng", "latitude", "longitude", "gps", "coordinate", "place="):
        assert banned not in text, banned


# ---------------------------------------------------------------------------
# End-to-end: concurrency, backward compat, retry net per route
# ---------------------------------------------------------------------------


def _completion(content: Any) -> dict[str, Any]:
    return {
        "choices": [{"message": {"content": json.dumps(content)}}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 5},
    }


def _one_chapter_for(simple_ids: list[str]) -> dict[str, Any]:
    """A valid single-chapter reply covering exactly the given SIMPLE ids (used
    only where the route holds a single cluster / all-null free grouping)."""
    return {
        "chapters": [
            {
                "description": "A moment.",
                "photoIds": list(simple_ids),
                "scenes": {sid: f"scene {sid}" for sid in simple_ids},
            }
        ]
    }


def _manifest_ids(manifest: str) -> list[str]:
    return [
        line.split("photoId=")[1].split(" ")[0]
        for line in manifest.splitlines()
        if "photoId=" in line
    ]


def _cluster_respecting_reply(manifest: str) -> dict[str, Any]:
    """Parse the route manifest and emit ONE chapter per `cluster=` tag (untagged
    ids each get their own chapter) — i.e. a well-behaved model that honors the
    cluster boundary. Keeps manifest order so merge ordering is testable."""
    groups: list[tuple[str | None, list[str]]] = []
    by_cluster: dict[str, list[str]] = {}
    for line in manifest.splitlines():
        if "photoId=" not in line:
            continue
        sid = line.split("photoId=")[1].split(" ")[0]
        cluster = None
        if "cluster=" in line:
            cluster = line.split("cluster=")[1].split(" ")[0].strip()
        if cluster is None:
            groups.append((None, [sid]))
        elif cluster in by_cluster:
            by_cluster[cluster].append(sid)
        else:
            by_cluster[cluster] = [sid]
            groups.append((cluster, by_cluster[cluster]))
    return {
        "chapters": [
            {
                "description": f"Chapter for {label or 'solo'}.",
                "photoIds": ids,
                "scenes": {sid: f"scene {sid}" for sid in ids},
            }
            for label, ids in groups
        ]
    }


def test_concurrent_routes_for_more_than_20_photos_merge_and_sum_tokens(
    _describe_env, monkeypatch
):
    # 24 photos across 4 clusters (6 each) → >20 → 2 concurrent routes.
    specs: list[tuple[str | None, str | None]] = []
    for ci in range(4):
        for k in range(6):
            specs.append((f"c{ci}", f"2024-03-0{ci + 1}T08:0{k}:00"))
    photos = _photos(specs)

    call_log: list[int] = []

    async def fake_completion(**kwargs):
        # Each route sees its own simple-id space (1..N for that route's slice);
        # a well-behaved model emits one chapter per cluster (boundary honored).
        manifest = kwargs["messages"][1]["content"][0]["text"]
        call_log.append(len(_manifest_ids(manifest)))
        return _completion(_cluster_respecting_reply(manifest))

    monkeypatch.setattr(ai_client, "chat_completion", fake_completion)

    result = asyncio.run(vision.describe_content(photos, language="en"))

    assert result.call_count == 2  # two concurrent routes
    assert sorted(call_log) == [12, 12]  # whole clusters, balanced 12/12
    # tokens summed across routes: 2 routes × (10+5) = 30
    assert result.tokens_billed == 30
    # Full coverage, chapters renumbered ch_1..N globally.
    covered = [p.photoId for c in result.tree.chapters for p in c.photos]
    assert sorted(covered) == sorted(p.photoId for p in photos)
    assert [c.chapterId for c in result.tree.chapters] == [
        f"ch_{i + 1}" for i in range(len(result.tree.chapters))
    ]


def test_concurrent_merge_respects_takenat_order_over_input_order(
    _describe_env, monkeypatch
):
    # Two clusters whose INPUT order (cEarly appears 2nd) disagrees with their
    # takenAt order (cEarly is chronologically first). With >20 photos they land
    # in separate routes; the merge must order chapters by takenAt (cEarly first),
    # NOT by raw request order. Regression guard for the merge-ordering bug.
    specs: list[tuple[str | None, str | None]] = []
    # cLate first in input but LATER in time (March).
    for k in range(12):
        specs.append(("cLate", f"2024-03-15T08:{k:02d}:00"))
    # cEarly second in input but EARLIER in time (January).
    for k in range(12):
        specs.append(("cEarly", f"2024-01-05T08:{k:02d}:00"))
    photos = _photos(specs)

    async def fake_completion(**kwargs):
        manifest = kwargs["messages"][1]["content"][0]["text"]
        return _completion(_cluster_respecting_reply(manifest))

    monkeypatch.setattr(ai_client, "chat_completion", fake_completion)
    result = asyncio.run(vision.describe_content(photos, language="en"))

    # First chapter must hold the chronologically-earliest cluster (cEarly = p13..).
    first_chapter_ids = [p.photoId for p in result.tree.chapters[0].photos]
    early_ids = {f"p{i}" for i in range(13, 25)}
    assert set(first_chapter_ids) <= early_ids, (
        "merge must emit the earliest-takenAt cluster first, not input-order first"
    )


def test_all_null_clusters_take_legacy_single_batch_path(_describe_env, monkeypatch):
    # Backward compat: ≤20 photos with every clusterId null → exactly the legacy
    # single-batch path (one call, no cluster block in the prompt, model groups
    # freely). 10 null photos exercise it.
    photos = _photos([(None, f"2024-03-01T08:{k:02d}:00") for k in range(10)])
    calls: list[int] = []

    async def fake_completion(**kwargs):
        manifest = kwargs["messages"][1]["content"][0]["text"]
        calls.append(1)
        # No cluster block when all null.
        assert "预分组" not in manifest
        ids = [
            line.split("photoId=")[1].split(" ")[0]
            for line in manifest.splitlines()
            if "photoId=" in line
        ]
        return _completion(_one_chapter_for(ids))

    monkeypatch.setattr(ai_client, "chat_completion", fake_completion)

    result = asyncio.run(vision.describe_content(photos, language="en"))
    assert len(calls) == 1  # ≤20 → single legacy batch
    assert result.call_count == 1
    covered = [p.photoId for c in result.tree.chapters for p in c.photos]
    assert sorted(covered) == sorted(p.photoId for p in photos)


def test_retry_net_fires_per_route_on_omitted_photo(_describe_env, monkeypatch):
    # 24 photos → 2 routes. One route omits a photo on its first attempt; the
    # per-route retry net must recover it (route-local), not fail the whole batch.
    specs = [(f"c{i // 6}", f"2024-03-0{i // 6 + 1}T08:0{i % 6}:00") for i in range(24)]
    photos = _photos(specs)
    seen_routes: dict[str, int] = {}

    async def fake_completion(**kwargs):
        manifest = kwargs["messages"][1]["content"][0]["text"]
        ids = _manifest_ids(manifest)
        reply = _cluster_respecting_reply(manifest)
        # On the FIRST visit to the route whose simple-id space includes "12",
        # drop that id from its chapter to trigger the route-local retry net.
        route_sig = ",".join(ids)
        seen = seen_routes.get(route_sig, 0)
        seen_routes[route_sig] = seen + 1
        if seen == 0 and "12" in ids:
            for ch in reply["chapters"]:
                if "12" in ch["photoIds"]:
                    ch["photoIds"].remove("12")
                    ch["scenes"].pop("12", None)
        return _completion(reply)

    monkeypatch.setattr(ai_client, "chat_completion", fake_completion)

    result = asyncio.run(vision.describe_content(photos, language="en"))
    covered = [p.photoId for c in result.tree.chapters for p in c.photos]
    assert sorted(covered) == sorted(p.photoId for p in photos)  # retry recovered it


def test_one_slow_route_trips_single_batch_failover(_describe_env, monkeypatch):
    # >20 photos → 2 concurrent primary routes. One route hangs past the batch
    # deadline → the WHOLE batch fails over to 火山 ONCE (not per-route).
    monkeypatch.setenv("DESCRIBE_BATCH_DEADLINE_SECONDS", "1")
    from src import settings as s

    s.reset_settings_cache()

    specs = [(f"c{i // 6}", f"2024-03-0{i // 6 + 1}T08:0{i % 6}:00") for i in range(24)]
    photos = _photos(specs)
    models: list[str] = []

    async def fake_completion(**kwargs):
        model = kwargs["model"]
        models.append(model)
        manifest = kwargs["messages"][1]["content"][0]["text"]
        ids = _manifest_ids(manifest)
        if model == "gpt-5.5-mini" and "12" in ids:
            await asyncio.sleep(5)  # one primary route hangs → batch deadline trips
        return _completion(_cluster_respecting_reply(manifest))

    monkeypatch.setattr(ai_client, "chat_completion", fake_completion)

    result = asyncio.run(vision.describe_content(photos, language="en"))
    assert result.provider == "ark"  # failed over
    # Failover ran on the ark slot for the whole batch (2 routes).
    ark_calls = [m for m in models if m == "doubao-seed-1-6-vision-250815"]
    assert len(ark_calls) == 2
    covered = [p.photoId for c in result.tree.chapters for p in c.photos]
    assert sorted(covered) == sorted(p.photoId for p in photos)
