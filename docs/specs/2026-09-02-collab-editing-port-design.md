# 协同编辑移植设计（黑客松 → 主站）

状态：待实施
决策日期：2026-09-02

## 1. 这份文档是什么

把 `yujee-hackathon-web` 上已上线的协同编辑整套搬进主仓。**不是重新设计协同** ——
产品模型、并发控制、授权模型都照收黑客松已验证的实现，本文只定移植的范围、切分和验证。

黑客松那边的原始设计文档随代码一起搬：
- `docs/plans/2026-08-28-creator-collaboration-rework.md`（386 行，最终真相）
- `docs/plans/2026-08-27-simple-reliable-collaboration.md`（1085 行，已标注「被取代」）

### 为什么现在做

2026-08-15 曾拍板搁置协同（理由：产品别处还差得多，不值这个投入）。现在理由变了 ——
黑客松那边已经把它做完并跑在线上，边际成本从「从零做」降到「移植」。

### 两仓关系

`yujee-hackathon-web` 是**独立 GitHub 仓 + 独立 Neon 库**，2026-08-23 从主仓拷出后
squash 成一条 init 提交。**两仓无共同 git 历史，不能 cherry-pick**。

## 2. 已拍板的三个决策

| 决策 | 结论 |
|---|---|
| 权限口径 | **照收**：owner 与 editor 都是完整 Creator |
| 移植手法 | **按 Phase 打逻辑包**，从两仓终态 diff 筛协同 hunk，不按提交序列重放 |
| 范围 | **全搬**，含未合并的列表入口分支 |

移植手法选按包不按提交，因为黑客松历史里有 Revert 对和重复提交，按序重放会白走弯路；
且只有终态被 1903 测试验证过，中间态没有。

## 3. 产品模型（照收）

### 3.1 角色只有两级

- **owner / editor 都是 Creator**：改内容、改结构、改设置、传照片、跑 AI、导出 PDF、建分享链接
- **owner 独有的治理权**三项：管理成员、删除相册、转移所有权

AI 是代表 actor 执行，不是独立角色。editor 跑 AI **花自己的积分**。

### 3.2 授权只有两个 seam

```
requireAccess / requireCreator(owner|editor)  →  所有作者读写路径
requireOwner                                   →  仅治理路径
```

主仓当前有 **16 处硬写** `album.userId !== userId`，黑客松已收口到 7 处（保留的是治理路径）。
**协作层第一件事就是收口** —— 逐点改必漏，漏一个就是越权。

### 3.3 能力模型是共享纯函数

`lib/collaboration/capabilities.ts` 是产品授权的唯一真相，服务端锁内检查与前端入口显隐
消费**同一份**定义，两端口径不可能漂移。前端显隐只是体验，每条能力后端都有锁内检查兜底。

## 4. 并发控制（照收）

| 维度 | 机制 |
|---|---|
| 页面 | OCC：`baseVersion` 条件保存，冲突 409 `EDIT_CONFLICT` |
| 结构 | `albums.draft_structure_revision`，结构变了增量同步整书重载 |
| 设置 | `albums.settings_revision`，OCC + 回滚提示 |
| AI 长任务 | 启动时锁内记基线，回写前锁内重验；失配 → `AI_RESULT_STALE`，**零写入**，人工编辑优先 |

增量同步 `GET /draft-changes?since=N`：返回 `version > since` 的单页增量；结构变了或超过
300 页 → `reloadRequired`，整书重载不猜增量。

## 5. 数据层变更

四个迁移，主仓当前停在 0027，**编号不撞**：

| 迁移 | 内容 |
|---|---|
| 0028 | `album_members`（album_id + user_id 联合主键）、`album_edit_links`（album_id 主键，token 只存 SHA-256 hash）、`albums.draft_structure_revision` |
| 0029 | `albums.settings_revision` |
| 0030 | 删 `uq_album_shares_album`，建 `idx_album_shares_album(album_id, created_at)` —— 一链接一行，editor 建分享不撤销 owner 已发的 |
| 0031 | `album_photos.uploaded_by`（FK users ON DELETE set null） |

> 本地 dev 库 `db:migrate` 跑不动（drizzle 账本漂移），这四个迁移**手工应用**。

## 6. 分包计划

移植规模：**89 文件 / 20 提交**（黑客松 main）+ **14 文件 / 462 行**（列表入口分支）。
其中 39 个是主仓不存在的新文件可直接新建，50 个既有文件需逐 hunk 处理。

**冲突面只有 6 个文件**：`album-service.ts`、`job-service.ts`、`EditorPort.tsx` 及三个测试。
主仓 8/23 后的 29 个提交几乎全在 design 层（五色配色、风格三修），与权限层不重叠。

### 包 0：读路径欠账核实（前置）

draft_pages 拆表的读路径切换（Task 8-11）从没做，主仓 `readStoryDraft(album.draftJson)`
还有 5 个裸读调用方。协同的增量同步整个建立在 draft_pages 的 version 上。

**只核实会被协同放大的部分**，不做全面清理 —— 那是独立线上隐患，单独治。
重点核实 `getInternalAgentData` 的 page-info/chapter-search 是否 pageIndexes 恒空静默降级。

### 包 1：数据层地基

