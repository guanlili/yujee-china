# Photo Snapshot — 手动备份让历史书不空白

- Status: Approved design — 2026-07-17
- Scope: `apps/web` only（无 Agent/Fly 改动、无跨服务协议改动）
- Owner module: `apps/web/src/services/album/`
- Current contract note: 2026-07-28 LUT follow-up adds immutable per-render versions;
  the model and routes below reflect the shipped contract.

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
- `photo_snapshot jsonb`（nullable）—— 形如
  `{ "photoIds": ["p1","p2"], "renderVersions": {"p1":"pf-v1__original"}, "updatedAt": "<ISO>" }`。
  `photoIds` 保留存量兼容,`renderVersions` 记录每张照片最后确认成功的精确派生版本;
  `null` = 从未备份。
- 迁移：加一列 nullable `jsonb`，无回填风险（现有行 = `null` = 未备份）。

新 R2 key 约定：
- `photo-snapshots/{userId}/{albumId}/{photoId}/{renderVersion}.jpg`
- 公开 URL 由 `r2.publicUrl(key)` 推导。
- 存量 `photo-snapshots/{userId}/{albumId}/{photoId}.jpg` 只作读取兼容;所有新签名都带版本。

## 5. 组件与数据流

### 5.1 保存（客户端主导，mirror 现有 PDF/封面直传）

触发：顶栏「保存」按钮。步骤：
1. 收集本书用到的 photoId,冻结规范化 `photoFilter`,为每张计算
   `effectiveRenderVersion`;只保留服务端 `renderVersions` 不匹配的 `SnapshotEntry`。
2. 每个待传 entry 用 `photoStore.getTierBlobStatus(photoId, 'display', frozenFilter)`
   取精确派生 JPEG。正强度滤镜若只能回退原片,不得冒充成功版本上传。
3. `POST /api/v1/albums/{id}/photo-snapshot-upload-url`（body
   `{ entries: [{ photoId, renderVersion }] }`）→ 返回精确相关的签名 entry。
4. 浏览器限并发（4）`PUT putUrl`（body = blob，`content-type: image/jpeg`）；后台、不阻塞编辑、单张失败有限重试。
5. `POST /api/v1/albums/{id}/photo-snapshot`（同一 entries 形状,**只含确实 PUT 成功的**）
   → 服务端在 album 行锁内按 photoId 合并精确版本。
6. 封面缩略图走独立 CAS:签名返回绑定滤镜、`updatedAt` 与第 0 页状态的
   `coverRevision`,确认时重算并拒绝旧 revision。

徽标：点击 → 「备份中」→ 成功「已备份」/ 失败「备份失败，点重试」。

### 5.2 服务端（`album-service.ts` + 两个路由）

- `signPhotoSnapshotUpload(userId, albumId, entries)`：严格校验唯一 photoId 和
  `pf-v1` renderVersion,每个 entry 只签自己的不可变 key。
- `confirmPhotoSnapshot(userId, albumId, entries)`：album 行锁下只登记成功 entry;
  相同 photoId 的新版本替换记录,不同照片和并发确认不丢。
- album detail（`GET /api/v1/albums/{uuid}`）：返回
  `photoSnapshotUrls` + `photoSnapshotRenderVersions`;版本化记录走不可变 key,
  存量无版本记录安全回退旧 key。

### 5.3 渲染回退（`resolveImage`）

- 现状：`resolveImage(id) = imageUrls[id]`（仅本地派生 URL）。
- 改为：先本地（`photoStore.getTierUrl`），本地缺失则用 detail 带回的 `photoSnapshotUrls[id]`，都没有则空槽。
- 落点：EditorBook 的 `resolveImage`（`EditorPort.tsx`）；`AlbumCoverPreview` 已有「服务器封面 → 本地」回退，内页沿用同思路。**PDF 导出路径不变**（仍要本地原图，见 5.4）。

### 5.4 本地缺图时的只读姿态

- 判定：本书任一用到 photoId 在本地 IndexedDB 缺失（`photoStore.getBlob` 为空）→ 只读姿态。
- 顶栏「导出」置灰 / 换成「下载 PDF」（直接给 `album.pdfUrl`，若有）；**不允许用低清快照出 PDF**。
- 「保存」按钮：本地无高清也无法补齐备份，按钮态说明「需在有原图的设备上备份」。

### 5.5 Export / COMPLETED（几乎不变，仅补一条状态规则）

- 导出流程照旧：出 PDF → 浏览器直传 R2 → `confirmPdf` 落
  `pdfR2Key`/`pdfUrl` + 置 `COMPLETED`。封面缩略图是独立的 revision-bound 上传。
- **新增状态规则**：`COMPLETED` 之后再编辑（任一 pages PATCH / design-chat 写入命中 `status==='COMPLETED'` 的相册）→ 退回 `EDITING`，旧 `pdfUrl` 视为过期（不再展示为「最新已完成」，重新导出覆盖）。这条落点即收敛「已完成但内容已变」的风险。

## 6. 隐私 / 保留 / 计费

- 隐私：**原图永不离开浏览器**不变。压缩派生图仅在用户**主动保存**（或导出时的封面缩略图）时上传 R2 —— opt-in。更新 `photoStore` / 架构 invariant 注释：「派生图 opt-in 上传，限用户主动备份」。
- 保留：无 TTL。相册删除时的 R2 前缀 GC 尚未实现,留作独立 follow-up;当前删除 DB 行
  不会清理 `photo-snapshots/{userId}/{albumId}/` 对象。
- 计费：不受影响（计费在排版成功扣；备份不计费）。

## 7. 错误处理

- 单张 PUT 失败：有限次重试；仍失败 → 整体「备份失败」。**confirm 只登记确实 PUT
  成功的 entry**，部分成功不会谎报全备份。
- sign/confirm 的服务端错误走统一 API 错误码；客户端展示复用本仓已统一的报错口径（不露原始串）。
- 保存全程不阻塞编辑，失败可重试。

## 8. 测试

- 服务：sign 的命名空间/数量/唯一 entry/version;confirm 的行锁部分合并;
  detail 的 legacy/versioned URL + version map。
- 客户端（沿用本仓 `tsx --test` 源码断言风格，无 jsdom）：`resolveImage` 回退优先级;
  Save 只传版本不匹配 entries;只读姿态判定;COMPLETED 编辑退回 EDITING。
- 回归：导出流程 + `COMPLETED` 触发不变。

## 9. 已知取舍

- 从未点保存的书：换设备 / 清缓存后内页丢失，仅剩 JSON 架子（+ 若导出过则 PDF 可下）。用户知情自担（徽标默认「仅本机」明示）。
- 快照是 display 档（~1600px），仅供查看；高清 PDF 仍需本地原图。

## 10. 改动清单（最小面）

1. 迁移：`albums.photo_snapshot jsonb`。
2. `photoStore.getTierBlob(photoId, tier)`（抽自 `getTierUrl`）。
3. `album-service`：`signPhotoSnapshotUpload` / `confirmPhotoSnapshot`；detail 返回 URL + version map。
4. 两个路由：`/api/v1/albums/{id}/photo-snapshot-upload-url`、`/photo-snapshot`。
5. 顶栏「保存」按钮 + 徽标语义（「仅本机 / 备份中 / 已备份 / 失败」）+ 保存编排（收集→sign→PUT→confirm）。
6. `resolveImage` 回退（EditorBook / 预览）。
7. 只读姿态（本地缺图 → 导出换下载）。
8. 状态规则：编辑 `COMPLETED` → 退回 `EDITING`。
9. Deferred:删除相册时清 R2 `photo-snapshots/` 前缀（当前未实现）。
