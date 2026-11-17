# 照片 LUT 滤镜 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给回忆录照片增加免费的 26 色 3D-LUT 滤镜，支持全书默认、单张覆盖和 0–100% 强度，并保证桌面/移动预览、PDF/JPG/动态图片导出、云端照片快照和封面缩略图使用同一套像素。

**Architecture:** `albums.photo_filter` 保存 web-only 的书级状态；浏览器 `photoStore` 在生成显示/PDF 派生图后套 WebGL2 3D LUT，HTML 模板和生成 Agent 契约不变。单例 GPU 引擎用 FIFO 串行队列避免共享 canvas 并发串图，IndexedDB 只保留每张照片每档最近两个正式变体；R2 快照按每张照片的有效滤镜版本生成不可变 key。

**Tech Stack:** Next.js 15、React 19、TypeScript、Zod、Drizzle/Postgres、IndexedDB、WebGL2 3D texture、node:test/tsx、Cloudflare R2。

## Global Constraints

- 原图只在浏览器 IndexedDB `originals` store，永不上传、永不改写。
- LUT 只处理降采样后的 display/thumb/PDF 像素；清除滤镜立即回原片。
- 不修改 `Page`、`ImagePos`、`AlbumLayoutPlan`、engine Pydantic 镜像或模板 JSON/HTML。
- `PhotoFilterState` 是 `apps/web` 内部类型，不进入 `packages/contracts`。
- `lutId` 只能来自 26 项显式 manifest；资源 URL 不能由任意用户字符串拼接。
- 强度保存为 0–100，渲染/缓存/快照版本统一量化到最近 5%。
- 选择器 26 张预览只存内存；正式 IndexedDB 变体每个 `photoId+tier` 最多保留 2 个。
- 单例 GPU canvas 的所有渲染任务严格 FIFO；Offscreen WebGL2 失败时尝试隐藏 DOM canvas。
- 滤镜 PATCH 同事务清空旧 `pdfUrl`/`coverThumbnailUrl`，`COMPLETED` 退回 `EDITING`。
- 旧分享链接是冻结快照；新分享必须确认每张照片的 R2 renderVersion 与当前滤镜相符。
- 不新增运行时依赖；gzip 使用浏览器原生 `DecompressionStream`，不支持时该能力降级为原片。
- LUT 产物、源文件 SHA-256 和来源说明提交；`.cube` 源文件不进仓库。
- 单文件测试：`pnpm --filter @yujee/web exec tsx --test <path>`。
- Web 全量验证：`pnpm --filter @yujee/web test` 和 `pnpm --filter @yujee/web typecheck`。

---

## 文件结构

**新建**

- `apps/web/src/lib/photo/filter-state.ts`：26 个 LUT 定义、Zod 状态、解析、量化、renderVersion。
- `apps/web/src/lib/photo/filter-state.test.ts`：状态与版本纯函数测试。
- `apps/web/scripts/build-luts.ts`：读取 26 个 709 `.cube`，生成 17³/33³ gzip 资源与 provenance。
- `apps/web/scripts/build-luts.test.ts`：cube 解析、降采样、26 文件映射测试。
- `apps/web/public/luts/thumbs.bin.gz`：26×17³×3 的预览级资源。
- `apps/web/public/luts/full/*.bin.gz`：26 个 33³ 正式资源。
- `apps/web/public/luts/provenance.json`：源文件名、SHA-256、产物哈希。
- `apps/web/public/luts/README.md`：资源来源与构建命令。
- `apps/web/src/lib/photo/lut/resource-loader.ts`：gzip fetch、懒加载、内存缓存。
- `apps/web/src/lib/photo/lut/lut-math.ts`：CPU 三线性参考实现。
- `apps/web/src/lib/photo/lut/engine.ts`：WebGL2 引擎、canvas fallback、FIFO 队列。
- `apps/web/src/lib/photo/lut/*.test.ts`：资源、数学、队列、降级测试。
- `apps/web/src/components/album/editor-v2/filter-controller.ts`：滤镜状态变更、PATCH、预览 URL 管理。
- `apps/web/src/components/album/editor-v2/filter-controller.test.ts`：状态变更纯函数测试。
- `apps/web/src/components/album/editor-v2/mobile/modals/FilterSheet.tsx`：移动端滤镜面板。
- `apps/web/src/components/album/editor-v2/FilterBar.tsx`：两端复用的 React 滤镜卡/滑杆主体。
- `apps/web/src/services/album/photo-filter-flow.test.ts`：DB/API/派生物失效测试。