迁移 0028-0031 + meta 快照 + `_journal.json`；`schema.ts` 加两表三列；
新建 `album-member-repo` / `album-edit-link-repo`；`album-share-repo` 的
`upsertByAlbum` → `create`。**无行为变化**，只加表和列。

### 包 2：授权 seam + 邀请

`services/collaboration/*`（service + errors）、`lib/collaboration/capabilities.ts`；
16 处硬写收口到 requireAccess / requireOwner；`error-codes.ts` / `err.ts` /
`from-exception.ts` 加协同错误码；三个路由（`edit-link`、`members`、
`edit-links/[token]/redeem`）；`/[locale]/join/[token]` 页面。

邀请就绪门槛（`invitationReadiness` 纯函数）：V3 draft 已播种 + 无在途 layout/compose/add job
+ 页面引用的照片全部 uploaded。redeem 走 `requireRealUser`，**游客账号不进成员关系**。

### 包 3：页面 OCC + 增量同步

`draft-page-repo` 的 version/updatedBy；`pages/[idx]` 路由加 `baseVersion`；
`pages/reorder`；`draft-changes` 路由；`albums/[uuid]` 路由的 role 投影与 settingsRevision；
`draft-store.ts`；album-service 各结构写点推进 `draftStructureRevision`。

### 包 4：分享 / 导出 / 照片 Creator 化

- 分享：`createShare` 锁内 Creator 检查；快照 URL 固定 **owner** 命名空间
- 导出：`signPdfUpload` 改 requireAccess；R2 key 改 `pdfs/{albumId}/{exportId}.pdf`，
  协作者导出不互相覆盖；confirm 锁内校验 key pattern（先提取 albumId 段再比，
  不把 albumId 内插正则）
- 照片：上传链路 Creator 化 + `uploaded_by` 署名 + **防覆盖闸**（已 uploaded 的 photoId
  不再签发 —— 签名 PUT 恒覆盖写，重签等于静默覆盖他人上传的原始字节）

### 包 5：AI 基线

7 个 AI 入口 Creator 化；`createGenerationJob` 在同一把 album 行锁内记
`meta.baseline`（只有 layout/compose 记）；两个回调入口锁内 `findBaselineStaleReason`，
失配 → job FAILED + `AI_RESULT_STALE` + 零写入 + compose 释放计费 hold；
三处 `replaceAll` 的 updatedBy 从 null 改为 `job.userId`。

**无基线的旧 job 放行**（历史行为兼容）。

### 包 6：前端 capabilities 收口 + 协作面板

`lib/collaboration/` 客户端五件（collaboration-client、draft-sync、page-save-coordinator、
page-save-transport、settings-save-transport）；`CollabPanel.tsx`；EditorTopbar 与
MobileEditorRoot 的治理入口判据改走 `capabilitiesForRole`；ChatPanel 的
`lastComposeStale` 文案；冲突 UI 四维度（page / structure / settings / AI stale）。

> **CollabPanel 是新弹窗，z-index 必须 < 300** —— 手工白名单 `canvasScopes` 已在 8/20 删除，
> 新入口按钮点不动的病根踩过三次。

### 包 7：列表入口（共享书进「我的相册」）

来自未合并分支 `origin/feat/shared-albums-list-v2`（头 `0f3c390`，9 个提交，14 文件 / +462)。
`album-repo` 的 `findSharedWithUser` 跨用户查询、`my-albums/page.tsx` 的 role 标记与协作徽标、
五语文案键、共享书轮询（有界慢轮询后完全停止，不无限轮）。

**风险已知**：这条分支在黑客松那边没合并没上线，十三轮审查修复还在往里打。放在最后一包，
单独验证。好消息是主站 `my-albums/page.tsx` 与黑客松只差 5 行，`album-repo.ts` 和
`AlbumCoverPreview.tsx` 完全相同 —— 几乎没有分叉成本。

## 7. 验证

每包独立验证，全绿才进下一包：

1. `pnpm typecheck`
2. `apps/web` 目录下跑测试（**不在仓根跑** —— 仓根 `pnpm test` 会倒在 design-agent 环境）
3. 包 2 之后每包补 owner / editor / stranger 三态测试
4. 全部包完成后跑 `scripts/acceptance-collab.ts`（双身份 15 项端到端）
5. 迁移链干净库验证：新建测试库从 0 应用全部 32 个迁移，schema 断言后删库

### 源码正则守卫的坑

`collab-read-seam.test.ts` 是源码正则守卫（钉 getStoryProgress / listCoverSets 必须走 seam）。
这类测试**会被注释喂饱** —— 断言前必须剥注释，守卫写完必须跑 mutation 验证它真的会红。
绿不是证据。

## 8. 不做的事

- **不做实时协同**（无 WebSocket、无 CRDT、无光标）。轮询增量同步就是全部。
- **不做选择性应用 AI 结果**：基线失配一律全拦，不做「只覆盖未变页」。
- **不做快照 key 迁移到 albumId 命名空间**：读侧三处需要存量回退逻辑，成本大于收益。
- **不重新引入「存在成员就冻结」** 作为并发控制的替代方案。
- **不做删除照片 API**：规则已定义（只能删自己上传且未被页面引用的），留给未来。

## 9. 分支与提交

从 main 开 `feat/collab-editing` 新分支（8/15 删掉的旧同名分支已不可用，别去找）。
一包一提交，每包实现完派 review agent 评审 diff，发现的问题逐项修复并验证，全部通过才提交。
