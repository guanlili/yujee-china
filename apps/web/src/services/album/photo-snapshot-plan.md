# Photo Snapshot Implementation Plan

> Executed inline (user delegated full completion). TDD per task, commit per task.
> Design: [photo-snapshot-design.md](./photo-snapshot-design.md)

**Goal:** 用户手动「保存」时把书里用到照片的 display 档压缩图上传 R2,让换设备/清缓存后历史书不空白;版面 JSON 照旧自动存。

**Tech:** Next.js App Router · drizzle(pg) · Cloudflare R2(S3 兼容,只签 PUT)· IndexedDB(`photoStore`)· `tsx --test` 源码断言风格(无 jsdom)。

## Global Constraints
- 原图永不上传;上传的只有 display 档(~1600px JPEG)派生图,且仅用户主动保存时。
- photoId = `crypto.randomUUID()`;进 R2 key 前必须校验 `^[A-Za-z0-9-]{1,64}$`(防路径穿越/跨命名空间)。
- R2 key 约定:`photo-snapshots/{userId}/{albumId}/{photoId}.jpg`(mirror `cover-thumbs/{userId}/{albumId}.jpg`)。
- 服务端错误走 `fromException`/`ERRORS`;客户端报错走本仓已统一的口径(不露原始串)。

---

### Task 1 — schema + migration:`albums.photo_snapshot`
- Modify: `src/db/schema.ts`(albums 加 `photoSnapshot: jsonb('photo_snapshot')`,nullable)
- Create: `src/db/migrations/00NN_photo_snapshot.sql`(`ALTER TABLE albums ADD COLUMN photo_snapshot jsonb;`)+ drizzle meta
- 形状:`{ photoIds: string[]; updatedAt: string }`
- 验证:`pnpm db:generate` 生成迁移;`tsc` 过。

### Task 2 — `photoStore.getTierBlob(photoId, tier)`
- Modify: `src/lib/photo/store.ts`
- Produces: `getTierBlob(photoId: string, tier: PhotoTier): Promise<Blob | undefined>` —— 抽 `getTierUrl` 里「读 derived / 缺失则 downscaleToJpeg 生成并回存」那段,返回 Blob(不建 objectURL)。`getTierUrl` 改为调用它再 `createObjectURL`。
- 验证:`tsc` 过;`getTierUrl` 行为不变(回归)。

### Task 3 — album-service:sign / confirm / detail
- Modify: `src/services/album/album-service.ts`,`src/services/album/album-service.test.ts`
- 常量:`PHOTO_SNAPSHOT_MAX_COUNT = 300`,`PHOTO_ID_RE = /^[A-Za-z0-9-]{1,64}$/`,key helper `photoSnapshotKey(userId, albumId, photoId)`。
- Produces:
  - `signPhotoSnapshotUpload(userId, albumId, photoIds: string[]): Promise<{ photoId; putUrl; r2Key; publicUrl }[]>` — findOwned;校验 length ∈ [1, MAX] 且每个 photoId 匹配 RE;逐个 `r2.signPutUrl(key,'image/jpeg',300)`。
  - `confirmPhotoSnapshot(userId, albumId, photoIds: string[]): Promise<{ photoIds: string[] }>` — findOwned;校验 RE;把 photoIds 去重并进现有 `photo_snapshot.photoIds`,写 `{ photoIds, updatedAt }`。
  - `getAlbumDetail` 返回体 album 加 `photoSnapshotUrls: Record<photoId,url>`(由 `photo_snapshot.photoIds` × key × publicUrl 推导;无则 `{}`)。
- Tests:sign 数量上限 + 非法 photoId 拒绝 + key 命名空间;confirm 合并去重 + 非法拒绝;detail 从 photo_snapshot 推 URL。

### Task 4 — 两个 API 路由
- Create: `src/app/api/v1/albums/[uuid]/photo-snapshot-upload-url/route.ts`(POST→sign)
- Create: `src/app/api/v1/albums/[uuid]/photo-snapshot/route.ts`(POST→confirm)
- 都 mirror `cover-thumbnail-upload-url/route.ts`:`requireAuth`→`parseBody(zod)`→service→`ok`/`fromException`。body `{ photoIds: z.array(z.string()).min(1).max(300) }`。
- Modify: `src/app/api/v3/v3-teardown-guard.test.ts` —— allowedRoutes 加这两条(它 deepEqual 全量 v1 路由)。
- 验证:teardown-guard 过。

### Task 5 — AlbumDetail 类型 + resolveImage 回退
- Modify: `src/components/album/types.ts`(album 加 `photoSnapshotUrls?: Record<string,string>`)
- Modify: `src/components/album/editor-v2/EditorPort.tsx`(EditorBook `resolveImage`:`imageUrls[id] ?? snapshotUrls[id]`;snapshotUrls 从 detail 取,穿到 EditorBook)
- Test(源码断言):resolveImage 含回退到 `photoSnapshotUrls`。

### Task 6 — 顶栏「保存」按钮 + 徽标语义 + 编排
- Modify: `EditorPort.tsx`(EditorTopbar:静态「已保存」徽标 → 备份态:`local-only`/`backing-up`/`backed-up`/`failed`;新增「保存」按钮);`editor-coordinator.ts`(加 `backupPhotos()` + i18n);EditorBook 里实现 `backupPhotos`(collectPhotoIds→diff `album.photoSnapshotUrls` 已备份的→`getTierBlob`→POST sign→限并发 PUT→POST confirm→更新态)。
- 客户端 client:`src/lib/album/photo-snapshot-client.ts`(`signPhotoSnapshot`/`confirmPhotoSnapshot` fetch 封装)。
- Test:client 封装 + 徽标态源码断言。

### Task 7 — 本地缺图只读姿态
- Modify: EditorBook / EditorTopbar —— 计算 `missingLocalOriginals`(本书用到 photoId 有任一 `photoStore.getBlob` 为空);为真时导出按钮换「下载 PDF」(`album.pdfUrl`)或禁用。
- Test:源码断言只读判定 + 导出→下载切换。

### Task 8 — 编辑 COMPLETED → 退回 EDITING
- Modify: pages PATCH 服务(`album-service` 写页处)+ design-chat 写库处 —— 命中 `status==='COMPLETED'` 时置 `EDITING`。
- Test:改一本 COMPLETED 的书后 status=EDITING。

### Deferred(follow-up,不在本次)
- R2 GC:相册删除时清 `photo-snapshots/{userId}/{albumId}/`(以及 PDF/封面——它们今天也没清)。需给 `r2-client` 加 `deletePrefix`(ListObjectsV2+DeleteObjects)。单独做一次全量 album R2 清理,不在本特性里单挑。

## Self-review
- 覆盖:design §4→T1、§5.1→T6、§5.2→T3/T4、§5.3→T5、§5.4→T7、§5.5→T8、§6 隐私→注释、§6 保留→Deferred。全覆盖(保留项显式 Deferred)。
- 类型一致:`signPhotoSnapshotUpload`/`confirmPhotoSnapshot`/`getTierBlob`/`photoSnapshotUrls`/`backupPhotos` 跨任务同名。
- 无占位符。
