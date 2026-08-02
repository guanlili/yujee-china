# 共同编辑(异步协作)设计

日期:2026-08-02 · 分支:`feat/collab-editing` · 状态:待实施

## 背景与目标

给相册增加多人共同编辑能力:Owner 邀请家人进入编辑器,各自在不同时间编辑同一本书,
互不覆盖。这是家庭纪念册场景的核心诉求。

**产品决策摘要**(讨论已定,不再重开):

| 维度 | 决策 |
|---|---|
| 协作形态 | 异步协作。不做实时光标/CRDT,不要求同屏可见,但绝不互相覆盖 |
| 照片 | 协作者可加照片;**全部照片真相迁 R2**(含 Owner 的,历史「换设备丢图」一并解决) |
| 邀请权限 | 链接邀请 + 必须登录(better-auth),单一「编辑者」角色,Owner 可撤销 |
| 冲突策略 | 页级软锁(TTL)+「XX 正在编辑这页」占用提示;版本 CAS 兜底 |
| 协作范围 | 仅编辑器阶段(书生成之后)。生成链路(分章/采访/选版/成稿)保持单人 |
| AI 改书 | 对协作者开放,但同一时刻整册只允许一个活跃 design-chat 会话(全书级软锁) |
| 架构 | 纯 Postgres + 轮询,draft 拆页级行。不引入 WebSocket/第三方实时通道 |

**非目标**:实时协同(光标/秒级同步)、协作者参与生成链路、多角色(只读等)、
协作者自付积分、匿名协作。这些都明确不在本次范围,部分可作后续升级。

## 分期

两个可独立上线的阶段,各出各的实施计划:

- **Phase 0 —— 照片真相迁 R2**:前置子工程,不含任何协作功能。完成后单人产品行为
  不变,但照片持有模型换底。对老用户独立有价值(换设备不丢图)。
- **Phase 1 —— 协作层**:成员/邀请/页锁/轮询/design-chat 串行化。依赖 Phase 0。

分开的理由:照片迁移触碰导出、滤镜、快照等既有链路,风险与协作功能正交,混在一起
上线出问题无法定位。

---

## Phase 0:照片真相迁 R2

### 存储与格式

- 规范原图 key:`photo-originals/{albumId}/{photoId}.jpg`。**按册组织,不按 userId**
  ——照片归属从「人」变成「册」,这是协作的前提。
- 存打印级压缩版:长边约 3000px、JPEG q85(实施时定参)。PDF 是 794×1123 栅格导出,
  3000px 长边足够 3x 缩放。浏览器 IndexedDB 里更高清的本机文件仍保留,但降级为
  本机缓存红利,不再是真相。
- 上传走 R2 presign PUT,复用现有 presign 基建(快照/PDF 已在用)。

### 新表 `album_photos`

photoId、albumId、宽高、字节数、上传状态(`pending`/`uploaded`/`missing`)。
Phase 1 再加 `uploadedBy`。照片「在册」的判定以此表为准。

### 链路变化

- `apps/web/src/lib/photo/store.ts` 语义反转:IndexedDB 从「唯一持有」降为「缓存」。
  取图顺序:本地缓存 → R2 presigned GET 拉取回填缓存。
- 新照片入库:本地压缩出规范原图 → presign 上传 → confirm 落 `album_photos` 行。
- 滤镜引擎不动(仍浏览器 WebGL,只处理派生像素);基图可能来自 R2。
- `photo-snapshots/{userId}/{albumId}/{photoId}/{renderVersion}.jpg` 分享快照链路
  **原样保留**——它冻结的是滤镜后的展示态,与原图真相是两回事。
- 导 PDF/生成派生物缺本地图时从 R2 拉,不再有「换设备导不了」。

### 新 API(Phase 0)

- `POST /api/v3/albums/[uuid]/photos/presign`:批量取原图上传 presign PUT。
- `POST /api/v3/albums/[uuid]/photos/confirm`:`{ entries: [{photoId, width, height, bytes}] }`,
  只记成功项(与快照 confirm 同款语义)。
- `GET /api/v3/albums/[uuid]/photos/[photoId]/url`:presigned GET(私有桶)。

### 存量迁移

- 老册在 Owner 下次打开时,浏览器把 IndexedDB 原图后台补传(带进度、按 photoId 幂等、
  可断点续传)。