**修改**

- `apps/web/src/db/schema.ts` 与新 Drizzle migration：`albums.photo_filter`、快照版本类型。
- `apps/web/src/services/album/album-service.ts`：读写 filter、派生物失效、快照版本。
- `apps/web/src/services/album/photo-snapshot-util.ts`：版本化 key/URL。
- 两个 photo-snapshot API route 和浏览器 client：entry 数组替代裸 photoIds。
- `apps/web/src/services/album/share-service.ts`：拒绝版本不匹配的新分享。
- `apps/web/src/lib/photo/store.ts`：滤镜感知、派生缓存与淘汰。
- `apps/web/src/components/album/types.ts`：详情/列表的滤镜与快照版本字段。
- `EditorPort.tsx`、移动编辑器、两条 export/backup hook：状态/UI/像素接线。
- `AlbumCoverPreview.tsx`、`my-albums/page.tsx`：滤镜封面预览与重建。
- 根 `README.md`、`apps/web/README.md`、`CLAUDE.md` 的 `checked-at`：按 doc-scope 核对更新。

---

### Task 1: 滤镜领域模型与每照片 renderVersion

**Files**

- Create: `apps/web/src/lib/photo/filter-state.ts`
- Test: `apps/web/src/lib/photo/filter-state.test.ts`

**Interfaces**

- Produces: `LUT_DEFINITIONS`、`LutIdSchema`、`PhotoFilterStateSchema`。
- Produces: `normalizePhotoFilterState`、`resolveEffectiveFilter`、`quantizeStrength`、`effectiveRenderVersion`。

- [ ] **Step 1: 写失败测试**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LUT_DEFINITIONS,
  PhotoFilterStateSchema,
  effectiveRenderVersion,
  resolveEffectiveFilter,
} from './filter-state';

test('manifest 固定为 26 个唯一稳定 id', () => {
  assert.equal(LUT_DEFINITIONS.length, 26);
  assert.equal(new Set(LUT_DEFINITIONS.map((x) => x.id)).size, 26);
});

test('显式 null override 强制原片且版本稳定', () => {
  const state = PhotoFilterStateSchema.parse({
    default: { lutId: 'fuji-portrait', strength: 82 },
    overrides: { p1: null },
  });
  assert.equal(resolveEffectiveFilter(state, 'p1'), null);
  assert.equal(effectiveRenderVersion(state, 'p1'), 'pf-v1__original');
  assert.equal(effectiveRenderVersion(state, 'p2'), 'pf-v1__fuji-portrait__80');
});

test('拒绝未知 lutId、越界强度和多余字段', () => {
  assert.equal(PhotoFilterStateSchema.safeParse({ default: { lutId: 'unknown', strength: 80 } }).success, false);
  assert.equal(PhotoFilterStateSchema.safeParse({ default: { lutId: 'fuji-portrait', strength: 101 } }).success, false);
  assert.equal(PhotoFilterStateSchema.safeParse({ default: null, extra: true }).success, false);
});
```

- [ ] **Step 2: 运行测试并确认因模块不存在而失败**

Run: `pnpm --filter @yujee/web exec tsx --test src/lib/photo/filter-state.test.ts`

- [ ] **Step 3: 实现最小领域模块**

```ts
import { z } from 'zod';

