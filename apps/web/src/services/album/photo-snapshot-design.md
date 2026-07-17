# Photo Snapshot — 手动备份让历史书不空白

- Status: Approved design — 2026-07-17
- Scope: `apps/web` only（无 Agent/Fly 改动、无跨服务协议改动）
- Owner module: `apps/web/src/services/album/`

## 1. 背景与问题

- 原图只在浏览器 IndexedDB（`apps/web/src/lib/photo/store.ts`，架构 invariant 1），**从不上传**。
- 服务器上一本书只有：页结构（`album_pages`：`templateId` / `textsJson` / `imagesJson`（存的是 photoId **引用**，不是字节）/ `imagePosJson` / `htmlJson`）、导出后的 PDF + 封面缩略图（R2）、状态。
- 后果：换设备 / 清缓存后，本地照片没了，内页（靠本地照片实时渲染）**全白**，历史记录空白。
- 关键事实：**版面 JSON 已经每次编辑就自动落服务器**（编辑器内联改动 → `persistPagePatch` → `PATCH /api/v1/albums/{id}/pages/{idx}`）。真正没落服务器的只有 **照片字节**。

## 2. 目标 / 非目标

目标：
- 用户能**主动**把一本书备份到服务器，之后在任何设备都能看到内页（用压缩图），历史不空白。
- 改动面最小：复用现有 R2 直传、`photoStore` 派生图、`resolveImage` 取图接口。
- **默认不备份** —— 一次性试用 / 一次性出 PDF 的书不占服务器资源。丢失风险用户知情自担。

非目标（Out of scope）：
- 不做自动 / 定时保存。
- 不上传原图（高清 PDF 仍只从本地原图出）。
- 不做编辑锁定（COMPLETED 后仍可编辑）。
- 不做快照 TTL / 配额 / 跨用户共享。

## 3. 决定的模型（已拍板）

1. **版面 JSON 一直自动存（照旧）；照片只在用户手动点「保存」时上传。**
2. 保存上传的是照片的 **display 档压缩图（~1600px JPEG）**，大多已存在浏览器 `derived` 表，直接 PUT，无需重编码。
3. `resolveImage` 回退链：
   ```
   resolveImage(id) = 本地高清/派生（IndexedDB）   // 有 → 用它，可编辑、可出高清 PDF
                   ?? 服务器压缩图（备份过才有）      // 本地没有 → 用它，可查看
                   ?? 空槽                          // 都没有 → JSON 架子：版面/文字在，图位留白
   ```
4. **Save 与 Export 正交**：Save = 备份照片（书可恢复）；Export = 出 PDF 上传 R2 + 置 `COMPLETED`。**导出不隐含备份**。
5. **`COMPLETED` 触发**：PDF 成功生成并上传 R2（`confirmPdf`，服务器可确认的事件）。**不依赖浏览器「下载完成」信号**（该信号不可靠）。文件落到用户磁盘是尽力而为的 UX，不作状态依据。
6. 顶栏徽标语义：从会误导的「已保存」改为 **「是否已备份到云端」** —— 默认「仅本机 · 未备份」，点保存后「已备份」，另有「备份中 / 备份失败」态。

## 4. 数据模型

`albums` 新增一列：
- `photo_snapshot jsonb`（nullable）—— 形如 `{ "photoIds": ["p1","p2"], "updatedAt": "<ISO>" }`，记录已备份到 R2 的 photoId 集合。`null` = 从未备份。
- 迁移：加一列 nullable `jsonb`，无回填风险（现有行 = `null` = 未备份）。

R2 key 约定（mirror 现有 `cover-thumbs/{userId}/{albumId}.jpg`）：
- `photo-snapshots/{userId}/{albumId}/{photoId}.jpg`
- 公开 URL 由 `r2.publicUrl(key)` 推导。

## 5. 组件与数据流

### 5.1 保存（客户端主导，mirror 现有 PDF/封面直传）

触发：顶栏「保存」按钮。步骤：
1. 收集本书用到的 photoId：`collectPhotoIds(pagesState)`（已有工具），减去已在 `photo_snapshot.photoIds` 里的 → **增量只传新的**。
2. 每个待传 photoId 取 display 档压缩 blob：`photoStore.getTierBlob(photoId, 'display')`（**需新增**——现有只暴露 URL；把 `getTierUrl` 里「读 derived 表 / 缺失则 `downscaleToJpeg` 生成」那段抽出复用，返回 `Blob`）。
3. `POST /api/v1/albums/{id}/photo-snapshot/sign`（body `{ photoIds }`）→ 返回 `[{ photoId, putUrl, r2Key }]`。
4. 浏览器限并发（4）`PUT putUrl`（body = blob，`content-type: image/jpeg`）；后台、不阻塞编辑、单张失败有限重试。
5. `POST /api/v1/albums/{id}/photo-snapshot/confirm`（body `{ photoIds }`，**只含确实 PUT 成功的**）→ 服务端校验命名空间、把 photoIds 并进 `photo_snapshot`。
6. 顺带：若封面缩略图还没传过，一并传（让「备份过但没导出」的书在历史网格也有封面）。

徽标：点击 → 「备份中」→ 成功「已备份」/ 失败「备份失败，点重试」。

### 5.2 服务端（`album-service.ts` + 两个路由）

