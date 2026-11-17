# 照片视觉档案 + Agent 图片处理三能力 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Design Agent 能管整本调色（LUT）、构图裁切（imagePos）、抠图三件事 —— 靠给它补一层它现在完全没有的输入：照片视觉档案。

**Architecture:** 三组档案字段（几何/色彩/语义）在 analyze 阶段一次算完，存 `album_photos.profile` jsonb。engine 侧新增推理 endpoint，web 侧落库并提供跨存储写入 seam，design-agent 侧加 4 个工具读写。契约先锁死（Task 0），之后 A/B/C 三线在同一工作区并行（文件不重叠），最后汇合验收。

**Tech Stack:** Python 3.14 / FastAPI / Pillow / u2netp + isnet-general-use（engine，均 Apache-2.0）；TypeScript / Next.js / drizzle / zod（web）；TypeScript / typebox / `tsx --test`（design-agent）

**Spec:** `docs/superpowers/specs/2026-09-09-photo-agent-profile-design.md`

## Global Constraints

以下约束对每个任务都生效，值一律照抄，不要自行发挥：

- **隐私红线**：档案里不得出现任何 location / place / GPS / lat / lng / coordinate 字段或其语义等价物，`description` 文本里也不许写具体地名。engine 侧 `_V3Strict` 在 parse 期拒这类 key，新契约必须保持同等强度并有测试断言。
- **坐标口径**：`subjectBox` / `faceBoxes` 一律 **0-100 百分比**，与 `imagePos` 的 objectPosition 同口径。禁止用 [0,1]。
- **cutouts 铁律**：`PhotoFilterState.cutouts` 只认 `true`，关掉是**删键**，绝不写 `false`（`apps/web/src/lib/photo/filter-state.ts` 有完整注释说明为什么）。
- **strength 归一化**：滤镜 strength 一律过 `quantizeStrength`（5 的倍数），沿用现有函数，不要新写。
- **renderVersion 不许升版本号**：`effectiveRenderVersion` 的版本串规则不动，新增维度只能追加尾段 —— 升版本会让所有存量分享快照一次性失配。
- **dev 库账本漂移**：`pnpm db:migrate` 在本地**必失败**，新迁移要手工应用。别在这上面 debug。
- **验证 web 要进 `apps/web` 跑**：仓根 `pnpm test` 会倒在 design-agent 的环境上，不是你的代码坏了。
- **用户口径页码**：工具入参的 pageNo 是用户画面上看到的页码（内页数字 1 起，封面/目录/封尾用 `"cover"`/`"toc"`/`"ending"`），换算必须走 `resolveRefToInternal`，且凡把数组位置换算成用户口径的地方**必须传 isSpread**（双宽页占两个号，漏传会比画布少号）。
- **提交署名**：每个 commit 末尾加 `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

## 任务依赖图

```
Task 0（契约，串行头，必须最先完成）
   ├── A 线：A0 → A1 → A2 → A3 → A4 → A5     （engine，Python）
   ├── B 线：B1 → B2 → B3 → B4               （web 服务层，TS）
   └── C 线：C1 → C2 → C3 → C4 → C5          （design-agent，TS）
                    ↓
              Task Z1（汇合验收）
```

三条线文件不重叠，**在同一个主工作区并行**，各改各的目录，直接提交到 main。

⚠️ **不开 worktree**：worktree 是干净 checkout，`engine/.venv` 和 `node_modules`
都不在里面，重装依赖的时间比省下的隔离价值大。代价是 **`git add` 必须写精确路径** ——
工作区里长期有别的项目的未跟踪文件和几个本来就脏的文件（`apps/web/package.json`、
`pnpm-lock.yaml`），`git add -A` 会误伤。

---

## Task 0：锁死 PhotoProfile 契约

**这是并行的前提，必须最先完成并合回 main，A/B/C 三线都从它拉分支。**

**Files:**
- Create: `packages/contracts/src/photo-profile.ts`
- Create: `packages/contracts/src/photo-profile.test.ts`
- Modify: `packages/contracts/src/index.ts`（导出新模块）
- Create: `engine/src/contracts/photo_profile.py`（pydantic 镜像）
- Create: `engine/tests/test_photo_profile_schema.py`

**Interfaces:**
- Produces: `PhotoProfileSchema` / `PhotoProfile`（zod，TS 侧）、`PhotoProfile`（pydantic，Python 侧）、`PHOTO_PROFILE_VERSION = 1`

- [ ] **Step 1: 写 TS 侧契约的失败测试**

```ts
// packages/contracts/src/photo-profile.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PhotoProfileSchema, PHOTO_PROFILE_VERSION } from './photo-profile.ts';

const valid = {
  v: 1,
  subjectBox: { x: 20, y: 10, w: 55, h: 70 },
  faceBoxes: [{ x: 30, y: 15, w: 20, h: 25 }],
  maskKey: null,
  colorTemp: 'warm',
  brightness: 'mid',
  saturation: 'normal',
  dominantColors: ['#C8A05A', '#2E3B4E'],
  composition: 'focal',
  scene: 'outdoor',
  peopleCount: '1',
  mood: 'warm',
  description: '傍晚海边，一个人背对镜头站在礁石上',
};

test('接受合法档案', () => {
  assert.equal(PhotoProfileSchema.parse(valid).v, PHOTO_PROFILE_VERSION);
});

test('坐标是 0-100 口径，超过 100 要拒', () => {
  assert.throws(() =>
    PhotoProfileSchema.parse({ ...valid, subjectBox: { x: 0.2, y: 0.1, w: 1.5, h: 0.7 } }),
  );
});

test('subjectBox 可以是 null（纯风景没有主体）', () => {
  assert.equal(PhotoProfileSchema.parse({ ...valid, subjectBox: null }).subjectBox, null);
});

// 隐私红线：schema 必须 strict，任何位置信息字段都要在 parse 期被拒
for (const key of ['location', 'place', 'gps', 'lat', 'lng', 'latitude', 'longitude', 'coordinate', 'coordinates']) {
  test(`拒绝位置信息字段 ${key}`, () => {
    assert.throws(
      () => PhotoProfileSchema.parse({ ...valid, [key]: 'anything' }),
      new RegExp('Unrecognized|unrecognized'),
      `${key} 必须在 parse 期被拒 —— 隐私红线`,
    );
  });
}