export const LUT_DEFINITIONS = [
  { id: 'cloudy-cool', nameZh: '阴天清冷', source: '阴天清冷-709.cube' },
  { id: 'street-negative', nameZh: '街拍负片', source: '街拍负片-709.cube' },
  { id: 'airy-japanese', nameZh: '清透日系', source: '清透日系-709.cube' },
  { id: 'travel-cinematic', nameZh: '旅行大片', source: '旅行大片-709.cube' },
  { id: 'city-street', nameZh: '城市街头', source: '城市街头-709.cube' },
  { id: 'daily-soft', nameZh: '日常淡雅', source: '日常淡雅-709.cube' },
  { id: 'teal-orange-outdoor', nameZh: '青橙外景', source: '青橙外景-709.cube' },
  { id: 'cool-cyan', nameZh: '冷青氛围', source: '冷青氛围-709.cube' },
  { id: 'rich-teal-orange', nameZh: '浓郁青橙', source: '浓郁青橙-709.cube' },
  { id: 'fuji-portrait', nameZh: '富士人像', source: '富士人像-709.cube' },
  { id: 'night-film', nameZh: '夜景胶片', source: '夜景胶片-709.cube' },
  { id: 'forest-green', nameZh: '森系绿调', source: '森系绿调-709.cube' },
  { id: 'retro-film', nameZh: '复古胶片', source: '复古胶片-709.cube' },
  { id: 'fuji-clear', nameZh: '富士清透', source: '富士清透-709.cube' },
  { id: 'dark-cool-cinema', nameZh: '暗调冷电影', source: '暗调冷电影-709.cube' },
  { id: 'kodak-daylight', nameZh: '柯达日光胶片', source: '柯达日光胶片-709.cube' },
  { id: 'eighties-retro', nameZh: '八十年代复古', source: '八十年代复古-709.cube' },
  { id: 'sunny-soft', nameZh: '暖阳淡雅', source: '暖阳淡雅-709.cube' },
  { id: 'autumn-warm', nameZh: '秋日暖调', source: '秋日暖调-709.cube' },
  { id: 'altay-wilderness', nameZh: '阿勒泰旷野', source: '阿勒泰旷野-709.cube' },
  { id: 'warm-cinema-film', nameZh: '暖调电影胶片', source: '暖调电影胶片-709.cube' },
  { id: 'muted-cinema', nameZh: '低饱和电影', source: '低饱和电影-709.cube' },
  { id: 'nostalgic-film', nameZh: '怀旧胶片', source: '怀旧胶片-709.cube' },
  { id: 'kodak-2383', nameZh: '影院质感2383', source: '影院质感2383-709.cube' },
  { id: 'fresh-clear', nameZh: '清新通透', source: '清新通透-709.cube' },
  { id: 'green-book', nameZh: '绿皮书质感', source: '绿皮书质感:复古:雪山:人像:风光.cube' },
] as const;