- `signPhotoSnapshotUpload(userId, albumId, photoIds[])`：`findOwned`；每个 photoId → key `photo-snapshots/{userId}/{albumId}/{photoId}.jpg`，`r2.signPutUrl(key, 'image/jpeg', 300)`；返回列表。校验 `photoIds.length` 上限（防滥用，常量如 `PHOTO_SNAPSHOT_MAX_COUNT = 300`）。
- `confirmPhotoSnapshot(userId, albumId, photoIds[])`：`findOwned`；校验每个隐含 key 属于本 `{userId}/{albumId}` 命名空间；把 photoIds 去重合并进现有 `photo_snapshot.photoIds`，更新 `updatedAt`；事务写 album 行。
- album detail（`GET /api/v1/albums/{uuid}`）：返回体新增 `photoSnapshotUrls: Record<photoId, url>`（由 `photo_snapshot.photoIds` × 约定 key × `r2.publicUrl` 推导），供客户端建回退 map。

### 5.3 渲染回退（`resolveImage`）

- 现状：`resolveImage(id) = imageUrls[id]`（仅本地派生 URL）。
- 改为：先本地（`photoStore.getTierUrl`），本地缺失则用 detail 带回的 `photoSnapshotUrls[id]`，都没有则空槽。
- 落点：EditorBook 的 `resolveImage`（`EditorPort.tsx`）；`AlbumCoverPreview` 已有「服务器封面 → 本地」回退，内页沿用同思路。**PDF 导出路径不变**（仍要本地原图，见 5.4）。

### 5.4 本地缺图时的只读姿态

- 判定：本书任一用到 photoId 在本地 IndexedDB 缺失（`photoStore.getBlob` 为空）→ 只读姿态。
- 顶栏「导出」置灰 / 换成「下载 PDF」（直接给 `album.pdfUrl`，若有）；**不允许用低清快照出 PDF**。
- 「保存」按钮：本地无高清也无法补齐备份，按钮态说明「需在有原图的设备上备份」。

### 5.5 Export / COMPLETED（几乎不变，仅补一条状态规则）

- 导出流程照旧：出 PDF → 浏览器直传 R2 → `confirmPdf` 落 `pdfR2Key`/`pdfUrl` + 置 `COMPLETED` + 传封面缩略图。**`COMPLETED` 早已在 `confirmPdf` 里设**，无需改触发点。
- **新增状态规则**：`COMPLETED` 之后再编辑（任一 pages PATCH / design-chat 写入命中 `status==='COMPLETED'` 的相册）→ 退回 `EDITING`，旧 `pdfUrl` 视为过期（不再展示为「最新已完成」，重新导出覆盖）。这条落点即收敛「已完成但内容已变」的风险。

## 6. 隐私 / 保留 / 计费

- 隐私：**原图永不离开浏览器**不变。压缩派生图仅在用户**主动保存**（或导出时的封面缩略图）时上传 R2 —— opt-in。更新 `photoStore` / 架构 invariant 注释：「派生图 opt-in 上传，限用户主动备份」。
- 保留：无 TTL；相册删除时连带删 R2 前缀 `photo-snapshots/{userId}/{albumId}/`（DB 行 cascade 已有，R2 侧在删除相册处补删前缀）。
- 计费：不受影响（计费在排版成功扣；备份不计费）。

## 7. 错误处理

- 单张 PUT 失败：有限次重试；仍失败 → 整体「备份失败」。**confirm 只登记确实 PUT 成功的 photoId**（客户端只把成功的传给 confirm），部分成功不会谎报全备份。
- sign/confirm 的服务端错误走统一 API 错误码；客户端展示复用本仓已统一的报错口径（不露原始串）。
- 保存全程不阻塞编辑，失败可重试。

## 8. 测试

- 服务：`sign` 命名空间 + 数量上限；`confirm` 只登记本命名空间 key + `photo_snapshot` 增量合并；detail 返回 `photoSnapshotUrls`。
- 客户端（沿用本仓 `tsx --test` 源码断言风格，无 jsdom）：`resolveImage` 回退优先级；Save 只传缺失 photoId；只读姿态判定；COMPLETED 编辑退回 EDITING。
- 回归：导出流程 + `COMPLETED` 触发不变。

## 9. 已知取舍

- 从未点保存的书：换设备 / 清缓存后内页丢失，仅剩 JSON 架子（+ 若导出过则 PDF 可下）。用户知情自担（徽标默认「仅本机」明示）。
- 快照是 display 档（~1600px），仅供查看；高清 PDF 仍需本地原图。

## 10. 改动清单（最小面）

1. 迁移：`albums.photo_snapshot jsonb`。
2. `photoStore.getTierBlob(photoId, tier)`（抽自 `getTierUrl`）。
3. `album-service`：`signPhotoSnapshotUpload` / `confirmPhotoSnapshot`；detail 返回 `photoSnapshotUrls`。
4. 两个路由：`/api/v1/albums/{id}/photo-snapshot/sign`、`/confirm`。
5. 顶栏「保存」按钮 + 徽标语义（「仅本机 / 备份中 / 已备份 / 失败」）+ 保存编排（收集→sign→PUT→confirm）。
6. `resolveImage` 回退（EditorBook / 预览）。
7. 只读姿态（本地缺图 → 导出换下载）。
8. 状态规则：编辑 `COMPLETED` → 退回 `EDITING`。
9. 删除相册时清 R2 `photo-snapshots/` 前缀。