test('dominantColors 最多 3 个且必须是 6 位 hex', () => {
  assert.throws(() => PhotoProfileSchema.parse({ ...valid, dominantColors: ['#FFF'] }));
  assert.throws(() =>
    PhotoProfileSchema.parse({ ...valid, dominantColors: ['#112233', '#445566', '#778899', '#AABBCC'] }),
  );
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/contracts && npx tsx --test src/photo-profile.test.ts`
Expected: FAIL —— `Cannot find module './photo-profile.ts'`

- [ ] **Step 3: 写契约实现**

```ts
// packages/contracts/src/photo-profile.ts
import { z } from 'zod';

export const PHOTO_PROFILE_VERSION = 1 as const;

// ⚠️ 坐标系一律 0-100 百分比，与 imagePos 的 objectPosition 同口径。
// 别用 [0,1] —— 两套坐标系并存必然出现 Agent 心算换算错误。
const Box = z.object({
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  w: z.number().min(0).max(100),
  h: z.number().min(0).max(100),
}).strict();

export type PhotoBox = z.infer<typeof Box>;

/**
 * 照片视觉档案。存 `album_photos.profile` jsonb。
 *
 * ⚠️ 隐私红线（继承 v3-requirements §3）：本 schema **不得**新增任何
 * location / place / GPS / lat / lng / coordinate 字段。`.strict()` 是这条
 * 红线的执行机制，改成 passthrough 等于拆掉红线。
 */
export const PhotoProfileSchema = z.object({
  v: z.literal(PHOTO_PROFILE_VERSION),

  // ── 几何组（分割 mask 派生，确定性）──────────────────────────
  /** 主体包围盒。null = 没跑出主体（纯风景/抽象构图），此时 imagePos 走默认 50/50/1。 */
  subjectBox: Box.nullable(),
  /** 人脸框（0..n 个）。给 imagePos 的「别切脸」当硬约束。 */
  faceBoxes: z.array(Box).default([]),
  /**
   * alpha mask 的 R2 key。**默认 null** —— 建档时只取 mask 的包围盒，mask 本身
   * 丢弃不存：绝大多数照片不会被抠，一本 100 张的书预存 mask 是 5-20MB 净浪费。
   * 真要抠图时按需跑第二次推理并回填。
   */
  maskKey: z.string().nullable().default(null),

  // ── 色彩组（纯像素算法，不用模型）────────────────────────────
  colorTemp: z.enum(['warm', 'neutral', 'cool']),
  brightness: z.enum(['dark', 'mid', 'bright']),
  saturation: z.enum(['muted', 'normal', 'vivid']),
  /** 主色调，最多 3 个 6 位 hex。给 LUT 选择和配色协调用。 */
  dominantColors: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).max(3),

  // ── 语义组（豆包 vision，一次调用出全部）────────────────────
  /** 回填 V3ChapterPhoto.composition —— 这个字段现在恒 None，导致槽位构图约束失效。 */
  composition: z.enum(['closeup', 'focal', 'wide']),
  scene: z.enum(['indoor', 'outdoor', 'nature', 'city', 'interior']),
  peopleCount: z.enum(['0', '1', '2-3', '4+']),
  mood: z.enum(['warm', 'cool', 'sentimental', 'energetic', 'quiet']),
  /** 回填 V3ChapterPhoto.sceneDescription —— 这个字段现在恒空。不许写具体地名。 */
  description: z.string().max(300),
}).strict();

export type PhotoProfile = z.infer<typeof PhotoProfileSchema>;
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/contracts && npx tsx --test src/photo-profile.test.ts`
Expected: PASS，全部用例绿

- [ ] **Step 5: 从 contracts 的 index 导出**

在 `packages/contracts/src/index.ts` 追加（照抄该文件已有的导出写法）：

```ts
export * from './photo-profile.ts';
```

- [ ] **Step 6: 写 Python 侧镜像的失败测试**

```python
# engine/tests/test_photo_profile_schema.py
import pytest
from pydantic import ValidationError

from src.contracts.photo_profile import PhotoProfile

VALID = {
    "v": 1,
    "subjectBox": {"x": 20, "y": 10, "w": 55, "h": 70},
    "faceBoxes": [{"x": 30, "y": 15, "w": 20, "h": 25}],
    "maskKey": None,
    "colorTemp": "warm",
    "brightness": "mid",
    "saturation": "normal",
    "dominantColors": ["#C8A05A", "#2E3B4E"],
    "composition": "focal",
    "scene": "outdoor",
    "peopleCount": "1",
    "mood": "warm",
    "description": "傍晚海边，一个人背对镜头站在礁石上",
}


def test_accepts_valid_profile():
    assert PhotoProfile.model_validate(VALID).v == 1


def test_rejects_out_of_range_box():
    bad = {**VALID, "subjectBox": {"x": 0.2, "y": 0.1, "w": 1.5, "h": 0.7}}
    # w/h 在 0-100 口径下 1.5 是合法数值,这里改用真正越界的值
    bad["subjectBox"]["w"] = 150
    with pytest.raises(ValidationError):
        PhotoProfile.model_validate(bad)


def test_subject_box_nullable():
    assert PhotoProfile.model_validate({**VALID, "subjectBox": None}).subjectBox is None


@pytest.mark.parametrize(
    "key",
    ["location", "place", "gps", "lat", "lng", "latitude", "longitude", "coordinate", "coordinates"],
)
def test_privacy_redline_rejects_location_keys(key):
    """隐私红线:任何位置信息字段都必须在 parse 期被拒。"""
    with pytest.raises(ValidationError):
        PhotoProfile.model_validate({**VALID, key: "anything"})
```

- [ ] **Step 7: 运行确认失败**

Run: `cd engine && .venv/bin/python -m pytest tests/test_photo_profile_schema.py -v`
Expected: FAIL —— `ModuleNotFoundError: src.contracts.photo_profile`

- [ ] **Step 8: 写 Python 镜像**

```python
# engine/src/contracts/photo_profile.py
"""照片视觉档案(PhotoProfile)的 pydantic 镜像。

TS 侧真相源:packages/contracts/src/photo-profile.ts —— 两边字段必须逐字对应。

⚠️ 隐私红线(v3-requirements §3):本 schema **不得**新增任何 location/place/
GPS/lat/lng/coordinate 字段。`extra="forbid"` 是这条红线的执行机制。
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

PHOTO_PROFILE_VERSION = 1

HexColor = Annotated[str, Field(pattern=r"^#[0-9a-fA-F]{6}$")]
Pct = Annotated[float, Field(ge=0, le=100)]


class PhotoBox(BaseModel):
    """坐标系 0-100 百分比,与 imagePos 的 objectPosition 同口径。"""

    model_config = ConfigDict(extra="forbid")

    x: Pct
    y: Pct
    w: Pct
    h: Pct


class PhotoProfile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    v: Literal[1] = PHOTO_PROFILE_VERSION

    # 几何组
    subjectBox: PhotoBox | None = None
    faceBoxes: list[PhotoBox] = Field(default_factory=list)
    maskKey: str | None = None

    # 色彩组
    colorTemp: Literal["warm", "neutral", "cool"]
    brightness: Literal["dark", "mid", "bright"]
    saturation: Literal["muted", "normal", "vivid"]
    dominantColors: list[HexColor] = Field(max_length=3)

    # 语义组
    composition: Literal["closeup", "focal", "wide"]
    scene: Literal["indoor", "outdoor", "nature", "city", "interior"]
    peopleCount: Literal["0", "1", "2-3", "4+"]
    mood: Literal["warm", "cool", "sentimental", "energetic", "quiet"]
    description: str = Field(max_length=300)
```

- [ ] **Step 9: 运行确认通过**

Run: `cd engine && .venv/bin/python -m pytest tests/test_photo_profile_schema.py -v`
Expected: PASS

- [ ] **Step 10: 两侧字段一致性的守卫测试**

契约两侧漂移是这个项目栽过的坑，加一道机械守卫。

```python
# engine/tests/test_photo_profile_schema.py 末尾追加
import json
import pathlib
import re


def test_ts_and_python_fields_match():
    """TS 侧字段名与 Python 侧逐一对应 —— 防两边漂移。"""
    ts = pathlib.Path(__file__).resolve().parents[2] / "packages/contracts/src/photo-profile.ts"
    source = ts.read_text(encoding="utf-8")
    # 只取 PhotoProfileSchema 对象体内的顶层字段名
    body = source.split("export const PhotoProfileSchema = z.object({", 1)[1]
    body = body.split("}).strict();", 1)[0]
    ts_fields = set(re.findall(r"^  (\w+):", body, re.MULTILINE))
    py_fields = set(PhotoProfile.model_fields.keys())
    assert ts_fields == py_fields, f"契约漂移:TS 独有={ts_fields - py_fields} Python 独有={py_fields - ts_fields}"
```

Run: `cd engine && .venv/bin/python -m pytest tests/test_photo_profile_schema.py -v`
Expected: PASS（若失败说明两侧字段名真的不一致，改到一致，别改断言）

- [ ] **Step 11: 提交**

```bash
git add packages/contracts/src/photo-profile.ts packages/contracts/src/photo-profile.test.ts \
        packages/contracts/src/index.ts \
        engine/src/contracts/photo_profile.py engine/tests/test_photo_profile_schema.py
git commit -m "$(cat <<'MSG'
feat(contracts): PhotoProfile 照片视觉档案契约(TS + Python 双侧)

几何/色彩/语义三组字段,坐标 0-100 与 imagePos 同口径。隐私红线由
zod .strict() / pydantic extra=forbid 执行,两侧各有位置字段拒收测试,
外加一道字段名一致性守卫防漂移。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

# A 线 —— engine（Python）

**范围:** 只碰 `engine/**`，不碰任何 TS。另两条线在同一个工作区并行，碰它们的目录会撞车。
`git add` 写精确路径，绝不 `git add -A`。

**测试命令:** `cd engine && .venv/bin/python -m pytest tests/<file> -v`

---

## Task A0：查明远程 CLIP 在生产是通是断（spike，不走 TDD）

> **✅ 2026-09-09 已查完，结论与下面的前提相反 —— 别再照着下面的 Expected 走。**
>
> - **endpoint 在生产是通的**：不带鉴权打回 **401**（不是 404），带上
>   `GROUPING_CLIP_SECRET` 打回 **200 + 合法 embeddings**，形状正是调用方读的
>   `body["data"]["embeddings"]`。对照组：真不存在的路径回 404 +
>   `AGENT_INTERNAL_ERROR`。**analyze 今天没坏。**
> - **真实情况是源码落后于生产**，而且那个生产镜像**在本仓历史里复现不出来**
>   （它同时满足「有 open-clip + 有 agent-ack + 没有 judge-layout」，任何一个
>   commit 都不是这个组合）。最可能是当年有人在本地工作树手加了路由直接 deploy，
>   没提交。
> - 路由是 `0cfc019d`（2026-07-06「瘦身到最小版」）从源码删掉的，而
>   `features.py` 一直在调它。
> - **所以风险方向是反的**：不是「现在坏了要修」，是**哑雷** —— 谁下次拿当前源码
>   重新 `fly deploy -c engine/fly.clip.toml`，analyze 就当场 404。
> - 触发门槛极低：`clipMinPhotos = 3` / `subsplitMin = 3`
>   （`chaptering/schema.py:36-37`），任一时间/GPS 单元 ≥3 张就走视觉子分组，
>   几乎每本书都会走到。
> - 计划漏了一环：`engine/tests/test_v3_route_surface.py` 当时**主动断言这个路由
>   必须不存在** —— 正是它给误删盖了章。A1 必须同时把那条守卫反过来。
>
> A1 已按此执行（commit `3aa9f113`），并把 `/internal/agent-ack` 的同类漂移单独记账。

这个任务的产出是**一个结论**，不是代码。它决定 A1 是「修生产 bug」还是「加新功能」。

背景事实（已查证，不用重查）：

- 主 engine `yujee-agent` 配了 `GROUPING_CLIP_BASE_URL = "https://yujee-agent-clip.fly.dev"`（`engine/fly.toml`）
- 所以分簇走 `_remote_clip_embeddings`，去 POST `{base}/internal/open-clip/embeddings`（`engine/src/workflows/core/chaptering/features.py:105`）
- **这个路由在 `engine/src/api/routes.py` 里不存在** —— 只有 `/health` 和三个 `/v3/*`
- `require_clip_bearer`（`engine/src/api/auth.py:11`）和 `agent_enable_clip_embeddings`（`engine/src/settings.py:37`）都定义了，但**后者全仓没有任何地方读它**
- `grouping.py:301` 的 `emb_future.result()` **没有 try/except**，远程失败会直接把 analyze 打挂

- [ ] **Step 1: 确认路由确实缺失**

```bash
cd engine && grep -rn "open-clip\|open_clip" src/api/ ; echo "exit=$?"
```
Expected: 无输出（确认路由不存在）。若有输出说明前提变了，停下来汇报。

- [ ] **Step 2: 打生产 CLIP worker 的健康检查**

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://yujee-agent-clip.fly.dev/health
```
Expected: `200`（机器活着，`min_machines_running=0` 会自动唤醒，首次可能慢几秒）

- [ ] **Step 3: 打那个不存在的 endpoint，确认 404**

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -X POST \
  https://yujee-agent-clip.fly.dev/internal/open-clip/embeddings \
  -H 'Content-Type: application/json' -d '{"images":[]}'
```
Expected: `404`（证实调用必失败）。若返回 401 说明路由存在只是鉴权挡了 —— 那前提变了，停下来汇报。

- [ ] **Step 4: 确认触发条件，判断这个 bug 的实际影响面**

```bash
cd engine && grep -rn "clipMinPhotos\|subsplitMin" src/workflows/core/chaptering/ | head
```

读出 `clipMinPhotos` 的默认值，据此判断：多少张照片的书会触发视觉子分组、进而撞上这个 404。把结论写进汇报。

- [ ] **Step 5: 汇报结论，不写代码**

汇报三件事：① endpoint 是否确实缺失；② 生产 404 是否证实；③ 触发阈值是多少、影响多大比例的书。等确认后再进 A1。

---

## Task A1：补 `/internal/open-clip/embeddings` 路由

**Files:**
- Modify: `engine/src/api/routes.py`（末尾追加 internal 路由段）
- Create: `engine/tests/test_internal_clip_route.py`

**Interfaces:**
- Produces: `POST /internal/open-clip/embeddings`，请求体 `{"images": [dataUrl, ...]}`，响应 `{"ok": true, "data": {"embeddings": [[float, ...], ...]}}` —— **响应形状由现有调用方 `features.py:112-119` 决定，不能改**：它读 `body["data"]["embeddings"]`，且长度必须等于请求的图片数。

- [ ] **Step 1: 写失败测试**

```python
# engine/tests/test_internal_clip_route.py
"""/internal/open-clip/embeddings 路由。

这个 endpoint 的调用方(features.py:_remote_clip_embeddings)和鉴权
(auth.require_clip_bearer)早就写好了,只有路由本身缺失,导致主 engine 调它必 404。
响应形状由调用方决定,不能改。
"""

import base64
import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from src.main import app
from src.settings import get_settings


def _data_url() -> str:
    buf = io.BytesIO()
    Image.new("RGB", (8, 8), (120, 90, 60)).save(buf, format="JPEG")
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


@pytest.fixture(autouse=True)
def _reset_settings():
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_disabled_by_default_returns_404(monkeypatch):
    """普通 1GB Agent 没装 torch,这个口必须是关的。"""
    monkeypatch.setenv("AGENT_ENABLE_CLIP_EMBEDDINGS", "false")
    monkeypatch.setenv("AGENT_SHARED_SECRET", "s3cret")
    get_settings.cache_clear()
    client = TestClient(app)
    resp = client.post(
        "/internal/open-clip/embeddings",
        json={"images": [_data_url()]},
        headers={"Authorization": "Bearer s3cret"},
    )
    assert resp.status_code == 404


def test_requires_bearer(monkeypatch):
    monkeypatch.setenv("AGENT_ENABLE_CLIP_EMBEDDINGS", "true")
    monkeypatch.setenv("AGENT_SHARED_SECRET", "s3cret")
    get_settings.cache_clear()
    client = TestClient(app)
    resp = client.post("/internal/open-clip/embeddings", json={"images": [_data_url()]})
    assert resp.status_code == 401


def test_returns_shape_the_caller_expects(monkeypatch):
    """响应形状必须是 features.py 读的那个:body['data']['embeddings'],长度对齐。"""
    monkeypatch.setenv("AGENT_ENABLE_CLIP_EMBEDDINGS", "true")
    monkeypatch.setenv("AGENT_SHARED_SECRET", "s3cret")
    get_settings.cache_clear()

    from src.workflows.core.chaptering import features

    monkeypatch.setattr(features, "clip_embeddings", lambda images: [[0.1, 0.2]] * len(images))

    client = TestClient(app)
    resp = client.post(
        "/internal/open-clip/embeddings",
        json={"images": [_data_url(), _data_url()]},
        headers={"Authorization": "Bearer s3cret"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert len(body["data"]["embeddings"]) == 2


def test_empty_images_returns_empty_list(monkeypatch):
    monkeypatch.setenv("AGENT_ENABLE_CLIP_EMBEDDINGS", "true")
    monkeypatch.setenv("AGENT_SHARED_SECRET", "s3cret")
    get_settings.cache_clear()
    client = TestClient(app)
    resp = client.post(
        "/internal/open-clip/embeddings",
        json={"images": []},
        headers={"Authorization": "Bearer s3cret"},
    )
    assert resp.status_code == 200
    assert resp.json()["data"]["embeddings"] == []
```

- [ ] **Step 2: 运行确认失败**

Run: `cd engine && .venv/bin/python -m pytest tests/test_internal_clip_route.py -v`
Expected: FAIL —— 开启开关那几个用例拿到 404（路由不存在）

- [ ] **Step 3: 实现路由**

在 `engine/src/api/routes.py` 末尾追加。注意 import 段要加 `require_clip_bearer` 和 `BaseModel`：

```python
# ---------- internal:CLIP embedding worker ------------------------------------
#
# 只有专用的 2GB CLIP worker(fly.clip.toml,AGENT_ENABLE_CLIP_EMBEDDINGS=true)
# 开这个口;普通 1GB Agent 没装 torch,开关关着 => 404。
# 响应形状由调用方 features.py:_remote_clip_embeddings 决定,不能改。


class _EmbeddingsRequest(BaseModel):
    images: list[str]  # data:image/jpeg;base64,... —— 只在内存里,不落盘不进日志


@router.post("/internal/open-clip/embeddings", dependencies=[Depends(require_clip_bearer)])
async def open_clip_embeddings(payload: _EmbeddingsRequest) -> dict:
    settings = get_settings()
    if not settings.agent_enable_clip_embeddings:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"ok": False, "error": {"code": "AGENT_NOT_FOUND", "message": "clip embeddings disabled"}},
        )
    if not payload.images:
        return {"ok": True, "data": {"embeddings": []}}

    from ..workflows.core.chaptering import features

    images = [_decode_data_url(url) for url in payload.images]
    # CPU 推理是阻塞的,别占住事件循环。
    embeddings = await run_in_threadpool(features.clip_embeddings, images)
    log.info("open_clip_embeddings", count=len(images))
    return {"ok": True, "data": {"embeddings": embeddings}}


def _decode_data_url(url: str) -> "Image.Image":
    """data URL -> PIL Image。只认 base64 内联,不外联取图(SSRF)。"""
    if "," not in url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"ok": False, "error": {"code": "AGENT_BAD_REQUEST", "message": "not a data url"}},
        )
    header, encoded = url.split(",", 1)
    if not header.startswith("data:image/"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"ok": False, "error": {"code": "AGENT_BAD_REQUEST", "message": "not an image data url"}},
        )
    return Image.open(io.BytesIO(base64.b64decode(encoded)))
```

对应的 import 追加（放在文件顶部已有 import 段里，按现有分组）：

```python
import base64
import io

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from PIL import Image

from .auth import require_bearer, require_clip_bearer
```

- [ ] **Step 4: 运行确认通过**

Run: `cd engine && .venv/bin/python -m pytest tests/test_internal_clip_route.py -v`
Expected: PASS，4 个用例全绿

- [ ] **Step 5: 跑一遍 engine 全量测试，确认没打破别的**

Run: `cd engine && .venv/bin/python -m pytest tests/ -q`
Expected: 全绿（若有历史遗留红灯，记下来但别顺手改，不属于本任务）

- [ ] **Step 6: 提交**

```bash
git add engine/src/api/routes.py engine/tests/test_internal_clip_route.py
git commit -m "$(cat <<'MSG'
fix(engine): 补上缺失的 /internal/open-clip/embeddings 路由

调用方(features._remote_clip_embeddings)、鉴权(require_clip_bearer)、fly 部署
和开关都早就在了,只有路由本身没写 —— 主 engine 配了 GROUPING_CLIP_BASE_URL,
分簇一走视觉子分组就撞 404,而 grouping.py 的 emb_future.result() 没有 fallback,
直接把 analyze 打挂。

响应形状照调用方读的 body['data']['embeddings'] 写死,不能改。
CPU 推理走 run_in_threadpool,别占住事件循环。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

## Task A2：色彩组 —— 纯像素算法，不用模型

**Files:**
- Create: `engine/src/workflows/core/profile/__init__.py`
- Create: `engine/src/workflows/core/profile/color.py`
- Create: `engine/tests/test_profile_color.py`

**Interfaces:**
- Consumes: `PhotoProfile` 的色彩组字段定义（Task 0）
- Produces: `color_features(image: Image.Image) -> dict` 返回 `{"colorTemp", "brightness", "saturation", "dominantColors"}`，键名与 `PhotoProfile` 逐字对应

- [ ] **Step 1: 写失败测试**

```python
# engine/tests/test_profile_color.py
"""色彩组:纯像素统计,零模型零网络。

判据用「合成图」而不是真照片 —— 合成图的期望值是确定的,真照片只能眼睛看,
测不出回归。真照片的验收放在 Task Z1 端到端。
"""

from PIL import Image

from src.workflows.core.profile.color import color_features


def _solid(rgb: tuple[int, int, int]) -> Image.Image:
    return Image.new("RGB", (64, 64), rgb)


def test_warm_image_reads_warm():
    assert color_features(_solid((220, 150, 70)))["colorTemp"] == "warm"


def test_cool_image_reads_cool():
    assert color_features(_solid((70, 130, 220)))["colorTemp"] == "cool"


def test_grey_image_reads_neutral():
    assert color_features(_solid((128, 128, 128)))["colorTemp"] == "neutral"


def test_dark_image_reads_dark():
    assert color_features(_solid((18, 18, 22)))["brightness"] == "dark"


def test_bright_image_reads_bright():
    assert color_features(_solid((238, 238, 232)))["brightness"] == "bright"


def test_grey_is_muted_and_vivid_is_vivid():
    assert color_features(_solid((128, 128, 128)))["saturation"] == "muted"
    assert color_features(_solid((230, 20, 20)))["saturation"] == "vivid"


def test_dominant_colors_are_hex_and_capped_at_three():
    out = color_features(Image.new("RGB", (64, 64)))
    colors = out["dominantColors"]
    assert len(colors) <= 3
    assert all(c.startswith("#") and len(c) == 7 for c in colors)


def test_output_keys_match_contract_exactly():
    """键名与 PhotoProfile 色彩组逐字对应 —— 漂了下游组装会静默丢字段。"""
    assert set(color_features(_solid((100, 100, 100)))) == {
        "colorTemp",
        "brightness",
        "saturation",
        "dominantColors",
    }


def test_handles_rgba_and_greyscale_input():
    """用户传的图不一定是 RGB —— PNG 带 alpha、老照片是 L 模式,都不许炸。"""
    for mode in ("RGBA", "L", "P"):
        out = color_features(Image.new(mode, (32, 32)))
        assert out["colorTemp"] in {"warm", "neutral", "cool"}
```

- [ ] **Step 2: 运行确认失败**

Run: `cd engine && .venv/bin/python -m pytest tests/test_profile_color.py -v`
Expected: FAIL —— `ModuleNotFoundError: src.workflows.core.profile.color`

- [ ] **Step 3: 实现**

```python
# engine/src/workflows/core/profile/__init__.py
"""照片视觉档案(PhotoProfile)的三组特征提取。

色彩组纯像素、几何组走分割模型、语义组走视觉模型 —— 三组互不依赖,可分别测。
"""
```

```python
# engine/src/workflows/core/profile/color.py
"""色彩组:纯像素统计,零模型零网络。

阈值都是经验值,改之前先看 tests/test_profile_color.py 的合成图期望。
"""

from __future__ import annotations

import colorsys

from PIL import Image

_SAMPLE_SIZE = 96  # 缩到这个尺寸再统计:够稳,又不至于为一张大图跑几百万像素


def _to_rgb(image: Image.Image) -> Image.Image:
    """任何模式统一到 RGB —— 用户会传 RGBA(PNG)、L(老照片扫描)、P(GIF)。"""
    return image.convert("RGB")


def color_features(image: Image.Image) -> dict:
    small = _to_rgb(image).resize((_SAMPLE_SIZE, _SAMPLE_SIZE), Image.Resampling.BILINEAR)
    pixels = list(small.getdata())
    n = len(pixels)

    r_mean = sum(p[0] for p in pixels) / n
    g_mean = sum(p[1] for p in pixels) / n
    b_mean = sum(p[2] for p in pixels) / n

    hsv = [colorsys.rgb_to_hsv(p[0] / 255, p[1] / 255, p[2] / 255) for p in pixels]
    v_mean = sum(h[2] for h in hsv) / n
    s_mean = sum(h[1] for h in hsv) / n

    # 色温:红蓝均值之差。±12 是经验阈值(0-255 尺度上约 5%)。
    warm_cool = r_mean - b_mean
    if warm_cool > 12:
        color_temp = "warm"
    elif warm_cool < -12:
        color_temp = "cool"
    else:
        color_temp = "neutral"

    if v_mean < 0.32:
        brightness = "dark"
    elif v_mean > 0.72:
        brightness = "bright"
    else:
        brightness = "mid"

    if s_mean < 0.18:
        saturation = "muted"
    elif s_mean > 0.55:
        saturation = "vivid"
    else:
        saturation = "normal"

    return {
        "colorTemp": color_temp,
        "brightness": brightness,
        "saturation": saturation,
        "dominantColors": _dominant_colors(small),
    }


def _dominant_colors(small: Image.Image, k: int = 3) -> list[str]:
    """主色调:Pillow 自带的中位切分量化,不引入 sklearn。"""
    quantized = small.quantize(colors=k, method=Image.Quantize.MEDIANCUT)
    palette = quantized.getpalette() or []
    counts = sorted(quantized.getcolors() or [], reverse=True)
    out: list[str] = []
    for _count, index in counts[:k]:
        r, g, b = palette[index * 3 : index * 3 + 3]
        out.append(f"#{r:02X}{g:02X}{b:02X}")
    return out
```

- [ ] **Step 4: 运行确认通过**

Run: `cd engine && .venv/bin/python -m pytest tests/test_profile_color.py -v`
Expected: PASS。若某个阈值用例差一点，**调阈值不要调断言** —— 断言描述的是人眼直觉。

- [ ] **Step 5: 提交**

```bash
git add engine/src/workflows/core/profile/ engine/tests/test_profile_color.py
git commit -m "$(cat <<'MSG'
feat(engine): 档案色彩组 —— 色温/明暗/饱和度/主色调

纯像素统计,零模型零网络。任何 PIL 模式(RGBA/L/P)统一转 RGB 再算,
主色调用 Pillow 自带中位切分量化,不引入 sklearn。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

## Task A3：几何组 —— 主体框 + 人脸框

**这是 A 线技术风险最高的任务。** CLIP worker 只有 2GB 内存、shared-cpu-1x，torch + open_clip 已经占了一块，加模型前必须实测内存。

**Files:**
- Create: `engine/src/workflows/core/profile/geometry.py`
- Create: `engine/tests/test_profile_geometry.py`
- Modify: `engine/Dockerfile`（CLIP build arg 段追加档案模型）
- Modify: `engine/pyproject.toml`（若需要新依赖）

**Interfaces:**
- Produces:
  - `subject_geometry(image: Image.Image) -> dict` 返回 `{"subjectBox": {...} | None, "faceBoxes": [...]}`，坐标 **0-100**
  - `subject_mask(image: Image.Image) -> Image.Image` 返回 alpha mask（L 模式），供按需抠图用
  - `box_from_mask(mask: Image.Image, threshold: int = 128) -> dict | None` —— 纯函数，可脱离模型单测

- [ ] **Step 1: 先做内存实测，再写代码**

这一步的产出是数字，不是代码。在本地容器里量：

```bash
cd /path/to/repo
docker build -f engine/Dockerfile --build-arg INSTALL_CLIP=true -t yujee-engine-clip-probe .
docker run --rm -m 2g yujee-engine-clip-probe python -c "
import resource, torch, open_clip
print('after torch+open_clip:', resource.getrusage(resource.RUSAGE_SELF).ru_maxrss // 1024, 'MB')
"
```

记下这个基线数字。**2GB 减去它，就是档案模型的全部预算。**

若基线已经超过 1.4GB，停下来汇报 —— 意味着档案推理塞不进这台机器，要走退路（见 Step 8）。

- [ ] **Step 2: 写 `box_from_mask` 的失败测试（纯函数，不碰模型）**

模型部分难以单测，但 mask → 包围盒这段是纯几何，必须测透 —— 坐标口径错了是这个方案最容易出的 bug。

```python
# engine/tests/test_profile_geometry.py
"""几何组。

模型推理部分不在单测里跑(慢、要下权重),单测只覆盖纯几何的 box_from_mask ——
坐标口径(0-100 而不是 0-1)是这个方案最容易错的地方,必须锁死。
真实抠图质量的验收在 Task Z1,靠眼睛看,不靠指标。
"""

from PIL import Image

from src.workflows.core.profile.geometry import box_from_mask


def _mask_with_rect(size, rect, fg=255, bg=0):
    """在 size 的画布上画一个 rect=(left, top, right, bottom) 的前景块。"""
    img = Image.new("L", size, bg)
    for x in range(rect[0], rect[2]):
        for y in range(rect[1], rect[3]):
            img.putpixel((x, y), fg)
    return img


def test_box_is_percentage_0_to_100_not_0_to_1():
    """铁律:坐标是 0-100,与 imagePos 同口径。返回 0-1 会让 Agent 心算全错。"""
    mask = _mask_with_rect((100, 100), (10, 20, 60, 80))
    box = box_from_mask(mask)
    assert box == {"x": 10.0, "y": 20.0, "w": 50.0, "h": 60.0}


def test_box_scales_with_canvas_size():
    """同样位置的主体,在不同分辨率上得到同样的百分比。"""
    small = box_from_mask(_mask_with_rect((100, 100), (25, 25, 75, 75)))
    large = box_from_mask(_mask_with_rect((400, 400), (100, 100, 300, 300)))
    assert small == large


def test_empty_mask_returns_none():
    """纯风景/抽象构图跑不出主体 —— 返回 None,让 imagePos 走默认 50/50/1。"""
    assert box_from_mask(Image.new("L", (50, 50), 0)) is None


def test_full_mask_returns_full_frame():
    box = box_from_mask(Image.new("L", (50, 50), 255))
    assert box == {"x": 0.0, "y": 0.0, "w": 100.0, "h": 100.0}


def test_threshold_ignores_faint_noise():
    """分割模型输出的边缘是渐变的,弱于阈值的噪点不该把包围盒撑大。"""
    mask = _mask_with_rect((100, 100), (40, 40, 60, 60), fg=255, bg=0)
    mask.putpixel((2, 2), 40)  # 远处一个弱噪点
    box = box_from_mask(mask, threshold=128)
    assert box["x"] == 40.0 and box["y"] == 40.0


def test_non_square_canvas_uses_own_axis():
    """长宽不等时 x 按宽算、y 按高算 —— 混用会让竖图的框整个歪掉。"""
    box = box_from_mask(_mask_with_rect((200, 100), (100, 25, 200, 75)))
    assert box == {"x": 50.0, "y": 25.0, "w": 50.0, "h": 50.0}
```

- [ ] **Step 3: 运行确认失败**

Run: `cd engine && .venv/bin/python -m pytest tests/test_profile_geometry.py -v`
Expected: FAIL —— `ModuleNotFoundError: src.workflows.core.profile.geometry`

- [ ] **Step 4: 实现 `box_from_mask`（先只做纯几何，模型后接）**

```python
# engine/src/workflows/core/profile/geometry.py
"""几何组:主体包围盒 + 人脸框。

⚠️ 坐标一律 0-100 百分比,与 imagePos 的 objectPosition 同口径。
别改成 0-1 —— 两套坐标系并存,Agent 心算必错。

模型按需惰性加载,进程内缓存一份。box_from_mask 是纯函数,
可以脱离模型单测。
"""

from __future__ import annotations

from PIL import Image


def box_from_mask(mask: Image.Image, threshold: int = 128) -> dict | None:
    """alpha mask -> 主体包围盒(0-100 百分比)。前景为空返回 None。

    threshold:分割输出边缘是渐变的,低于阈值的弱像素视作背景,免得噪点撑大框。
    """
    grey = mask.convert("L")
    width, height = grey.size
    if width == 0 or height == 0:
        return None

    binary = grey.point(lambda value: 255 if value >= threshold else 0)
    bbox = binary.getbbox()  # (left, upper, right, lower);全黑返回 None
    if bbox is None:
        return None

    left, upper, right, lower = bbox
    return {
        "x": left / width * 100,
        "y": upper / height * 100,
        "w": (right - left) / width * 100,
        "h": (lower - upper) / height * 100,
    }
```

- [ ] **Step 5: 运行确认通过**

Run: `cd engine && .venv/bin/python -m pytest tests/test_profile_geometry.py -v`
Expected: PASS，6 个用例全绿

- [ ] **Step 6: 提交纯几何部分（模型还没接，先落一个绿的地基）**

```bash
git add engine/src/workflows/core/profile/geometry.py engine/tests/test_profile_geometry.py
git commit -m "$(cat <<'MSG'
feat(engine): 档案几何组地基 —— mask 转包围盒

坐标 0-100 与 imagePos 同口径,长宽各按自己的轴算。纯函数,可脱离模型单测;
空 mask 返回 None 让 imagePos 走默认 50/50/1。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

- [ ] **Step 7: 接分割模型，产出 mask**

> **⚠️ 2026-09-09 已拍板改选型 —— RMBG-1.4 不能用。**
>
> 它的许可是 `bria-rmbg-1.4`，HuggingFace 官方元数据写明 *"source-available model
> for **non-commercial** use"*。Yujee 是收费产品，烘进镜像就是拿非商用许可的模型
> 商用。**这是硬约束，别因为「RMBG 效果更好」改回去。**
>
> 改用两个 **Apache-2.0** 的（实测数字见 Step 8）：
>
> | 用途 | 模型 | 权重 | 输入 | 峰值 RSS | 单张 |
> |---|---|---|---|---|---|
> | 建档（只要包围盒） | **u2netp** | 4MB | 320² | 323MB | 0.6s |
> | 真抠图（要精细边缘） | **isnet-general-use** | 170MB | 1024² | 951MB | 4.1s |
>
> 权重直链固定在 rembg 的 `v0.0.0` release 资产上：
> `https://github.com/danielgatis/rembg/releases/download/v0.0.0/{u2netp,isnet-general-use}.onnx`
>
> 320² 的糙边**不能**拿去抠图 —— 那正是风险④里 2026-08-29 否决自动抠图的病。
>
> 另：原文「ONNX ~44MB 比 torch 版 176MB 省」是**错的**。fp32 ONNX 就是 176MB，
> 44MB 那个是 int8 量化版，而且实测量化版反而更吃内存（876MB vs 832MB）。

选型硬约束（不满足就走 Step 8 退路）：

- 用 **ONNX + onnxruntime**，不跟 open_clip 抢 torch 版本
- 两个模型的**归一化常数不一样**（u2netp 用 imagenet mean/std，isnet 用 0.5/1.0），
  张冠李戴 mask 会整个糊掉 —— 绑进 spec，别写成全局常量
- ORT 的 `enable_cpu_mem_arena` 必须**关掉**：开着会一路只涨不还（1095MB 且继续爬），
  关掉才稳在平台期。`intra/inter_op_num_threads` 钉成 1（shared-cpu-1x 就一个核）
- 权重**不进镜像的 git 层**，走构建期下载或运行时首次加载缓存到 `/app/models`
- 加载必须是**惰性 + 进程内单例**：`min_machines_running=0` 的机器冷启已经慢，别在 import 期加载
- **推理必须全机串行**（`run_in_threadpool` 默认 40 线程，并发就撑爆 2GB），
  但**视觉模型的网络调用不进锁** —— 那是好几秒的 I/O，锁进去 analyze 会超时
- ⚠️ **「不进锁」不等于「并发」**：批内必须显式 `asyncio.gather` + `Semaphore(8)` 限流，
  逐个 `await` 照样串行（第一版实现正是栽在这）。验收要断言视觉调用**有重叠**且本地推理
  **无重叠**，两条都要

在 `geometry.py` 追加：

```python
_MODEL_CACHE: dict[str, object] = {}


def _rmbg_session():
    """惰性加载 + 进程内单例。冷启已经慢,别在 import 期加载。"""
    if "rmbg" not in _MODEL_CACHE:
        import onnxruntime as ort

        from ...settings import get_settings

        path = get_settings().profile_rmbg_model_path
        _MODEL_CACHE["rmbg"] = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
    return _MODEL_CACHE["rmbg"]


def subject_mask(image: Image.Image) -> Image.Image:
    """前景 mask(L 模式,与原图同尺寸)。"""
    import numpy as np

    session = _rmbg_session()
    size = (320, 320)  # u2netp 的输入尺寸;抠图那条走 isnet/1024²
    resized = image.convert("RGB").resize(size, Image.Resampling.BILINEAR)
    array = np.asarray(resized, dtype=np.float32) / 255.0
    array = (array - 0.5) / 1.0
    tensor = array.transpose(2, 0, 1)[None, ...]

    output = session.run(None, {session.get_inputs()[0].name: tensor})[0]
    prediction = output[0, 0]
    lo, hi = float(prediction.min()), float(prediction.max())
    prediction = (prediction - lo) / (hi - lo + 1e-8)
    mask = Image.fromarray((prediction * 255).astype("uint8"), mode="L")
    return mask.resize(image.size, Image.Resampling.BILINEAR)


def subject_geometry(image: Image.Image) -> dict:
    """几何组的对外入口。mask 只用来取框,**不返回也不保存** ——
    绝大多数照片不会被抠,预存 mask 是净浪费(见契约注释)。"""
    return {
        "subjectBox": box_from_mask(subject_mask(image)),
        "faceBoxes": detect_faces(image),
    }
```

`settings.py` 追加：

```python
    # 照片档案的两个分割模型权重(ONNX)。只有 CLIP worker 装。都是 Apache-2.0。
    profile_seg_model_path: str = "/app/models/u2netp.onnx"
    profile_matting_model_path: str = "/app/models/isnet-general-use.onnx"
```

Dockerfile 的 `INSTALL_CLIP` 段追加（与 torch 同一个 `if` 块内）：

```dockerfile
      pip install onnxruntime==1.20.1 numpy && \
      mkdir -p /app/models && \
      python -c "import urllib.request; urllib.request.urlretrieve('https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx', '/app/models/u2netp.onnx')" && \
      python -c "import urllib.request; urllib.request.urlretrieve('https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx', '/app/models/isnet-general-use.onnx')" ; \
```

⚠️ 权重 URL 要用固定版本的直链，不要用会漂的 `main` 分支链接。确定 URL 后把它写进这份计划的这一行，别留占位。

- [ ] **Step 8: 内存复测；超预算就走退路**

```bash
docker build -f engine/Dockerfile --build-arg INSTALL_CLIP=true -t yujee-engine-clip-probe .
docker run --rm -m 2g yujee-engine-clip-probe python -c "
import resource
from PIL import Image
from src.workflows.core.profile.geometry import subject_geometry
print(subject_geometry(Image.new('RGB', (1200, 800), (120, 90, 60))))
print('peak:', resource.getrusage(resource.RUSAGE_SELF).ru_maxrss // 1024, 'MB')
"
```

Expected: 不 OOM，peak 明显低于 2048MB。

> **✅ 2026-09-09 实测结论(本机原生 —— 开发机没装 docker，不是 2g 容器内的数)：**
>
> | | 峰值 RSS |
> |---|---|
> | torch + open_clip + ViT-B-32 加载 | **~1356 MB** ← 瓶颈在这，占 2048 的 66% |
> | 　+ u2netp（320²）推理 | ~1356 MB（**一点没抬高**） |
> | 　+ RMBG-1.4（1024²）推理 | 1478 MB |
>
> **吃内存的是 CLIP 的加载瞬时峰值，不是档案模型。** 走 u2netp 剩 ~690MB 余量，
> 下面三条退路一条都没用上。

**若 OOM 或逼近上限，退路按这个顺序选，选完汇报**：
1. CLIP worker 的 `[[vm]] memory` 提到 4096mb（`min_machines_running=0`，不跑就不烧钱，这是最省事的一条）
2. 档案推理拆成第三个 worker（新 fly app + 新 build arg），跟 CLIP 彻底分开
3. 放弃本地分割，改调外部抠图 API —— **这条要先算每张单价，会改变整个方案的成本结构，必须回来拍板**

- [ ] **Step 9: 人脸框**

用途只是「别切脸」，**大致位置就够，不需要高精度**。按这个顺序选：

1. 若 Step 7 已经引入 onnxruntime，用 **YuNet**（~340KB ONNX），同一个 runtime，几乎零边际成本 —— 首选
2. 实在装不下，`detect_faces` 返回 `[]`，并在 `geometry.py` 顶部注释写明「人脸框暂未接入，`avoid-face-crop` 会退化成 `center-subject`」，同时告知 C 线

无论走哪条，`detect_faces(image) -> list[dict]` 这个签名和 **0-100 坐标口径**不变。补一个测试：坐标同样是 0-100、无脸返回 `[]`。

- [ ] **Step 10: 提交**

```bash
git add engine/src/workflows/core/profile/geometry.py engine/tests/test_profile_geometry.py \
        engine/Dockerfile engine/src/settings.py
git commit -m "$(cat <<'MSG'
feat(engine): 档案几何组接入分割模型 + 人脸框

ONNX + onnxruntime(建档 u2netp 4MB / 抠图 isnet 170MB,均 Apache-2.0),
惰性加载进程内单例,冷启不预热。
建档只取 mask 的包围盒,mask 本身丢弃 —— 绝大多数照片不会被抠。
内存已在 2g 限制的容器里实测。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

## Task A4：语义组 —— 豆包 vision 一次调用出五个字段

**Files:**
- Create: `engine/src/workflows/core/profile/semantic.py`
- Create: `engine/tests/test_profile_semantic.py`

**Interfaces:**
- Consumes: 现有视觉模型客户端 `src/providers/ai_client.py`（`ARK_VISION_MODEL=doubao-seed-1-6-vision-250815`），照片以 `{"type":"image_url","image_url":{"url": dataUrl}}` 进 content —— 参照 `src/workflows/core/compose/handler.py:_build_chapter_messages` 的写法
- Produces: `semantic_features(image) -> dict` 返回 `{"composition", "scene", "peopleCount", "mood", "description"}`

- [ ] **Step 1: 写失败测试（模型调用打桩，不打真 API）**

```python
# engine/tests/test_profile_semantic.py
"""语义组:一次视觉模型调用出五个字段。

单测把模型响应打桩 —— 重点测解析和兜底,不测模型本身。
模型真实质量的验收在 Task Z1。
"""

import json

import pytest
from PIL import Image

from src.workflows.core.profile import semantic


def _img():
    return Image.new("RGB", (64, 64), (120, 90, 60))


def _stub(monkeypatch, payload):
    monkeypatch.setattr(semantic, "_call_vision", lambda image: payload)


def test_parses_all_five_fields(monkeypatch):
    _stub(monkeypatch, json.dumps({
        "composition": "closeup",
        "scene": "indoor",
        "peopleCount": "1",
        "mood": "quiet",
        "description": "窗边的侧脸",
    }))
    out = semantic.semantic_features(_img())
    assert out == {
        "composition": "closeup",
        "scene": "indoor",
        "peopleCount": "1",
        "mood": "quiet",
        "description": "窗边的侧脸",
    }


def test_rejects_out_of_enum_value_and_falls_back(monkeypatch):
    """模型吐了枚举外的值 —— 落到安全默认,不抛,不让一张坏照片打挂整本分析。"""
    _stub(monkeypatch, json.dumps({
        "composition": "panorama",
        "scene": "space",
        "peopleCount": "many",
        "mood": "chaotic",
        "description": "x",
    }))
    out = semantic.semantic_features(_img())
    assert out["composition"] == "focal"
    assert out["scene"] == "outdoor"
    assert out["peopleCount"] == "0"
    assert out["mood"] == "quiet"


def test_handles_non_json_response(monkeypatch):
    _stub(monkeypatch, "对不起，我无法分析这张图片。")
    out = semantic.semantic_features(_img())
    assert out["composition"] == "focal"
    assert out["description"] == ""


def test_handles_fenced_json(monkeypatch):
    """模型爱套 ```json 围栏,得剥掉。"""
    _stub(monkeypatch, '```json\n{"composition":"wide","scene":"nature",'
                       '"peopleCount":"0","mood":"quiet","description":"山脊线"}\n```')
    assert semantic.semantic_features(_img())["composition"] == "wide"


def test_description_is_truncated_to_contract_limit(monkeypatch):
    _stub(monkeypatch, json.dumps({
        "composition": "focal", "scene": "city", "peopleCount": "2-3",
        "mood": "energetic", "description": "很长" * 400,
    }))
    assert len(semantic.semantic_features(_img())["description"]) <= 300


def test_prompt_forbids_location_info():
    """隐私红线:提示词必须明确禁止写地名。这是红线的第一道闸。"""
    assert "地名" in semantic.PROMPT or "location" in semantic.PROMPT.lower()
```

- [ ] **Step 2: 运行确认失败**

Run: `cd engine && .venv/bin/python -m pytest tests/test_profile_semantic.py -v`
Expected: FAIL —— 模块不存在

- [ ] **Step 3: 实现**

```python
# engine/src/workflows/core/profile/semantic.py
"""语义组:一次视觉模型调用同时出五个字段。

⚠️ 隐私红线(v3-requirements §3):提示词明确禁止写地名/位置,契约层的
extra=forbid 是第二道闸。两道都要在。

模型不可靠是常态 —— 枚举外的值、非 JSON、套围栏都会发生。一律落安全默认,
绝不抛异常:一张照片解析失败不该打挂整本分析。
"""

from __future__ import annotations

import base64
import io
import json
import re

from PIL import Image

PROMPT = """你在为一本纪念相册分析单张照片。只输出 JSON，不要任何解释文字。

{
  "composition": "closeup | focal | wide",
  "scene": "indoor | outdoor | nature | city | interior",
  "peopleCount": "0 | 1 | 2-3 | 4+",
  "mood": "warm | cool | sentimental | energetic | quiet",
  "description": "一句话描述画面内容，不超过 60 字"
}

规则：
- composition：closeup=人物或物体特写；focal=有明确主体的中景；wide=大场景/风光。
- description 只描述看得见的画面。
- **严禁写任何地名、位置、坐标信息**，即使你认得出这是哪里。写"海边"可以，写具体城市名不行。
- 值必须从上面给的选项里选，不要自造。
"""

_COMPOSITION = {"closeup", "focal", "wide"}
_SCENE = {"indoor", "outdoor", "nature", "city", "interior"}
_PEOPLE = {"0", "1", "2-3", "4+"}
_MOOD = {"warm", "cool", "sentimental", "energetic", "quiet"}

# 安全默认:模型给不出可用值时落这里。focal/outdoor 是最不容易造成明显错配的中间态。
_FALLBACK = {
    "composition": "focal",
    "scene": "outdoor",
    "peopleCount": "0",
    "mood": "quiet",
    "description": "",
}


def semantic_features(image: Image.Image) -> dict:
    try:
        raw = _call_vision(image)
    except Exception:  # noqa: BLE001 —— 一张照片的模型失败不该打挂整本分析
        return dict(_FALLBACK)
    return _parse(raw)


def _parse(raw: str) -> dict:
    data = _loads_lenient(raw)
    if not isinstance(data, dict):
        return dict(_FALLBACK)

    def pick(key: str, allowed: set[str]) -> str:
        value = data.get(key)
        return value if isinstance(value, str) and value in allowed else _FALLBACK[key]

    description = data.get("description")
    description = description[:300] if isinstance(description, str) else ""

    return {
        "composition": pick("composition", _COMPOSITION),
        "scene": pick("scene", _SCENE),
        "peopleCount": pick("peopleCount", _PEOPLE),
        "mood": pick("mood", _MOOD),
        "description": description,
    }


def _loads_lenient(raw: str):
    """模型爱套 ```json 围栏、爱在 JSON 前后加话。剥掉再解析。"""
    if not isinstance(raw, str):
        return None
    text = raw.strip()
    fenced = re.search(r"```(?:json)?\s*(.+?)\s*```", text, re.DOTALL)
    if fenced:
        text = fenced.group(1)
    else:
        start, end = text.find("{"), text.rfind("}")
        if start >= 0 and end > start:
            text = text[start : end + 1]
    try:
        return json.loads(text)
    except (json.JSONDecodeError, ValueError):
        return None


def _call_vision(image: Image.Image) -> str:
    """调 ARK_VISION_MODEL。照片以 data URL 进 content ——
    写法参照 workflows/core/compose/handler.py:_build_chapter_messages。"""
    from ....providers.ai_client import call_vision_model  # 按 ai_client 的实际导出名调整

    buf = io.BytesIO()
    image.convert("RGB").save(buf, format="JPEG", quality=85)
    data_url = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")

    return call_vision_model(
        messages=[{
            "role": "user",
            "content": [
                {"type": "text", "text": PROMPT},
                {"type": "image_url", "image_url": {"url": data_url}},
            ],
        }],
    )
```

⚠️ `call_vision_model` 的真实名字和签名以 `engine/src/providers/ai_client.py` 为准 —— 打开它照抄 compose 环节的调用方式，别照我这行猜。

- [ ] **Step 4: 运行确认通过**

Run: `cd engine && .venv/bin/python -m pytest tests/test_profile_semantic.py -v`
Expected: PASS，6 个用例全绿

- [ ] **Step 5: 提交**

```bash
git add engine/src/workflows/core/profile/semantic.py engine/tests/test_profile_semantic.py
git commit -m "$(cat <<'MSG'
feat(engine): 档案语义组 —— 一次视觉调用出五个字段

composition/scene/peopleCount/mood/description 一把出。模型不可靠是常态:
枚举外值、非 JSON、```json 围栏全部落安全默认,绝不抛 —— 一张照片解析失败
不该打挂整本分析。提示词里明确禁地名,是隐私红线的第一道闸。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

## Task A5：组装 endpoint + 接进 analyze + 回填两个死字段

**Files:**
- Create: `engine/src/workflows/core/profile/build.py`
- Modify: `engine/src/api/routes.py`（加 `/internal/photo-profile`）
- Modify: `engine/src/workflows/core/chaptering/tree_builder.py:157,162`（回填）
- Create: `engine/tests/test_profile_build.py`
- Modify: `engine/tests/test_internal_clip_route.py`（补新路由的用例）

**Interfaces:**
- Consumes: `color_features`（A2）、`subject_geometry`（A3）、`semantic_features`（A4）
- Produces:
  - `build_profile(image) -> dict` —— 三组合一，形状与 `PhotoProfile` 逐字对应
  - `POST /internal/photo-profile`，请求 `{"images": [{"photoId": str, "dataUrl": str}, ...], "persistMask": bool}`，响应 `{"ok": true, "data": {"profiles": {photoId: profile}}}`

- [ ] **Step 1: 写组装的失败测试**

```python
# engine/tests/test_profile_build.py
"""三组合一。重点:输出必须能被 PhotoProfile 契约直接 parse —— 这是 A/B 两线的接缝。"""

import pytest
from PIL import Image

from src.contracts.photo_profile import PhotoProfile
from src.workflows.core.profile import build


@pytest.fixture(autouse=True)
def _stub_heavy(monkeypatch):
    """几何和语义打桩 —— 单测不下模型权重、不打真 API。色彩组是纯像素,真跑。"""
    monkeypatch.setattr(
        build, "subject_geometry",
        lambda image: {"subjectBox": {"x": 10.0, "y": 20.0, "w": 50.0, "h": 60.0}, "faceBoxes": []},
    )
    monkeypatch.setattr(
        build, "semantic_features",
        lambda image: {
            "composition": "focal", "scene": "outdoor", "peopleCount": "1",
            "mood": "warm", "description": "海边",
        },
    )


def test_output_parses_as_contract():
    """A 线的产出必须能被 B 线的契约直接吃下 —— 这是两线的接缝,漂了就白干。"""
    profile = build.build_profile(Image.new("RGB", (64, 64), (200, 140, 80)))
    parsed = PhotoProfile.model_validate(profile)
    assert parsed.v == 1
    assert parsed.subjectBox.w == 50.0


def test_mask_key_defaults_to_none():
    """建档不存 mask —— 绝大多数照片不会被抠。"""
    assert build.build_profile(Image.new("RGB", (32, 32)))["maskKey"] is None


def test_no_location_keys_in_output():
    """隐私红线的第三道闸:组装层自己也不许漏进位置字段。"""
    profile = build.build_profile(Image.new("RGB", (32, 32)))
    forbidden = {"location", "place", "gps", "lat", "lng", "latitude", "longitude", "coordinate", "coordinates"}
    assert not (set(profile) & forbidden)


def test_geometry_failure_degrades_not_crashes(monkeypatch):
    """模型挂了要降级成「没主体」,不是整本分析失败。"""
    monkeypatch.setattr(build, "subject_geometry", lambda image: (_ for _ in ()).throw(RuntimeError("model down")))
    profile = build.build_profile(Image.new("RGB", (32, 32)))
    assert profile["subjectBox"] is None
    assert profile["faceBoxes"] == []
    PhotoProfile.model_validate(profile)  # 降级后仍然是合法档案
```

- [ ] **Step 2: 运行确认失败**

Run: `cd engine && .venv/bin/python -m pytest tests/test_profile_build.py -v`
Expected: FAIL —— `build` 模块不存在

- [ ] **Step 3: 实现组装**

```python
# engine/src/workflows/core/profile/build.py
"""三组合一 -> PhotoProfile。

分层原则:任何一组失败都降级,不抛 —— 一张照片的档案缺失只该让它退回默认
排版,不该打挂整本分析。
"""

from __future__ import annotations

from PIL import Image

from .color import color_features
from .geometry import subject_geometry
from .semantic import semantic_features

PHOTO_PROFILE_VERSION = 1


def build_profile(image: Image.Image) -> dict:
    try:
        geometry = subject_geometry(image)
    except Exception:  # noqa: BLE001 —— 模型挂了降级成「没主体」,走默认 50/50/1
        geometry = {"subjectBox": None, "faceBoxes": []}

    return {
        "v": PHOTO_PROFILE_VERSION,
        "subjectBox": geometry["subjectBox"],
        "faceBoxes": geometry["faceBoxes"],
        "maskKey": None,  # 建档不存 mask,真抠图时按需生成
        **color_features(image),
        **semantic_features(image),
    }
```

- [ ] **Step 4: 运行确认通过**

Run: `cd engine && .venv/bin/python -m pytest tests/test_profile_build.py -v`
Expected: PASS

- [ ] **Step 5: 加 `/internal/photo-profile` 路由**

在 `routes.py` 的 internal 段追加，鉴权和开关沿用 A1 的写法（`require_clip_bearer` + `agent_enable_clip_embeddings`）：

```python
class _PhotoProfileItem(BaseModel):
    photoId: str
    dataUrl: str


class _PhotoProfileRequest(BaseModel):
    images: list[_PhotoProfileItem]
    persistMask: bool = False


@router.post("/internal/photo-profile", dependencies=[Depends(require_clip_bearer)])
async def photo_profile(payload: _PhotoProfileRequest) -> dict:
    settings = get_settings()
    if not settings.agent_enable_clip_embeddings:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"ok": False, "error": {"code": "AGENT_NOT_FOUND", "message": "photo profile disabled"}},
        )

    from ..workflows.core.profile.build import build_profile

    profiles: dict[str, dict] = {}
    for item in payload.images:
        image = _decode_data_url(item.dataUrl)
        profiles[item.photoId] = await run_in_threadpool(build_profile, image)
    log.info("photo_profile", count=len(payload.images))
    return {"ok": True, "data": {"profiles": profiles}}