const ids = LUT_DEFINITIONS.map((x) => x.id) as [string, ...string[]];
export const LutIdSchema = z.enum(ids);
export type LutId = z.infer<typeof LutIdSchema>;
export const PhotoFilterRefSchema = z.object({ lutId: LutIdSchema, strength: z.number().min(0).max(100) }).strict();
export type PhotoFilterRef = z.infer<typeof PhotoFilterRefSchema>;
export const PhotoFilterStateSchema = z.object({
  default: PhotoFilterRefSchema.nullable(),
  overrides: z.record(z.string(), PhotoFilterRefSchema.nullable()).optional(),
}).strict();
export type PhotoFilterState = z.infer<typeof PhotoFilterStateSchema>;
```

Implement the four pure functions with `Object.prototype.hasOwnProperty.call`, `Math.round(value / 5) * 5`, and the exact `pf-v1__*` strings asserted above.

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @yujee/web exec tsx --test src/lib/photo/filter-state.test.ts`

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/lib/photo/filter-state.ts apps/web/src/lib/photo/filter-state.test.ts
git commit -m "feat(filters): add filter state and render versions"
```

### Task 2: 数据库列、详情/PATCH 与派生物失效

**Files**

- Modify: `apps/web/src/db/schema.ts`
- Modify: `apps/web/src/services/album/album-service.ts`
- Modify: `apps/web/src/app/api/v1/albums/[uuid]/route.ts`
- Modify: `apps/web/src/components/album/types.ts`
- Create: Drizzle migration after `0020_agent_job_kind_compose.sql`
- Test: `apps/web/src/services/album/photo-filter-flow.test.ts`

**Interfaces**

- Produces: `albumService.updatePhotoFilter(userId, albumId, state)`.
- Detail/list album objects include `photoFilter`.

- [ ] **Step 1: 写 DB 流程失败测试**

Create an album, set it `COMPLETED` with non-null PDF/cover fields, call:

```ts
const result = await albumService.updatePhotoFilter(user.id, album.id, {
  default: { lutId: 'fuji-portrait', strength: 80 },
});
assert.equal(result.photoFilter?.default?.lutId, 'fuji-portrait');
const row = await albumRepo.findById(album.id);
assert.equal(row?.status, 'EDITING');
assert.equal(row?.pdfUrl, null);
assert.equal(row?.pdfR2Key, null);
assert.equal(row?.coverThumbnailUrl, null);
assert.equal(row?.coverThumbnailR2Key, null);
assert.deepEqual((await albumService.getDetail(user.id, album.id)).album.photoFilter, result.photoFilter);
```

- [ ] **Step 2: 运行测试，确认因方法不存在而失败**

Run: `pnpm --filter @yujee/web exec tsx --test src/services/album/photo-filter-flow.test.ts`

- [ ] **Step 3: 加 schema、迁移和服务**

Add:

```ts
photoFilter: jsonb('photo_filter').$type<PhotoFilterState>(),
```

Generate migration:

Run: `pnpm --filter @yujee/web db:generate`

Implement service normalization with `PhotoFilterStateSchema.parse` and one `albumRepo.update` transaction that writes the state, clears PDF/cover metadata, and conditionally changes status.

- [ ] **Step 4: 扩展 PATCH schema**

Add `photoFilter: PhotoFilterStateSchema.nullable().optional()` and make the route reject requests containing more than one base field, so title/background/filter updates cannot silently drop siblings.

- [ ] **Step 5: 运行流程测试与 route 测试**

Run: `pnpm --filter @yujee/web exec tsx --test src/services/album/photo-filter-flow.test.ts src/app/api/v1/albums/\\[uuid\\]/*.test.ts`

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/db apps/web/src/services/album apps/web/src/app/api/v1/albums apps/web/src/components/album/types.ts
git commit -m "feat(filters): persist album photo filters"
```

### Task 3: LUT 构建脚本与 26 色资源

**Files**

- Create: `apps/web/scripts/build-luts.ts`
- Test: `apps/web/scripts/build-luts.test.ts`
- Create: `apps/web/public/luts/**`

**Interfaces**

- Produces: `parseCube33(text)`, `downsample33To17(data)`, CLI `--source`.
- Produces exact 26 resources named from `LUT_DEFINITIONS`.

- [ ] **Step 1: 写失败测试**

Tests build an identity 33³ cube in memory and assert `33 ** 3 * 3` bytes, 17³ corners, rejection of size 32, and that all 26 `source` names resolve in `/Users/smalldog/Desktop/精选26色LUT`.

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm --filter @yujee/web exec tsx --test scripts/build-luts.test.ts`

- [ ] **Step 3: 实现 parser/CLI**

The CLI must parse only `--source <absolute-dir>`, reject missing/extra source mappings, quantize floats to uint8, gzip with `node:zlib`, and write deterministic JSON sorted by `LUT_DEFINITIONS`. `provenance.json` contains:

```ts
type Provenance = {
  version: 'pf-v1';
  sourceDirectoryLabel: '精选26色LUT';
  entries: Array<{ lutId: LutId; source: string; sourceSha256: string; fullSha256: string }>;
};
```

- [ ] **Step 4: 运行测试、真实构建并核对数量**

Run: `pnpm --filter @yujee/web exec tsx --test scripts/build-luts.test.ts`

Run: `pnpm --filter @yujee/web exec tsx scripts/build-luts.ts --source /Users/smalldog/Desktop/精选26色LUT`

Expected: 26 full resources, one thumbs resource, one provenance file.

- [ ] **Step 5: 提交**

```bash
git add apps/web/scripts/build-luts* apps/web/public/luts
git commit -m "feat(filters): build and package 26 LUT assets"
```

### Task 4: CPU 参考、资源加载与 FIFO GPU 引擎

**Files**

- Create: `apps/web/src/lib/photo/lut/lut-math.ts`
- Create: `apps/web/src/lib/photo/lut/resource-loader.ts`
- Create: `apps/web/src/lib/photo/lut/engine.ts`
- Test: `apps/web/src/lib/photo/lut/lut-math.test.ts`
- Test: `apps/web/src/lib/photo/lut/engine.test.ts`

**Interfaces**

- Produces: `sampleLutTrilinear`, `loadThumbLut`, `loadFullLut`。
- Produces: `createSerialExecutor` and `lutEngine.{isSupported,applyToBlob,applyPreview}`。

- [ ] **Step 1: 写数学与队列失败测试**

```ts
test('identity LUT leaves RGB unchanged and strength zero bypasses', () => { /* exact RGB assertions */ });
test('serial executor starts jobs FIFO even when first job resolves later', async () => {
  const events: string[] = [];
  const run = createSerialExecutor();
  const first = run(async () => { events.push('a:start'); await Promise.resolve(); events.push('a:end'); return 'a'; });
  const second = run(async () => { events.push('b:start'); events.push('b:end'); return 'b'; });
  assert.deepEqual(await Promise.all([first, second]), ['a', 'b']);
  assert.deepEqual(events, ['a:start', 'a:end', 'b:start', 'b:end']);
});
test('node without WebGL returns the original Blob reference', async () => { /* same-reference assertion */ });
```

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm --filter @yujee/web exec tsx --test src/lib/photo/lut/*.test.ts`