- album 记 `photos_migrated` 状态;**Phase 1 的邀请入口以它为门槛**。
- 已丢图的老册(用户清过浏览器):能补多少补多少,缺的在 `album_photos` 标 `missing`,
  不阻塞该册单人使用。

### 产品面注意

- **隐私文案必须改**:从「照片不离开你的设备」改为云端存储表述。营销/法务层面变化,
  上线前需人工过一遍对外文案。README/CLAUDE.md 的「原图由 Browser 持有」边界描述
  同步改写。
- R2 成本上升(每册几十张 × 1–2MB),量级可控。废弃册的存储回收策略本期只留 TODO。

---

## Phase 1:协作层

### 数据模型

**`album_members`** —— 成员关系
- `albumId` / `userId` / `role`(v1 仅 `'editor'`,留枚举扩展)/ `invitedBy` /
  `joinedAt` / `revokedAt`(软删,保归因)。
- Owner 不占行,owner 判定仍走 `albums.userId`。「有编辑权」= owner 或未撤销 member。

**`album_invites`** —— 邀请链接
- `albumId` / `token`(随机不可枚举)/ `createdBy` / `expiresAt`(默认 7 天)/
  `maxUses`(默认不限)/ `revokedAt`。
- 流程:访问 `/invite/[token]` → 登录 → 落 `album_members` → 跳编辑器。

**`album_edit_locks`** —— 页锁与 AI 锁统一存放
- `albumId` / `scope`(`'page:{pageIndex}'` 或 `'ai-session'`)/ `holderId` / `expiresAt`。
- 唯一约束 `(albumId, scope)`。拿锁/续锁同一个 upsert:锁不存在、已过期、或本就是我的
  → 成功;否则返回持有人给前端显示占用。
- TTL 60 秒,轮询自然续锁。断网无需清理任务,过期即释放。

**`draft_pages`** —— draft 拆表(替代 `albums.draftJson` 的页数组)
- `albumId` / `pageIndex` / `page`(jsonb,仍是 contracts `Page` 形状:
  templateId/images/texts/html)/ `version`(int,每写 +1)/ `updatedBy` / `updatedAt`。
- 保存协议:**持锁 + CAS**。请求带 `expectedVersion`,服务端校验「锁是我的 && 版本匹配」
  才写,否则 409 带最新内容。
- 整册级元数据(封面选择、photo_filter、章节结构)留在 `albums` 行,不拆。
- 存量 `draftJson` 一次性迁移脚本拆行;`readStoryDraft`、组页落库、design-chat 回放、
  分享冻结等读写路径全部切到 `draft_pages`。**这是 Phase 1 最大的一笔工程。**

### 编辑器协作行为

- **单一轮询端点** `POST /api/v3/albums/[uuid]/collab-sync`,body 带
  `{ editingPage, since }`(POST 因为它有副作用:续锁 + 记 presence)。`since` 是
  上一次同步返回的服务器时间戳;响应返回:在线成员(15 秒内有心跳)、活跃锁列表、
  `updatedAt > since` 的页号及其 version、本次服务器时间戳(作下轮 `since`)。
  编辑器每 10 秒一次;拉到「某页有新版本」就增量取那几页刷新画板。
- **心跳即续锁**:不单发心跳请求,serverless 下省一半调用。
- **进入页编辑 = 抢锁**:点进文字框/拖图前先拿 `page:{i}` 锁;拿不到则该页只读并显示
  占用者。离开页或 30 秒无操作主动释放。
- **CAS 兜底**:锁逻辑任何漏(TTL 边缘、时钟偏差)的最后防线是版本校验,最坏情况
  「保存失败刷新重做」,永不静默覆盖。

### design-chat 串行化

- 发起 AI 会话先抢 `ai-session` 锁(TTL 60 秒,对话轮次自动续)。占用期间其他人的
  AI 入口置灰并显示「XX 正在和 AI 改书」。
- AI 写工具落页同样走 `draft_pages` 版本 CAS(`updatedBy` 记会话发起人)。**AI 写入
  不抢页锁**(一轮可能批量改多页,逐页抢锁不现实):撞上他人正在手动编辑的页时,
  以版本 CAS 定序——后写的一方 409。AI 侧 409 由 design-chat 路由刷新该页后重放
  该轮写工具(复用现有回放机制);手动侧 409 走统一的「已被改过,刷新重做」提示。