```

⚠️ `persistMask=true` 的分支（跑第二次推理、写 R2、回填 `maskKey`）**本任务不实现** —— 它依赖 B 线的 R2 写入口。先把参数收下、忽略，并在这里留一行注释指向 Task Z1。

补两个路由测试到 `test_internal_clip_route.py`：开关关闭返回 404、正常返回 `data.profiles` 且 key 是 photoId。

- [ ] **Step 6: 回填两个死字段**

`tree_builder.py:157` 的 `sceneDescription=""` 和 `:162` 的 `composition=None` 改成从档案取。找到这两行所在的函数，让它接受一个 `profiles: dict[str, dict] | None` 参数：

```python
                    sceneDescription=(profiles or {}).get(photo_id, {}).get("description", ""),
                    ...
                    composition=(profiles or {}).get(photo_id, {}).get("composition"),
```

⚠️ 变量名 `photo_id` 以该函数里实际的名字为准，打开文件看清楚再改。

⚠️ **必须保留「没有档案时退回原值」的行为** —— 存量书没有档案，回填不能让它们炸。

补一个测试：有档案时字段被填上、无档案时仍是 `""` / `None`。

- [ ] **Step 7: 接进 analyze 流程**

档案必须在 `select_layout` 之前算完，否则 `composition` 白填。在 analyze 的编排里（`src/workflows/analyze.py`）加一步：拿到照片后先批量建档，再进分簇和树构建。

关键约束：
- 档案调用**失败不能打挂 analyze** —— 包 try/except，失败则 `profiles = {}`，整条流程退回今天的行为
- 批大小参照 `_REMOTE_CLIP_BATCH_SIZE`，别一次发几百张
- base64 只在内存里，**不落盘不进日志**（`routes.py` 抬头的 Stateless 约定）

- [ ] **Step 8: 跑 engine 全量测试**

Run: `cd engine && .venv/bin/python -m pytest tests/ -q`
Expected: 全绿

- [ ] **Step 9: 提交**

```bash
git add engine/src/workflows/core/profile/build.py engine/src/api/routes.py \
        engine/src/workflows/core/chaptering/tree_builder.py \
        engine/src/workflows/analyze.py engine/tests/