- [ ] **Step 3: 实现资源加载**

Fetch same-origin assets, decompress with `new DecompressionStream('gzip')`, validate exact byte lengths, cache resolved promises by `lutId+tier`, and clear rejected promises so retry remains possible.

- [ ] **Step 4: 移植 shader 和 canvas fallback**

Use the verified shader from `/Users/smalldog/Desktop/LUT一键调色/template.html`. Create Offscreen canvas first, then DOM canvas. Wrap the entire decode → upload → draw → encode lifecycle in the serial executor; delete the per-image texture and close the bitmap in `finally`.

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm --filter @yujee/web exec tsx --test src/lib/photo/lut/*.test.ts`

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/lib/photo/lut
git commit -m "feat(filters): add serialized WebGL LUT engine"
```

### Task 5: photoStore 滤镜接缝与有界缓存

**Files**

- Modify: `apps/web/src/lib/photo/store.ts`
- Modify: `apps/web/src/lib/photo/store.test.ts`
- Modify: `apps/web/src/lib/photo/pdf-export-images.test.ts`

**Interfaces**

- All four methods add final `photoFilter?: PhotoFilterState | null`.
- Produces: `derivedCacheKey(photoId, tier, ref)` and `filteredVariantPrefix(photoId, tier)`.

- [ ] **Step 1: 写失败测试**

Assert no-filter keys remain `p1@display`, filtered keys include `@pf-v1@lut@80`, strength 0 uses the old key, and an injected fake derived-store key list deletes the oldest filtered entry when the third version is stored.

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm --filter @yujee/web exec tsx --test src/lib/photo/store.test.ts src/lib/photo/pdf-export-images.test.ts`

- [ ] **Step 3: 重构无滤镜 base 派生函数**

Extract current `getTierBlob` body to `getBaseTierBlob(photoId, tier)` without changing its key or bytes. Filtered `getTierBlob` resolves the photo ref, reads/writes the versioned key, calls `lutEngine.applyToBlob(base, ref, 'full')`, and evicts older variants.

- [ ] **Step 4: 接线 URL、批量与 PDF**

`getTierUrl(s)` use the same versioned URL cache key. `getPdfDataUrls` remains sequential, downsizes to `maxEdge`, applies the full LUT after resize and before JPEG encode. Engine failure returns the base image and records a diagnostic without caching the failed filtered result.

- [ ] **Step 5: 运行 photo 测试**

Run: `pnpm --filter @yujee/web exec tsx --test src/lib/photo/*.test.ts src/lib/photo/lut/*.test.ts`

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/lib/photo
git commit -m "feat(filters): make photoStore filter aware"
```

### Task 6: 版本化照片快照后端和浏览器 client

**Files**

- Modify: `apps/web/src/db/schema.ts`
- Modify: `apps/web/src/services/album/photo-snapshot-util.ts`
- Modify: `apps/web/src/services/album/album-service.ts`
- Modify: both photo-snapshot API routes
- Modify: `apps/web/src/lib/album/photo-snapshot-client.ts`
- Modify/Test: existing snapshot tests

**Interfaces**

- `SnapshotEntry = { photoId: string; renderVersion: string }`.
- Existing rows without `renderVersions` continue resolving `photoId.jpg`.

- [ ] **Step 1: 写 util 与 service 失败测试**

Assert legacy key, versioned key, invalid version rejection, partial confirm merge, and detail returns both `photoSnapshotUrls` and `photoSnapshotRenderVersions`.

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm --filter @yujee/web exec tsx --test src/services/album/photo-snapshot-util.test.ts src/services/album/photo-snapshot-flow.test.ts`

- [ ] **Step 3: 实现版本类型和 helper**

Use render version regex `/^pf-v1__[a-z0-9-]+(?:__(?:0|5|[1-9][0-9]|100))?$/` and key:

```ts
return version
  ? `photo-snapshots/${userId}/${albumId}/${photoId}/${version}.jpg`
  : `photo-snapshots/${userId}/${albumId}/${photoId}.jpg`;
```

Confirm merges `photoIds` and per-photo `renderVersions`; URLs choose versioned or legacy path per photo.

- [ ] **Step 4: 更新 routes/client**

Both endpoints accept `{ entries: SnapshotEntry[] }`; client functions and return types use entries consistently.

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm --filter @yujee/web exec tsx --test src/services/album/photo-snapshot-*.test.ts src/lib/album/*.test.ts`

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/db/schema.ts apps/web/src/services/album apps/web/src/app/api/v1/albums apps/web/src/lib/album
git commit -m "feat(filters): version photo snapshots by filter"
```

### Task 7: 桌面滤镜控制器、UI、导出和备份

**Files**

- Create: `apps/web/src/components/album/editor-v2/filter-controller.ts`
- Create: `apps/web/src/components/album/editor-v2/filter-controller.test.ts`
- Create: `apps/web/src/components/album/editor-v2/FilterBar.tsx`
- Modify: `EditorPort.tsx` and editor CSS

**Interfaces**

- `setBookFilter`, `setPhotoOverride`, `clearPhotoOverride` are pure state transforms.
- Controller loads filtered URLs, updates the imperative editor, debounces PATCH, and surfaces failure.

- [ ] **Step 1: 写状态变换失败测试**

Assert book default preserves overrides, setting one override changes one key, clearing deletes the key rather than writing `undefined`, and original writes explicit `null`.

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm --filter @yujee/web exec tsx --test src/components/album/editor-v2/filter-controller.test.ts`

- [ ] **Step 3: 实现控制器与 FilterBar**

`FilterBar` renders original + 26 cards, one 0–100 range, scope copy, follow-book action, and loading/error states. Preview generation uses `photoStore.getTierBlob(id, 'thumb')` plus `lutEngine.applyPreview` and revokes all object URLs on cleanup.

- [ ] **Step 4: 接入桌面 EditorPort**

Add topbar “风格”, selected-photo overlay entry, local `photoFilter`, filtered reload of `imageUrls`, and pass state to all `getPdfDataUrls` calls. PATCH after 180ms idle; on failure show existing toast/error UI. Hide entries when engine unsupported.

- [ ] **Step 5: 更新桌面备份**

Compute current `SnapshotEntry[]`; compare against detail render-version map; call filtered `getTierBlob` only for mismatches; sign/upload/confirm those entries.

- [ ] **Step 6: 运行 editor source/behavior tests**

Run: `pnpm --filter @yujee/web exec tsx --test src/components/album/editor-v2/*.test.ts src/lib/photo/*.test.ts`

- [ ] **Step 7: 提交**

```bash
git add apps/web/src/components/album/editor-v2
git commit -m "feat(filters): add desktop filter controls"
```

### Task 8: 移动滤镜 UI、导出和备份

**Files**

- Create: `apps/web/src/components/album/editor-v2/mobile/modals/FilterSheet.tsx`
- Modify: `MobileEditorRoot.tsx`, `MobileEditor.tsx`, `ModalHost.tsx`, `MoreSheet.tsx`
- Modify: `mobile/use-export.ts`, `mobile/use-photo-backup.ts`
- Test: mobile editor source/behavior tests

- [ ] **Step 1: 写失败测试**

Source-level guard asserts `FilterSheet` registration, current `photoFilter` passed to display/thumb/export, and backup compares effective render versions rather than only IDs.

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm --filter @yujee/web exec tsx --test src/components/album/editor-v2/mobile/*.test.ts`

- [ ] **Step 3: 实现 FilterSheet**

Reuse `FilterBar`; support book scope and selected-photo scope, same debounce, same unsupported/remote-original warning, and same persistence failure copy.

- [ ] **Step 4: 接线移动 display/thumb/export/backup**

Add `photoFilter` to relevant hook dependency arrays so state changes actually regenerate URLs. `useExport` passes it to `getPdfDataUrls`; `usePhotoBackup` accepts the snapshot version map and filter state.

- [ ] **Step 5: 运行移动与 photo 测试**

Run: `pnpm --filter @yujee/web exec tsx --test src/components/album/editor-v2/mobile/*.test.ts src/lib/photo/*.test.ts`

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/components/album/editor-v2/mobile
git commit -m "feat(filters): add mobile filter controls"
```

### Task 9: 封面缩略图和相册列表一致性

**Files**

- Modify: `apps/web/src/services/album/album-service.ts`
- Modify: `apps/web/src/app/[locale]/my-albums/page.tsx`
- Modify: `apps/web/src/components/album/AlbumCoverPreview.tsx`
- Test: `apps/web/src/app/my-albums-design.test.ts` and photo-filter flow tests

- [ ] **Step 1: 写失败测试**

Assert list response contains `photoFilter`; `AlbumCoverPreview` passes it to `getTierUrls`; thumbnail generation obtains a filtered display blob before calling `createCoverThumbnailJpeg`; changing filter cleared the stored cover URL in Task 2.

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm --filter @yujee/web exec tsx --test src/app/my-albums-design.test.ts src/services/album/photo-filter-flow.test.ts`

- [ ] **Step 3: 实现 list/preview/thumbnail**

Return `photoFilter` from list. Add it to list client type and `AlbumCoverPreview` props/effect dependencies. Generate the uploaded thumbnail from `photoStore.getTierBlob(photoId, 'display', album.photoFilter)` instead of the raw original.

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @yujee/web exec tsx --test src/app/my-albums-design.test.ts src/services/album/photo-filter-flow.test.ts`

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/services/album/album-service.ts apps/web/src/app/\[locale\]/my-albums/page.tsx apps/web/src/components/album/AlbumCoverPreview.tsx
git commit -m "feat(filters): keep album covers filter consistent"
```

### Task 10: 新分享的快照版本完整性

**Files**

- Modify: `apps/web/src/services/album/share-service.ts`
- Modify: share tests
- Modify: `apps/web/src/components/album/editor-v2/EditorPort.tsx`
- Modify: `apps/web/src/components/album/editor-v2/mobile/use-share-link.ts`

- [ ] **Step 1: 写失败测试**

Create pages using two photo IDs, set a default filter, persist only one matching snapshot version, and assert `createShare` rejects. Persist both matching versions and assert frozen URLs contain each version.

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm --filter @yujee/web exec tsx --test src/services/album/share-service.test.ts`

- [ ] **Step 3: 实现服务端完整性校验**

Collect photo IDs from snapshot pages, compute `effectiveRenderVersion(album.photoFilter, id)`, compare to `album.photoSnapshot.renderVersions`, and throw validation error listing only the count of missing versions. Existing frozen shares are untouched.
Map that validation error to “还有 N 张照片需要按当前风格重新备份” in the desktop and mobile share flows.

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @yujee/web exec tsx --test src/services/album/share-service.test.ts src/services/album/photo-snapshot-flow.test.ts`

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/services/album apps/web/src/components/album/editor-v2
git commit -m "feat(filters): require current snapshots for new shares"
```

### Task 11: 浏览器像素校验与全链路回归

**Files**

- Create temporary local-only browser harness, remove it before commit.
- Modify permanent tests only when the harness reveals a reproducible gap.

- [ ] **Step 1: 启动 web 并打开真实相册**

Run: `pnpm --filter @yujee/web dev`

- [ ] **Step 2: GPU 对 CPU 参考**

For identity and at least three production LUTs, compare a fixed RGB grid. Maximum per-channel delta must be ≤2/255 at strength 100 and 50.

- [ ] **Step 3: 桌面/移动场景**

Verify book default, explicit-original override, individual LUT override, strength drag, refresh persistence, unsupported warning, and remote-only photo warning.

- [ ] **Step 4: 导出/快照/封面**

Verify PDF, single page, collage, flip video, nine-grid video, saved snapshot, anonymous share, and regenerated cover all show the same effective filters.

- [ ] **Step 5: 清理临时 harness**

Run: `git status --short` and remove every temporary file; retain only permanent regression tests.

### Task 12: 文档时效与最终验证

**Files**

- Modify docs covered by doc-scope only as required by `pnpm docs:check`.

- [ ] **Step 1: 核对文档并更新 checked-at**

Review root `README.md`, `apps/web/README.md`, and `CLAUDE.md` against changed API/service paths. Update content where the feature changes architecture; update `checked-at` according to the repository workflow.

- [ ] **Step 2: 运行格式与类型检查**

Run: `git diff --check`

Run: `pnpm docs:check && pnpm --filter @yujee/web typecheck`

- [ ] **Step 3: 运行 Web 全量测试**

Run: `pnpm --filter @yujee/web test`

- [ ] **Step 4: 运行仓库相关包测试**

Run: `pnpm --filter @yujee/contracts test`

- [ ] **Step 5: 审查工作树**

Run: `git status --short --branch && git diff main...HEAD --stat && git log --oneline main..HEAD`

- [ ] **Step 6: 请求代码审查并修复发现**

Use `superpowers:requesting-code-review`, then repeat Steps 2–5 after every fix.

---

## Self-review

- Spec coverage: data model, 26 assets, GPU/CPU, bounded cache, desktop/mobile, all export paths, versioned snapshots, cover/PDF invalidation, share freeze, fallback and browser verification each map to a task.
- Type consistency: every image API accepts `PhotoFilterState | null`; snapshot APIs use `SnapshotEntry[]`; render version uses one `pf-v1` format.
- Scope: no engine/templates/contracts changes, no server image processing, no dependency addition, no unrelated editor refactor.
- Execution: the user already selected inline continuation in the current `feat/lut-filters` worktree, so implementation uses `superpowers:executing-plans`.