- **Design Agent 服务零改动**:单机、进程内存 session 约束不变——串行化在 Web 侧完成。
  会话所有权换人时,Web 照常先 `POST /api/book` 推最新书状态,天然重建上下文。
- AI 积分消耗记 **Owner** 账上(邀请即授权,v1 不做协作者自付)。

### 新 API(Phase 1)

| 端点 | 权限 | 说明 |
|---|---|---|
| `POST /api/v3/albums/[uuid]/invites` | Owner | 生成邀请链接 |
| `DELETE /api/v3/albums/[uuid]/invites/[id]` | Owner | 撤销邀请链接 |
| `POST /api/invites/[token]/accept` | 登录用户 | 接受邀请落成员行 |
| `GET /api/v3/albums/[uuid]/members` | Owner | 成员列表 |
| `DELETE /api/v3/albums/[uuid]/members/[userId]` | Owner | 撤销成员(软删) |
| `POST /api/v3/albums/[uuid]/collab-sync` | 成员 | 轮询 + 心跳 + 续锁 |
| `POST /api/v3/albums/[uuid]/pages/[index]/lock` | 成员 | 抢/释放页锁(DELETE 释放) |
| `PUT /api/v3/albums/[uuid]/pages/[index]` | 成员+持锁 | 页保存,`{page, expectedVersion}` → 200 `{version}` \| 409 `{latest}` |

### 权限边界

既有 album 路由的 ownership 校验全部重分类为「owner-only」或「成员可用」,实施计划里
逐端点列清单。原则:

- **Owner 专属**:成员/邀请管理、删册、创建公开分享、全书滤镜与单张滤镜覆盖
  (作废派生物的全册级操作)、封面确认、全书级换主题/重烘、重跑生成链路。
- **成员可用**:页内改字/换版/调图(持页锁)、加照片、design-chat(持 ai-session 锁)、
  导出 PDF(纯读,Phase 0 后任何成员的浏览器都拿得到全部照片)。

### 错误处理

- 抢锁失败 → 该页只读 + 占用者提示(语义化错误码,非裸 409)。
- 保存 CAS 409 → 返回最新 page + version,前端提示「这页刚被 XX 改过,已刷新」;
  用户未保存输入暂存 localStorage 供找回(找回 UI 可后置)。
- 成员被撤销 → 下次轮询/保存收 403,前端退出编辑器回相册列表。
- 邀请 token 过期/撤销 → 落地页明示失效。
- `photos_migrated` 未完成的册开协作入口 → 403 + 引导完成照片云备份。
- 照片 `missing` → 占位图渲染,不阻塞他人编辑。

---

## 迁移与部署

- Phase 0、Phase 1 各自独立部署批次。engine(生成 Agent)与 design-agent **零改动**,
  不触碰跨服务契约,Web/Agent 同版本部署约束不受影响。
- `draftJson` → `draft_pages` 迁移脚本要求幂等可重跑;schema 迁移与数据回填分批
  (本次无新枚举值,没有 0020 那类同事务限制,但保持分批习惯)。
- 迁移后 `albums.draftJson` 保留只读一个观察期,确认无读路径遗漏后再清列。
- README / CLAUDE.md / apps/web/README.md 的照片边界、表清单、doc-scope `checked-at`
  随实现更新。

## 测试策略

- **锁语义**:过期抢占、续锁、互斥、`(albumId, scope)` 唯一性(真库集成测试)。
- **权限矩阵**:owner / member / revoked member / 陌生人 × 全部新旧端点。
- **CAS 路径**:并发写 409、409 后带最新内容、AI 写工具 409 重放。
- **邀请生命周期**:过期、撤销、重复接受、登录跳转。
- **draft 拆表迁移**:fixtures 册迁移前后页数与 html 逐字节对比;`readStoryDraft`
  切换回归。
- **Phase 0**:上传 confirm 幂等、缓存回填、缺图占位、快照链路不回归。
- **手动走查**:双浏览器双账号同册清单(撞页、撞 AI、撤销成员、断网锁过期)。

## 开放问题(不阻塞实施,上线前需拍板)

1. 隐私对外文案与法务确认(Phase 0 上线门槛)。
2. 规范原图压缩参数(长边/质量)实施时以真实导出效果定。
3. 废弃册 R2 存储回收策略(本期 TODO)。
4. CAS 409 后 localStorage 找回 UI 是否做进 v1。