git commit -m "$(cat <<'MSG'
feat(engine): 档案组装 + /internal/photo-profile + 回填两个死字段

三组合一,任一组失败都降级不抛。sceneDescription 和 composition 从
tree_builder 里写死的 ""/None 改成从档案取 —— composition 恒 None 让模板槽位的
构图约束在生产里一直没生效(slot_matcher 遇到 None 视作任意),这次一并还上。
无档案时退回原值,存量书不炸。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

# B 线 —— web 服务层（TypeScript）

**范围:** 只碰 `apps/web/src/db/**`、`apps/web/src/services/**`、`apps/web/src/app/api/v3/internal/**`。
**不碰 `apps/web/src/components/**`** —— 那是 UI，不在这批范围里。另两条线在同一个工作区并行。
`git add` 写精确路径，绝不 `git add -A`。

**测试命令:** `cd apps/web && npx tsx --test src/<path>/<file>.test.ts`（⚠️ 别在仓根跑 `pnpm test`，它会倒在 design-agent 的环境上，不是你的代码坏了）

---

## Task B1：`album_photos.profile` 列 + repo 读写

**Files:**
- Modify: `apps/web/src/db/schema.ts:358-379`（`albumPhotos` 表加列）
- Create: `apps/web/src/db/migrations/0032_photo_profile.sql`（手写，编号接 0031）
- Modify: `apps/web/src/db/repos/album-photo-repo.ts`
- Modify: `apps/web/src/db/repos/album-photo-repo.test.ts`

**Interfaces:**
- Consumes: `PhotoProfile` / `PhotoProfileSchema`（Task 0）
- Produces:
  - `albumPhotoRepo.setProfiles(albumId, profiles: Record<string, PhotoProfile>, tx?)` —— 批量写，只更新已存在的行
  - `albumPhotoRepo.findProfilesByAlbum(albumId, tx?): Promise<Record<string, PhotoProfile>>` —— 解析失败的行**跳过并 warn**，不抛

- [ ] **Step 1: 写失败测试**

```ts
// 追加到 apps/web/src/db/repos/album-photo-repo.test.ts
// （沿用该文件已有的测试库连接/清理写法，别另起一套）
import { PhotoProfileSchema } from '@yujee/contracts';

const sampleProfile = {
  v: 1 as const,
  subjectBox: { x: 10, y: 20, w: 50, h: 60 },
  faceBoxes: [],
  maskKey: null,
  colorTemp: 'warm' as const,
  brightness: 'mid' as const,
  saturation: 'normal' as const,
  dominantColors: ['#C8A05A'],
  composition: 'focal' as const,
  scene: 'outdoor' as const,
  peopleCount: '1' as const,
  mood: 'warm' as const,
  description: '海边',
};

test('setProfiles 写入后能读回，且过得了契约', async () => {
  // ...按本文件既有方式建 album + photo 行...
  await albumPhotoRepo.setProfiles(albumId, { p1: sampleProfile });
  const back = await albumPhotoRepo.findProfilesByAlbum(albumId);
  assert.deepEqual(PhotoProfileSchema.parse(back.p1), sampleProfile);
});

test('没有档案的行不出现在结果里', async () => {
  const back = await albumPhotoRepo.findProfilesByAlbum(albumId);
  assert.equal(back.p_never_profiled, undefined);
});

test('setProfiles 不会凭空造行', async () => {
  // 给一个不存在的 photoId 写档案 —— 应该静默跳过，不 INSERT。
  // 照片行的真相源是上传流程，档案只是给已有行贴附加信息。
  await albumPhotoRepo.setProfiles(albumId, { ghost: sampleProfile });
  const back = await albumPhotoRepo.findProfilesByAlbum(albumId);
  assert.equal(back.ghost, undefined);
});

test('库里存了坏档案时跳过该行，不打挂整次读取', async () => {
  // 直接用 raw SQL 塞一个形状不对的 jsonb（模拟 schema 演进后的旧数据）
  // 期望：findProfilesByAlbum 不抛，只是不返回这一条。
  // 理由：一张照片的坏档案不该让整本书打不开。
});

test('批量写多张只发一条语句', async () => {
  // 一本书 100 张照片，逐条 UPDATE 是 100 个 round trip。
  // 断言实现走的是单条批量语句（用 spy 或计数即可）。
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/web && npx tsx --test src/db/repos/album-photo-repo.test.ts`
Expected: FAIL —— `albumPhotoRepo.setProfiles is not a function`

- [ ] **Step 3: 加列 + 写迁移**

`schema.ts` 的 `albumPhotos` 表内追加（放在 `bytes` 之后、时间戳之前）：

```ts
    // 照片视觉档案(几何/色彩/语义三组)。契约:packages/contracts/src/photo-profile.ts
    // 存这里而不是 draft_json:档案是照片的属性,且 draft_json 被整体重写过(b4cba3f1)。
    // null = 还没建档(存量书 / 建档失败),读取方一律要能降级。
    profile: jsonb('profile').$type<PhotoProfile>(),
```

手写迁移 `apps/web/src/db/migrations/0032_photo_profile.sql`：

```sql
ALTER TABLE "album_photos" ADD COLUMN IF NOT EXISTS "profile" jsonb;
```

⚠️ **dev 库账本漂移，`pnpm db:migrate` 本地必失败** —— 手工把这条 SQL 应用到 dev 库，别在 drizzle-kit 上 debug。生产迁移按仓库既有流程走。

- [ ] **Step 4: 实现 repo 两个方法**

```ts
// apps/web/src/db/repos/album-photo-repo.ts 的 albumPhotoRepo 对象内追加

  /**
   * 批量写档案。**只更新已存在的行,不 INSERT** —— 照片行的真相源是上传流程,
   * 档案只是贴上去的附加信息;凭空造行会让 countByStatus 之类的统计错乱。
   */
  setProfiles: async (
    albumId: string,
    profiles: Record<string, PhotoProfile>,
    tx: DbOrTx = db,
  ): Promise<void> => {
    const entries = Object.entries(profiles);
    if (entries.length === 0) return;
    // 单条 UPDATE ... FROM (VALUES ...) —— 一本书上百张照片,逐条 UPDATE
    // 是上百个 round trip。
    const values = sql.join(
      entries.map(([photoId, profile]) => sql`(${photoId}, ${JSON.stringify(profile)}::jsonb)`),
      sql`, `,
    );
    await tx.execute(sql`
      UPDATE ${albumPhotos} AS p
         SET profile = v.profile, updated_at = now()
        FROM (VALUES ${values}) AS v(photo_id, profile)
       WHERE p.album_id = ${albumId} AND p.photo_id = v.photo_id
    `);
  },

  /**
   * 读全书档案。**坏档案跳过并 warn,不抛** —— 一张照片的坏数据不该让整本书打不开
   * (契约演进后旧行形状对不上是必然会发生的)。
   */
  findProfilesByAlbum: async (
    albumId: string,
    tx: DbOrTx = db,
  ): Promise<Record<string, PhotoProfile>> => {
    const rows = await tx
      .select({ photoId: albumPhotos.photoId, profile: albumPhotos.profile })
      .from(albumPhotos)
      .where(eq(albumPhotos.albumId, albumId));

    const out: Record<string, PhotoProfile> = {};
    for (const row of rows) {
      if (row.profile == null) continue;
      const parsed = PhotoProfileSchema.safeParse(row.profile);
      if (parsed.success) out[row.photoId] = parsed.data;
      else console.warn('[album-photo-repo] 跳过形状不合法的档案', { albumId, photoId: row.photoId });
    }
    return out;
  },
```

- [ ] **Step 5: 运行确认通过**

Run: `cd apps/web && npx tsx --test src/db/repos/album-photo-repo.test.ts`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/db/schema.ts apps/web/src/db/migrations/0032_photo_profile.sql \
        apps/web/src/db/repos/album-photo-repo.ts apps/web/src/db/repos/album-photo-repo.test.ts
git commit -m "$(cat <<'MSG'
feat(db): album_photos.profile 列 + 档案批量读写

存这里而不是 draft_json:档案是照片属性,且 draft_json 被整体重写过。
写只 UPDATE 不 INSERT(照片行真相源是上传流程);读遇到形状不合法的行跳过并 warn,
一张照片的坏档案不该让整本书打不开。批量写走单条 UPDATE...FROM(VALUES) 。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

## Task B2：engine 回调落库 + 档案对外读取

**Files:**
- Create: `apps/web/src/services/album/photo-profile-service.ts`
- Create: `apps/web/src/services/album/photo-profile-service.test.ts`
- Modify: `apps/web/src/app/api/v3/internal/agent-data/route.ts`（或新增专用 internal 路由 —— 照该目录既有鉴权写法）

**Interfaces:**
- Consumes: `albumPhotoRepo.setProfiles` / `findProfilesByAlbum`（B1）
- Produces:
  - `savePhotoProfiles(albumId, profiles: unknown): Promise<{ saved: number; skipped: number }>` —— **逐条校验，坏的跳过不整批拒**
  - `getPhotoProfiles(albumId): Promise<Record<string, PhotoProfile>>`

- [ ] **Step 1: 写失败测试**

```ts
// apps/web/src/services/album/photo-profile-service.test.ts
test('逐条校验：一条坏的不会让整批失败', async () => {
  const result = await savePhotoProfiles(albumId, {
    good: sampleProfile,
    bad: { v: 1, colorTemp: 'chartreuse' },
  });
  assert.equal(result.saved, 1);
  assert.equal(result.skipped, 1);
  // 理由：engine 那边一张照片解析异常是常态，整批拒会让整本书没档案。
});

test('带位置字段的档案整条拒收', async () => {
  const result = await savePhotoProfiles(albumId, {
    leaky: { ...sampleProfile, gps: '31.2,121.4' },
  });
  assert.equal(result.saved, 0);
  // 隐私红线：不是剥掉那个字段就收下，是整条不要。剥字段等于默许上游继续发。
});

test('空输入是合法的 no-op', async () => {
  assert.deepEqual(await savePhotoProfiles(albumId, {}), { saved: 0, skipped: 0 });
});

test('非对象输入不抛，记 skipped', async () => {
  assert.equal((await savePhotoProfiles(albumId, 'nonsense')).saved, 0);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/web && npx tsx --test src/services/album/photo-profile-service.test.ts`
Expected: FAIL —— 模块不存在

- [ ] **Step 3: 实现 service**

要点（照着写，别简化）：

- 逐条 `PhotoProfileSchema.safeParse`，成功的收集、失败的计数，**不整批拒**
- 位置字段由 `.strict()` 自动拒掉 —— 不要在 service 里手动剥字段
- 落库走 `albumPhotoRepo.setProfiles`
- 返回 `{ saved, skipped }` 供回调路由记日志

- [ ] **Step 4: 加 internal 回调路由**

engine 建完档要把结果送回来。照 `apps/web/src/app/api/v3/internal/` 目录既有的鉴权方式（shared secret bearer）加一个口，body 形状对齐 A5 的响应：`{ albumId, profiles: { [photoId]: profile } }`。

⚠️ 这个口是 internal 的，**必须校验 shared secret**，照抄同目录 `job-progress/route.ts` 的鉴权，别自创。

- [ ] **Step 5: 运行确认通过 + 提交**

Run: `cd apps/web && npx tsx --test src/services/album/photo-profile-service.test.ts`

```bash
git add apps/web/src/services/album/photo-profile-service.ts \
        apps/web/src/services/album/photo-profile-service.test.ts \
        apps/web/src/app/api/v3/internal/
git commit -m "$(cat <<'MSG'
feat(album): 照片档案落库 service + engine 回调口

逐条校验:一条坏档案不让整批失败(engine 侧单张解析异常是常态)。
带位置字段的档案整条拒收,不剥字段 —— 剥了等于默许上游继续发。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

## Task B3：design-agent 的滤镜写入 seam（跨存储 + OCC）

**这是 B 线风险最高的任务。** 滤镜在 `albums.photo_filter` 列走 `settingsRevision`，页面在 `draft_json` 走页面 `version` —— design-agent 现在只有后一条路。协同八包刚上，这里最容易并发脏写。

**Files:**
- Modify: `apps/web/src/services/album/album-service.ts`（复用 `lockAlbumForSettingsWrite`，别另写锁）
- Create: `apps/web/src/services/album/agent-photo-filter.ts`
- Create: `apps/web/src/services/album/agent-photo-filter.test.ts`

**Interfaces:**
- Produces:
  - `applyAgentPhotoFilter(userId, albumId, patch, baseSettingsRevision)` —— 供 design-agent 的工具调用层用
  - patch 形状：`{ default?: PhotoFilterRef | null; overrides?: Record<string, PhotoFilterRef | null>; cutouts?: Record<string, true | null> }`
    （`cutouts` 里的 `null` 表示**删键**，序列化到存储时绝不写 `false`）

- [ ] **Step 1: 写失败测试**

```ts
test('滤镜写入走 settingsRevision，不碰页面 version', async () => {
  const before = await getAlbum(albumId);
  await applyAgentPhotoFilter(userId, albumId, { default: { lutId: 'travel-cinematic', strength: 60 } }, before.settingsRevision);
  const after = await getAlbum(albumId);
  assert.equal(after.settingsRevision, before.settingsRevision + 1);
  assert.equal(after.pages[0].version, before.pages[0].version); // 页面 version 不动
});

test('settingsRevision 失配 409，零写入', async () => {
  const before = await getAlbum(albumId);
  await assert.rejects(
    () => applyAgentPhotoFilter(userId, albumId, { default: null }, before.settingsRevision - 1),
    /SETTINGS_CONFLICT/,
  );
  const after = await getAlbum(albumId);
  assert.deepEqual(after.photoFilter, before.photoFilter); // 真的零写入
});

test('关抠图是删键，存储里绝不出现 false', async () => {
  await applyAgentPhotoFilter(userId, albumId, { cutouts: { p1: true } }, rev0);
  await applyAgentPhotoFilter(userId, albumId, { cutouts: { p1: null } }, rev1);
  const raw = JSON.stringify((await getAlbum(albumId)).photoFilter);
  assert.ok(!raw.includes('false'), 'cutouts 只认 true，关掉是删键');
  assert.ok(!raw.includes('"p1"'));
});

test('全关之后连 cutouts 这个壳一起删掉', async () => {
  const filter = (await getAlbum(albumId)).photoFilter;
  assert.equal(filter?.cutouts, undefined); // 不留空对象
});

test('strength 过 quantizeStrength', async () => {
  await applyAgentPhotoFilter(userId, albumId, { default: { lutId: 'retro-film', strength: 63 } }, rev);
  assert.equal((await getAlbum(albumId)).photoFilter?.default?.strength, 65);
});

test('非成员被拒', async () => {
  await assert.rejects(
    () => applyAgentPhotoFilter(strangerId, albumId, { default: null }, rev),
    /ACCESS_DENIED/,
  );
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/web && npx tsx --test src/services/album/agent-photo-filter.test.ts`

- [ ] **Step 3: 实现**

硬性要求：

- **必须在 `db.transaction` 内调 `lockAlbumForSettingsWrite`**（`album-service.ts:439`），拿锁内的 album 行再写 —— 不要自己写行锁，那道防线是协同 OCC 的一部分
- 写之前把 patch 合并进现有 `PhotoFilterState`，然后过 `normalizePhotoFilterState`
- `cutouts` 的 `null` 走 `toggleCutout` 的删键语义；全空时连 `cutouts` 键一起删
- 写完推进 `settingsRevision + 1`
- **不碰 `draft_json`，不碰任何页面 `version`**

- [ ] **Step 4: 运行确认通过 + 提交**

```bash
git add apps/web/src/services/album/agent-photo-filter.ts apps/web/src/services/album/agent-photo-filter.test.ts
git commit -m "$(cat <<'MSG'
feat(album): Agent 写滤镜的跨存储 seam

滤镜在 albums.photo_filter 走 settingsRevision,页面在 draft_json 走页面 version
—— 两套 OCC 各走各的,这个 seam 只碰前者。锁复用 lockAlbumForSettingsWrite,
不自写行锁(那是协同 OCC 的防线)。关抠图走删键,存储里绝不出现 false。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

## Task B4：分享快照护栏

Agent 一句「整本调成旅行大片」会让全书 `renderVersion` 失配，用户得重新备份全书，还撞 300 张上限。不能静默发生。

**Files:**
- Modify: `apps/web/src/services/album/agent-photo-filter.ts`
- Modify: `apps/web/src/services/album/agent-photo-filter.test.ts`

**Interfaces:**
- Produces: `applyAgentPhotoFilter` 的返回值加 `warnings: string[]`，供工具层塞进给模型的 `notes`

- [ ] **Step 1: 写失败测试**

```ts
test('书有已发布分享时，返回 warning 说明会失配', async () => {
  await createShare(albumId);
  const result = await applyAgentPhotoFilter(userId, albumId, { default: { lutId: 'night-film', strength: 50 } }, rev);
  assert.ok(result.warnings.some((w) => w.includes('分享')));
});

test('没有分享时不产生噪音 warning', async () => {
  const result = await applyAgentPhotoFilter(userId, albumId, { default: null }, rev);
  assert.deepEqual(result.warnings, []);
});

test('warning 不阻断写入', async () => {
  await createShare(albumId);
  const result = await applyAgentPhotoFilter(userId, albumId, { default: { lutId: 'night-film', strength: 50 } }, rev);
  assert.equal(result.warnings.length > 0, true);
  assert.equal((await getAlbum(albumId)).photoFilter?.default?.lutId, 'night-film');
  // 小雨拍板 Agent 全权：告知，不阻断。
});

test('只改了不影响 renderVersion 的东西时不 warning', async () => {
  // 如果 patch 实际没有改变任何照片的 effectiveRenderVersion，就别吓唬用户。
});
```

- [ ] **Step 2-4: 实现 → 跑绿 → 提交**

实现要点：写入前用 `effectiveRenderVersion` 算出「这次 patch 会让哪些 photoId 的版本串变化」，若变化集非空**且**该书存在已发布 share，产出一条中文 warning，说明「这本书已经分享过，改了滤镜后分享页会失配，需要重新备份全书」。

```bash
git commit -m "$(cat <<'MSG'
feat(album): Agent 改滤镜时对已分享的书发出警告

改滤镜会让全书 renderVersion 失配,已发布的分享页需要重新备份全书(还撞
300 张上限)。按小雨拍板的「Agent 全权」:告知不阻断,warning 走工具 notes
让 Agent 在回复里说清楚。没分享的书不产生噪音。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

# C 线 —— design-agent（TypeScript）

**范围:** 只碰 `packages/design-agent/**`。另两条线在同一个工作区并行，碰它们的目录会撞车。
`git add` 写精确路径，绝不 `git add -A`。

**测试命令:** `cd packages/design-agent && npx tsx --test test/<file>.test.ts`；全量 `pnpm design:test`

**本地起界面自查:** `pnpm design:album`（⚠️ 是 `design:album`，不是 `design:dev`）

---

## Task C1：书状态装档案与滤镜，read_page 扩字段

**Files:**
- Modify: `packages/design-agent/src/core/album/book-state.ts`（`AlbumChapterPhoto` 加 `profile`；`AlbumBookState` 加 `photoFilter`）
- Modify: `packages/design-agent/src/core/album/tools.ts:276-322`（`readPagePayload`）
- Modify: `packages/design-agent/test/album-tools.test.ts`

**Interfaces:**
- Consumes: `PhotoProfile`（Task 0）、`PhotoFilterState`（既有）
- Produces: `read_page` 返回的 `images[slotId]` 多出 `profile`（档案摘要，**不含 maskKey**）、`imagePos`（当前值）、`filter`（当前生效 LUT + 是否抠图）

- [ ] **Step 1: 写失败测试**

```ts
// packages/design-agent/test/album-tools.test.ts 追加
test('read_page 吐出照片档案，Agent 不再是瞎的', async () => {
  const tools = createAlbumTools(optionsWithProfiles);
  const result = await run(tools, 'read_page', { pageNos: [1] });
  const slot = JSON.parse(result.content[0].text).pages[0].images.image1;
  assert.equal(slot.profile.composition, 'focal');
  assert.equal(slot.profile.subjectBox.x, 10);
});

test('read_page 不把 maskKey 喂给模型', () => {
  // maskKey 是存储实现细节，对模型决策零价值，只占上下文。
  const slot = readSlot();
  assert.equal(slot.profile.maskKey, undefined);
});

test('read_page 吐出当前 imagePos', () => {
  assert.deepEqual(readSlot().imagePos, { x: 30, y: 40, scale: 1.2 });
});

test('没设过 imagePos 的槽显式吐默认值，而不是省略', () => {
  // 省略会让模型以为「这个槽不支持调位置」。
  assert.deepEqual(readSlotWithoutPos().imagePos, { x: 50, y: 50, scale: 1 });
});

test('read_page 吐出当前生效的滤镜与抠图状态', () => {
  const slot = readSlot();
  assert.deepEqual(slot.filter, { lutId: 'travel-cinematic', strength: 60, cutout: false });
});

test('没有档案的照片不炸，profile 为 undefined', () => {
  // 存量书没建过档 —— 这条路径必须活着。
  assert.equal(readSlotOfLegacyPhoto().profile, undefined);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/design-agent && npx tsx --test test/album-tools.test.ts`

- [ ] **Step 3: 实现**

`book-state.ts`：

```ts
export interface AlbumChapterPhoto {
	photoId: string;
	sceneDescription: string;
	orientation?: string;
	composition?: string | null;
	takenAt?: string | null;
	width?: number;
	height?: number;
	/** 照片视觉档案(几何/色彩/语义)。存量书没有 => undefined,所有读取方必须能降级。 */
	profile?: PhotoProfile;
}

export interface AlbumBookState {
	chapters: AlbumChapter[];
	pages: AlbumPage[];
	version: number;
	updatedAt: string;
	brief?: AlbumBookBrief;
	/** 全书滤镜/抠图状态。**存在 albums.photo_filter 列,不在 draft_json 里** ——
	 * 写它要走 settingsRevision 那套 OCC,不能混进 commitWrite。 */
	photoFilter?: PhotoFilterState | null;
}
```

⚠️ `cloneAlbumBookState` 和 `clonePage` 要同步处理新字段，否则工具写入时会丢档案。

`readPagePayload` 的 `images` 映射改成：

```ts
		images: Object.fromEntries(
			Object.entries(page.images).map(([slotId, photoId]) => {
				const photo = findAlbumPhoto(state, photoId);
				const { maskKey: _dropped, ...profile } = photo?.profile ?? {};
				return [
					slotId,
					{
						photoId,
						sceneDescription: photo?.sceneDescription ?? "",
						orientation: photo?.orientation,
						takenAt: photo?.takenAt ?? undefined,
						// 档案:Agent 判断调色/裁切/抠图的唯一输入。maskKey 是存储细节,
						// 对模型零价值,只占上下文 —— 剥掉。
						...(photo?.profile ? { profile } : {}),
						// 当前位置。**没设过也显式给默认值** —— 省略会让模型以为这个槽
						// 不支持调位置。
						imagePos: page.imagePos?.[slotId] ?? { x: 50, y: 50, scale: 1 },
						filter: {
							...(resolveEffectiveFilter(state.photoFilter, photoId) ?? {}),
							cutout: isCutout(state.photoFilter, photoId),
						},
					},
				];
			}),
		),
```

- [ ] **Step 4: 跑绿 + 提交**

```bash
cd packages/design-agent && npx tsx --test test/album-tools.test.ts
git add packages/design-agent/src/core/album/ packages/design-agent/test/album-tools.test.ts
git commit -m "$(cat <<'MSG'
feat(design-agent): 书状态装档案与滤镜,read_page 让 Agent 看见照片

在这之前 Agent 对照片内容一无所知:sceneDescription 恒空、没有任何视觉输入。
现在每个图槽带档案(几何/色彩/语义)、当前 imagePos、当前滤镜与抠图状态。
maskKey 剥掉不喂模型;没设过的 imagePos 显式给默认值而不是省略。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

## Task C2：`set_image_pos` —— 构图裁切

**核心原则：几何归代码，模型只表达意图。**

⚠️ **一个已查证的限制，直接决定本任务的算法选型**：槽位的宽高比在 `CatalogImageSlotDef`（只有 id/orientation/quality/composition）和模板 JSON（只有槽 id）里**都没有**，只存在于 HTML 模板的 CSS 里。所以本任务用**不需要槽位宽高比的近似解**：

- `object-position: p%` 的语义是「图片的 p% 点对齐容器的 p% 点」
- 令 `p = 主体中心的百分比`，可保证**主体一定落在可见区域内**（p=50 时精确居中；主体越靠边，它在可见窗口里也越靠边，但不会被裁掉）
- 「精确把主体推到容器正中」需要 `R = 照片宽高比 / 槽位宽高比`，而槽位宽高比拿不到

**这个近似对「别切脸」这个真实目标是够用的。** 若 Task Z1 验收发现居中不够准，再上精确解 —— 前置条件是给 `templates:generate` 加一步「渲染模板量出每个槽的宽高，写进 templates.generated.ts」。**本任务不做那件事。**

**Files:**
- Create: `packages/design-agent/src/core/album/image-fit.ts`
- Create: `packages/design-agent/test/image-fit.test.ts`
- Modify: `packages/design-agent/src/core/album/tools.ts`（注册工具）
- Modify: `packages/design-agent/test/album-tools.test.ts`

**Interfaces:**
- Produces:
  - `resolveImagePos(fit: 'center-subject' | 'avoid-face-crop' | 'fill', profile?: PhotoProfile): { x: number; y: number; scale: number }` —— 纯函数
  - 工具 `set_image_pos`，入参见 spec §4.3

- [ ] **Step 1: 写几何纯函数的失败测试**

```ts
// packages/design-agent/test/image-fit.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveImagePos } from '../src/core/album/image-fit.ts';

const profile = (over = {}) => ({
  v: 1, subjectBox: { x: 10, y: 20, w: 40, h: 40 }, faceBoxes: [], maskKey: null,
  colorTemp: 'warm', brightness: 'mid', saturation: 'normal', dominantColors: [],
  composition: 'focal', scene: 'outdoor', peopleCount: '1', mood: 'warm', description: '',
  ...over,
});

test('center-subject 把 object-position 落在主体中心', () => {
  // subjectBox x=10 w=40 => 中心 30；y=20 h=40 => 中心 40
  assert.deepEqual(resolveImagePos('center-subject', profile()), { x: 30, y: 40, scale: 1 });
});

test('没有档案时退回默认，绝不瞎猜', () => {
  assert.deepEqual(resolveImagePos('center-subject', undefined), { x: 50, y: 50, scale: 1 });
});

test('subjectBox 为 null（纯风景）时退回默认', () => {
  assert.deepEqual(resolveImagePos('center-subject', profile({ subjectBox: null })), { x: 50, y: 50, scale: 1 });
});

test('fill 永远是 50/50/1，不看档案', () => {
  assert.deepEqual(resolveImagePos('fill', profile()), { x: 50, y: 50, scale: 1 });
});

test('avoid-face-crop 用所有人脸的并集中心', () => {
  const p = profile({ faceBoxes: [{ x: 10, y: 10, w: 10, h: 10 }, { x: 50, y: 30, w: 10, h: 10 }] });
  // 并集 x:10..60 => 中心 35；y:10..40 => 中心 25
  assert.deepEqual(resolveImagePos('avoid-face-crop', p), { x: 35, y: 25, scale: 1 });
});

test('avoid-face-crop 没有脸时退回 center-subject', () => {
  assert.deepEqual(resolveImagePos('avoid-face-crop', profile()), { x: 30, y: 40, scale: 1 });
});

test('avoid-face-crop 既没脸也没主体时退回默认', () => {
  assert.deepEqual(
    resolveImagePos('avoid-face-crop', profile({ subjectBox: null })),
    { x: 50, y: 50, scale: 1 },
  );
});

test('结果永远被夹在 0-100，且 scale 不小于 1', () => {
  const p = profile({ subjectBox: { x: 95, y: 95, w: 20, h: 20 } });
  const out = resolveImagePos('center-subject', p);
  assert.ok(out.x >= 0 && out.x <= 100 && out.y >= 0 && out.y <= 100);
  assert.ok(out.scale >= 1);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/design-agent && npx tsx --test test/image-fit.test.ts`

- [ ] **Step 3: 实现纯函数**

```ts
// packages/design-agent/src/core/album/image-fit.ts
/**
 * 意图 -> imagePos。**几何归代码,模型只表达意图** —— LLM 心算坐标必错,
 * 而且错得没规律、测不出来。
 *
 * ⚠️ 这是个近似解:精确地把主体推到容器正中需要「照片宽高比 / 槽位宽高比」,
 * 而槽位宽高比在 catalog 和模板 JSON 里都没有(只在 HTML 模板的 CSS 里)。
 * 令 object-position = 主体中心,可保证**主体一定落在可见区域内** —— 对
 * 「别切脸」这个真实目标够用。要精确居中,得先给 templates:generate 加一步
 * 量出槽位宽高。
 */

import type { PhotoProfile } from "@yujee/contracts";

export type ImageFit = "center-subject" | "avoid-face-crop" | "fill";

export interface ImagePosValue {
	x: number;
	y: number;
	scale: number;
}

const DEFAULT_POS: ImagePosValue = { x: 50, y: 50, scale: 1 };

const clampPct = (value: number): number => Math.min(100, Math.max(0, value));

function centerOf(box: { x: number; y: number; w: number; h: number }): { x: number; y: number } {
	return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

/** 多个人脸的并集包围盒 —— 目标是「所有脸都别被裁」,不是「第一张脸居中」。 */
function unionBox(boxes: Array<{ x: number; y: number; w: number; h: number }>) {
	const left = Math.min(...boxes.map((b) => b.x));
	const top = Math.min(...boxes.map((b) => b.y));
	const right = Math.max(...boxes.map((b) => b.x + b.w));
	const bottom = Math.max(...boxes.map((b) => b.y + b.h));
	return { x: left, y: top, w: right - left, h: bottom - top };
}

export function resolveImagePos(fit: ImageFit, profile?: PhotoProfile): ImagePosValue {
	if (fit === "fill") return { ...DEFAULT_POS };

	if (fit === "avoid-face-crop" && profile?.faceBoxes?.length) {
		const center = centerOf(unionBox(profile.faceBoxes));
		return { x: clampPct(center.x), y: clampPct(center.y), scale: 1 };
	}

	// avoid-face-crop 没找到脸 => 退到 center-subject(而不是直接默认):
	// 没检测到脸不等于没主体。
	const box = profile?.subjectBox;
	if (!box) return { ...DEFAULT_POS };

	const center = centerOf(box);
	return { x: clampPct(center.x), y: clampPct(center.y), scale: 1 };
}
```

- [ ] **Step 4: 跑绿**

Run: `cd packages/design-agent && npx tsx --test test/image-fit.test.ts`
Expected: PASS，8 个用例全绿

- [ ] **Step 5: 注册 `set_image_pos` 工具**

照 `tools.ts` 里 `update_page_images`（:670）的结构写：typebox schema、`prepareArguments` 做用户口径页码换算（走 `resolveRefToInternal`）、`execute` 里先整批校验再改状态、最后 `commitWrite`。

工具描述（给模型看的，逐字用）：

```
"调整照片在框里的位置和缩放。**优先用 fit 意图**（center-subject=主体居中、avoid-face-crop=别切到脸、fill=铺满不特意对齐），工具会根据照片档案自动算出坐标；只有用户明确说了方向（“往左一点”“再拉近些”）才直接传 x/y/scale。x/y 是 0-100 的百分比，scale ≥ 1。"
```

必须覆盖的测试：

```ts
test('fit 意图会被工具解析成具体坐标', async () => { /* 传 fit，断言写进 state 的是算好的数字 */ });
test('槽 id 不属于该模板时整批拒绝，不改状态', async () => { /* 与 update_page_images 同一道防线 */ });
test('scale < 1 被拒', async () => { /* cover 语义下 scale<1 会露底 */ });
test('x/y 超出 0-100 被拒', async () => {});
test('用户口径页码正确换算（含双宽页）', async () => { /* isSpread 必须传，漏传会少号 */ });
test('写入不碰 texts 和 templateId', async () => {});
```

- [ ] **Step 6: 跑全量 + 提交**

```bash
cd packages/design-agent && npx tsx --test test/*.test.ts
git add packages/design-agent/src/core/album/image-fit.ts packages/design-agent/src/core/album/tools.ts \
        packages/design-agent/test/image-fit.test.ts packages/design-agent/test/album-tools.test.ts
git commit -m "$(cat <<'MSG'
feat(design-agent): set_image_pos —— 构图裁切,几何归代码

模型只表达意图(center-subject / avoid-face-crop / fill),坐标由工具层拿档案的
subjectBox/faceBoxes 算 —— LLM 心算坐标必错且测不出来。
近似解:object-position 落在主体中心,保证主体落在可见区内;精确居中需要槽位
宽高比,而 catalog 和模板 JSON 里都没有,留给将来。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

## Task C3 + C4：`set_photo_filter` 与 `set_photo_cutout`

两个工具共用同一条跨存储写入路径（B3 的 `applyAgentPhotoFilter`），放一个任务里做。

**Files:**
- Modify: `packages/design-agent/src/core/album/tools.ts`
- Modify: `packages/design-agent/src/core/album/book-state.ts`（`AlbumToolsOptions` 加 seam）
- Create: `packages/design-agent/test/album-photo-filter-tools.test.ts`

**Interfaces:**
- Consumes: B3 的 `applyAgentPhotoFilter`，经由 `AlbumToolsOptions` 注入：
  ```ts
  export interface AlbumToolsOptions {
  	catalog: TemplateCatalog;
  	getBookState: () => AlbumBookState;
  	setBookState: (state: AlbumBookState) => void;
  	now?: () => Date;
  	skills?: Skill[];
  	/** 滤镜/抠图走 albums.photo_filter + settingsRevision,**不走 commitWrite** ——
  	 * 两套存储两套 OCC,混在一起必并发脏写。未注入时两个工具不注册。 */
  	applyPhotoFilter?: (patch: PhotoFilterPatch) => Promise<{ warnings: string[] }>;
  }
  ```

- [ ] **Step 1: 写失败测试**

```ts
test('set_photo_filter 走 applyPhotoFilter seam，不走 commitWrite', async () => {
  const calls: unknown[] = [];
  const tools = createAlbumTools({ ...base, applyPhotoFilter: async (p) => { calls.push(p); return { warnings: [] }; } });
  await run(tools, 'set_photo_filter', { default: { lutId: 'travel-cinematic', strength: 60 } });
  assert.equal(calls.length, 1);
  assert.equal(setBookStateSpy.callCount, 0); // 页面状态一动不动
});

test('没注入 seam 时不注册这两个工具', () => {
  const names = createAlbumTools(base).map((t) => t.name);
  assert.ok(!names.includes('set_photo_filter'));
  // 宁可没有这个能力，也不能让模型调一个写不进去的工具。
});

test('未知 lutId 被拒，错误里带可用清单', async () => {
  await assert.rejects(() => run(tools, 'set_photo_filter', { default: { lutId: 'vaporwave', strength: 50 } }),
    /cloudy-cool|可用/);
  // 模型编了个滤镜名时，要能自己改对，不能只说"错了"。
});

test('warnings 进工具结果的 notes，让 Agent 转告用户', async () => {
  const tools = createAlbumTools({ ...base, applyPhotoFilter: async () => ({ warnings: ['这本书已分享…'] }) });
  const result = await run(tools, 'set_photo_filter', { default: null });
  assert.ok(JSON.parse(result.content[0].text).notes.some((n: string) => n.includes('已分享')));
});

test('set_photo_cutout 关掉时传 null（删键），绝不传 false', async () => {
  const calls: any[] = [];
  const tools = createAlbumTools({ ...base, applyPhotoFilter: async (p) => { calls.push(p); return { warnings: [] }; } });
  await run(tools, 'set_photo_cutout', { photoIds: ['p1'], on: false });
  assert.equal(calls[0].cutouts.p1, null);
  assert.notEqual(calls[0].cutouts.p1, false); // 契约铁律
});

test('set_photo_cutout 一次可以处理多张', async () => {});

test('抠图工具描述里写明不做整本默认全抠', () => {
  const tool = createAlbumTools(withSeam).find((t) => t.name === 'set_photo_cutout');
  assert.ok(/不要|别|逐张/.test(tool.description));
});
```

- [ ] **Step 2-4: 跑红 → 实现 → 跑绿**

实现要点：

- 两个工具都**不调 `commitWrite`** —— 它们不改书状态，只调 seam
- `set_photo_filter` 的 `lutId` 用 `LUT_DEFINITIONS` 生成 enum，拒绝时把可用 id 列出来
- `set_photo_cutout` 的 `on: false` → patch 里写 `null`（删键语义），**绝不写 `false`**
- seam 返回的 `warnings` 原样进工具结果的 `notes`

工具描述（逐字用）：

```
set_photo_filter:
"给整本书定调色（26 个胶片滤镜），也可以给单张照片单独指定。先读照片档案里的
colorTemp/brightness/mood 再选，别凭书名猜。strength 是 0-100，一般 50-70 之间；
超过 80 会明显失真。"

set_photo_cutout:
"把照片主体从背景里抠出来（用于主体叠加类版式）。**逐张开，不要整本默认全抠** ——
抠图会改变照片观感，用户没要求就别动。开了之后要在回复里说清楚改了哪几张。"
```

- [ ] **Step 5: 提交**

```bash
git commit -m "$(cat <<'MSG'
feat(design-agent): set_photo_filter / set_photo_cutout

两个工具走独立的 applyPhotoFilter seam(albums.photo_filter + settingsRevision),
不走 commitWrite —— 页面和设置是两套存储两套 OCC,混在一起必并发脏写。
seam 未注入时不注册工具:宁可没这个能力,也不能让模型调一个写不进去的工具。
关抠图传 null 走删键,绝不传 false(契约铁律)。分享失配 warning 进 notes。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

## Task C5：`look_at_photos` 兜底 + 清掉 sceneDescription 死账

**Files:**
- Modify: `packages/design-agent/src/core/album/tools.ts`（新工具 + `search_book` 修正）
- Modify: `packages/design-agent/src/core/album/skills.ts:41`
- Modify: `packages/design-agent/test/album-tools.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
test('look_at_photos 一次最多 6 张', async () => {
  await assert.rejects(() => run(tools, 'look_at_photos', { photoIds: sevenIds }), /6/);
  // 真图进上下文很贵；#307 刚因为这个把整页 HTML 改成默认不发。
});

test('工具描述写明这是兜底，不是默认输入', () => {
  const tool = tools.find((t) => t.name === 'look_at_photos');
  assert.ok(/档案|先读|兜底/.test(tool.description));
});

test('search_book 能搜到档案里的描述', async () => {
  // 修死账：sceneDescription 恒空，这条分支一直搜不到东西。
  const result = await run(tools, 'search_book', { query: '海边' });
  assert.ok(JSON.parse(result.content[0].text).totalMatches > 0);
});

test('skills 里不再教 Agent 用 sceneDescription 这个死字段', () => {
  const text = JSON.stringify(albumSkills);
  assert.ok(!text.includes('sceneDescription'), '这个字段在 engine 侧恒空，指令是空转');
});
```

- [ ] **Step 2-4: 跑红 → 实现 → 跑绿**

要点：

- `look_at_photos` 上限 6 张，超了直接拒（真图进上下文很贵）
- `search_book` 的照片搜索分支改成搜 `profile.description`（有档案时）**并保留** `sceneDescription`（存量书回填后也有值）
- `skills.ts:41` 那句「照片描述（sceneDescription）」改成指向档案：说明模型能从 `read_page` 的 `images[slot].profile` 看到照片内容

- [ ] **Step 5: 提交**

```bash
git commit -m "$(cat <<'MSG'
feat(design-agent): look_at_photos 兜底 + 清掉 sceneDescription 死账

看真图是兜底不是默认输入,一次最多 6 张(#307 刚因为上下文把整页 HTML 改成
默认不发)。顺带清账:skills 里教模型用 sceneDescription,而这个字段在 engine
侧恒空,指令一直是空转;search_book 的照片搜索分支也一直搜不到东西。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

# 汇合

## Task Z1：三线合并 + 端到端验收

**前置：** A/B/C 三线各自全绿（三线直接提交在 main 上，无需合并分支）。

- [ ] **Step 1: 三套测试各跑一遍，确认三线互不干扰**

Run:
```bash
cd apps/web && npx tsx --test "src/**/*.test.ts"
cd engine && .venv/bin/python -m pytest tests/ -q
pnpm design:test
```
Expected: 三套全绿。⚠️ 仓根 `pnpm test` 会倒在 design-agent 环境上，别拿它当判据。

- [ ] **Step 2: 补上 `persistMask=true` 分支**

A5 推迟了这一段（它依赖 B 线的 R2 写入口）。现在两边都在了，补齐：

- `POST /internal/photo-profile` 收到 `persistMask=true` 时，对指定照片跑 `subject_mask`，把 mask 写 R2，回填 `maskKey`
- web 侧在 `set_photo_cutout` 开启某张照片时触发这条路径
- 测试：开抠图后 `maskKey` 非空；关抠图不删 mask（下次再开可复用）

- [ ] **Step 3: 端到端跑一本真书**

用 `~/Desktop/大片/` 里的真照片（8 月验证抠图用的那批棚拍人像也在），走完整流程：

1. 上传 → 确认 `album_photos.profile` 有值，字段齐全
2. 确认 `composition` 不再是 `None` —— 检查选版时槽位构图约束真的在起作用
3. 跟 Agent 说「整本调成旅行大片的感觉」→ 看 LUT 是否合理、是否有分享 warning
4. 跟 Agent 说「这几页的人脸被切了，调一下」→ 看 `imagePos` 是否真的把脸救回来
5. 跟 Agent 说「把这张的主体抠出来」→ 看抠图质量

- [ ] **Step 4: 眼睛看，不许拿指标糊弄**

⚠️ **8 月那次自动抠图评估的教训**：第一版脚本用「保留主体百分比」当判据，5 张全报「✓ 48%」，实际全是残废（头发啃成噪点、脸上斜切缝、西装大块消失）。**这种事只能眼睛看。**

逐张过一遍，明确判定：

- 抠图：有没有把脸/头发啃出缺口？棚拍人像过不了，随手拍只会更糟
- 裁切：人脸有没有被切？主体是不是还在画面里？
- 调色：整本气质对不对？有没有哪张明显被调难看了？

- [ ] **Step 5: 导出对照**

导出验证走**浏览器取证法** —— esbuild 打包真管线 + playwright 对照原生渲染。**mock 测不出真 bug**（这是仓库既有教训）。

重点核对：
- Agent 改过 `imagePos` 的页，导出 PDF 里位置跟画板一致
- 抠图过的照片，导出里是抠过的
- 滤镜在导出里生效且强度一致

- [ ] **Step 6: 派 review agent 评审整个 diff**

按仓库交付流程：实现 → review agent 评审 diff → 逐项修复并验证 → 全部通过才算完。

评审重点交代给 agent：
- 跨存储写入有没有绕过 `lockAlbumForSettingsWrite`
- 有没有哪条路径把 `cutouts` 写成了 `false`
- 坐标口径有没有 0-100 / 0-1 混用
- 隐私红线的三道闸（提示词 / schema strict / service 拒收）是否都在
- 存量书（无档案）的降级路径是否每一处都活着

- [ ] **Step 7: 更新记忆**

把这批的关键事实写进项目记忆，特别是：
- `sceneDescription` / `composition` 恒空这个账已还（避免以后又误诊）
- 槽位宽高比拿不到、`fit` 是近似解这件事（避免以后有人以为是 bug）
- CLIP worker 的 `/internal/open-clip/embeddings` 曾经缺失（生产 analyze 的隐患已修）

---

# 自审记录

**Spec 覆盖检查：**

| Spec 章节 | 对应任务 |
|---|---|
| §4.1 PhotoProfile 契约 | Task 0 |
| §4.2 回填 composition / sceneDescription | A5 Step 6、C5 |
| §4.3 四个工具签名 | C2、C3+C4、C5 |
| §4.4 语义归模型几何归代码 | C2（`resolveImagePos` 纯函数 + 意图模式） |
| §5 A 线 | A0-A5 |
| §5 B 线 | B1-B4 |
| §5 C 线 | C1-C5 |
| §6① 分享快照护栏 | B4 |
| §6② 跨存储双 OCC | B3、C3+C4（seam 未注入不注册工具） |
| §6③ 用户手调被抹（已拍板接受） | 无任务 —— 这是**有意不做**，Z1 Step 4 的验收标准替代它 |
| §6④ 抠图产品下限 | C3+C4 的工具描述 + Z1 Step 4 眼睛看 |
| §6⑤ rotate 契约不一致 | **缺口，见下** |
| §7 明确不做 | 全程遵守 |

**发现并已补的缺口：**

- **§6⑤（`rotate` 字段两处契约不一致）没有对应任务。** 处理方式：本批**不动 rotate** —— `set_image_pos` 的 schema 只收 `x/y/scale`，不收 `rotate`，也不改任何现有 rotate 行为。`page-html-dom.ts` 那个多出来的 `rotate?: number` 保持原样。理由：它跟本批的三个能力无关，混进来只会扩大 diff；对齐它属于手工编辑那条线的账，跟撤销一起单独立项。**这条要在 C2 的实现里明确注释，免得后人以为是漏了。**

**类型一致性检查：**

- `PhotoProfile` 字段名在 Task 0（zod + pydantic）、A5（`build_profile` 输出）、B1（repo）、C1（`readPagePayload`）四处一致，且 Task 0 Step 10 有机械守卫防漂移 ✓
- `subjectBox` / `faceBoxes` 坐标口径 0-100 在 A3（`box_from_mask`）、C2（`resolveImagePos`）两处一致，两边都有专门的断言 ✓
- `applyPhotoFilter` seam 的 patch 形状在 B3（`applyAgentPhotoFilter`）和 C3+C4（`AlbumToolsOptions`）一致 ✓
- `cutouts` 的删键语义（`null` 而非 `false`）在 B3、C3+C4 两处都有断言 ✓
