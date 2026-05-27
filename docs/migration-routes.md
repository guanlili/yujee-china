# Migration · 路由对照表(老 memoir-web → memoir-agent-rebuild)

> **B0 窗口产出**。其它批次开工前请先读本文与 [`migration-plan.md`](./migration-plan.md)。
>
> 老仓库口径:`yvaineyu9/memoir-web@codex-merged-all-20260526`(共 **18 页 + 18 API**)。
> 新仓库口径:本仓库 `docs/architecture.md` + `docs/web/api.md`。
> 老路径里的 `[locale]` 前缀和 route group(`(marketing)` 等)在对照时省略,只列对用户可见的 URL。

---

## 路线 A 签字(memoir 21 模板合并方案)

**采用路线 A**:从 `yvaineyu9/memoir@main` `frontend/layouts/*.jsx` 抽 21 个模板,迁到 `apps/web/src/components/album/templates/`(`.tsx`),PDF 走浏览器 `@react-pdf/renderer`。memoir 仓库的 Python 引擎(`engine/`)**整个不要**,只搬模板源 + `frontend/schema.js` 模板元数据(给 B-1 用于填 `packages/contracts/src/templates.ts`)。

**不破不变式 4 的说明**:
- 不变式 4 = "PDF 由浏览器生成,通过 presigned PUT 上传 R2,Web 不接 PDF 流量"。
- 路线 A 把模板编译进 Web bundle,浏览器拿到 layoutJSON → 用 React 模板渲染 → 用 `@react-pdf/renderer` 在浏览器内出 PDF → 走 `pdf-upload-url` 签 URL 直传 R2 → 调 `pdf` PUT 通知 Web 元数据落库。整条链路 PDF 字节流**不经过 Web server**,符合不变式 4。
- 路线 B(Chrome headless 在服务端出 PDF)会引入服务端 PDF 流量、破坏 R2 直传、并要给 Agent / 单独 renderer 接 R2 写入凭据 —— 与不变式 4 直接冲突,**不采纳**。

**Signed off**: Route A confirmed by Claude Opus (B0 window) on 2026-05-27. 后续 B8 按本签字推进;若需改路线必须先回到 B0 重开。

---

## 0. 速查总览(老 → 新)

| 维度 | 老 memoir-web | 新 memoir-agent-rebuild |
|---|---|---|
| 页面总数 | 18 | 15(砍 3:`/album/[uuid]/print` + `/privacy-policy` 别名 + `/terms-of-service` 别名)|
| API 总数 | 18 | 20(老 18 中:5 个 1:1 保留 + 7 个合并/拆/重命名 + 4 个砍 + 2 个 admin 1:1;新增 6 个无老对应;详见 §6-§11)|
| 路径别名 | `privacy-policy` / `terms-of-service` 与 `privacy` / `terms` 并存 | 只保留 `privacy` / `terms`,别名一并砍 |
| Dashboard 入口 | `/my-creations` | `/my-albums` |
| Album 详情页 | `/album/[uuid]` + `/album/[uuid]/print` 两页 | 仅 `/album/[uuid]`,PDF 在编辑页内导出 |
| 生成入口 | `/api/v1/albums/[uuid]/generate` | 合并进 `POST /api/v1/jobs` |
| 编辑 chat | `/chat` 一个路由 GET+POST 复用 | 拆 `POST /chat`(转 Agent)+ `GET /messages`(历史)|
| 支付出口 | `/checkout`(album 维度 Creem 下单)| **砍**:改积分制(用户充值积分 → 生成扣积分),Creem checkout 走 client-side 直连 + webhook,见 B4 |
| PDF 出口 | `/pdf` POST(上传) + `/export` GET(下载 URL)| 合并到 `/pdf`(PUT 上传 + GET 下载),并新增 `/pdf-upload-url` 签 presigned PUT |
| Photos 接口 | `POST/GET /photos`、`/order` | **整组砍**,原图留浏览器 IndexedDB |
| R2 原图上传 | `POST /api/v1/upload` | **永远不做**(违反不变式 1)|
| 支付 webhook | 仅 Stripe | Stripe + Creem 双通道 |
| Job 状态 | 无(状态在 album 上)| `agent_jobs` 表 + `/api/v1/jobs/[requestId]` 轮询 |
| Agent 回调 | 无 | `POST /api/v1/internal/job-progress` |
| Credit/积分接口 | 无独立路由 | `/api/v1/credit/balance` + `/credit/history` |

---

## 1. Marketing 区(老 6 → 新 4)

| 老路由 | 新路由 | 备注 |
|---|---|---|
| `/` | `/` | 营销首页,内容重写但路由保留 |
| `/pricing` | `/pricing` | 重写为新套餐(参考 B4)|
| `/privacy` | `/privacy` | 内容沿用,品牌字样改 Yujee |
| `/terms` | `/terms` | 同上 |
| `/privacy-policy` | ❌ **砍** | 老仓为兼容 SEO 留的别名,新仓不需要 |
| `/terms-of-service` | ❌ **砍** | 同上 |

> 砍别名理由:新项目是全新域名 yujeeai.com,无历史 SEO 包袱,统一短路径。

---

## 2. Auth 区(老 2 → 新 2)

| 老路由 | 新路由 | 备注 |
|---|---|---|
| `/login` | `/login` | better-auth,继续支持 Google OAuth + Magic Link |
| `/register` | `/register` | 同上 |

---

## 3. Tool 区(老 3 → 新 2)

| 老路由 | 新路由 | 备注 |
|---|---|---|
| `/create` | `/create` | 上传 + 触发首次生成。新版浏览器侧 Canvas 压缩到 800px 后以 base64 走 `POST /api/v1/jobs`,不再走 `/api/v1/upload` |
| `/album/[uuid]` | `/album/[uuid]` | 编辑器自带 Chat 面板 + 双击就地编辑;PDF 也在本页内导出 |
| `/album/[uuid]/print` | ❌ **砍** | PDF 走浏览器 `@react-pdf/renderer`,不需要独立 print 页面(对应不变式 4)|

---

## 4. Dashboard 区(老 3 → 新 3)

| 老路由 | 新路由 | 备注 |
|---|---|---|
| `/my-creations` | `/my-albums` | **改名**,语义更准确(参见 architecture §0 产品基线)|
| `/credits` | `/credits` | 积分余额 + 充值入口 |
| `/settings` | `/settings` | 账号设置 |

---

## 5. Admin 区(老 4 → 新 4)

| 老路由 | 新路由 | 备注 |
|---|---|---|
| `/admin` | `/admin` | Admin 首页 |
| `/admin/users` | `/admin/users` | 用户列表 |
| `/admin/analytics` | `/admin/analytics` | 数据 |
| `/admin/settings` | `/admin/settings` | 全局配置 |

> 4 个 admin 路由一对一保留,内部组件按 `docs/web/directory.md` 重写。

---

## 6. API · 一对一保留(老 5 → 新 5,路径或语义微调)

| 老路由 | 新路由 | 备注 |
|---|---|---|
| `/api/auth/[...all]` | `/api/auth/[...all]` | better-auth catch-all,保留 |
| `/api/health` | `/api/v1/health` | **路径前缀加 v1**,纳入版本命名空间 |
| `/api/v1/user/me` | `/api/v1/user/me` | 当前用户 |
| `/api/v1/user/billing` | `/api/v1/user/billing` | 用户账单概览 |
| `/api/webhooks/stripe` | `/api/webhooks/stripe` | Stripe webhook,内部 service 重写 |

---

## 7. API · 合并 / 拆分 / 重命名(老 7 → 新 7 个目的地 route.ts)

| 老路由 | 新路由 | 变化 | 备注 |
|---|---|---|---|
| `/api/v1/albums` (GET/POST) | `/api/v1/albums` (GET) | **POST 拆分**:创建动作并入 `POST /api/v1/jobs` 的初始化逻辑;此处只剩 GET 列表 | 见 `docs/web/api.md §1` |
| `/api/v1/albums/[uuid]` | `/api/v1/albums/[uuid]` | GET/PATCH/DELETE 保留 | 一对一(单 route.ts 多 method)|
| `/api/v1/albums/[uuid]/generate` | `POST /api/v1/jobs` | **合并**:统一为 fire-and-forget,返回 `requestId`(与上一行 `/albums` POST 共同合并到 `/jobs`)| 见 architecture §2.1 |
| `/api/v1/albums/[uuid]/pages` (GET) | `/api/v1/albums/[uuid]/pages/[idx]` (PATCH) | **从读列表改为精确改单页**。整本读直接走 `GET /api/v1/albums/[uuid]`(album 详情已带 layout) | 见 `docs/web/api.md` |
| `/api/v1/albums/[uuid]/chat` (POST + GET) | `POST /api/v1/albums/[uuid]/chat` + `GET /api/v1/albums/[uuid]/messages` | **拆两个端点**:POST 转 Agent 同步 chat-edit,GET 读 `album_messages` 历史 | architecture §2.2 + agent/design §13 |
| `/api/v1/albums/[uuid]/pdf` (POST) | `/api/v1/albums/[uuid]/pdf` (PUT) | **方法重命名**:语义不变,仍是浏览器渲完 PDF 后通知服务端落元数据;POST→PUT 对齐 RESTful 幂等约定 | 不变式 4 |
| `/api/v1/albums/[uuid]/export` (GET) | `/api/v1/albums/[uuid]/pdf` (GET) | **重命名**:GET 走签名 URL 重定向下载,合并到 `/pdf` 路径下(与上一行共享 route.ts)| 不变式 4 |

> 行数说明:7 条老路由 → 7 个新目的地 route.ts(其中 `/jobs` 是 2→1 合并、`/pdf` PUT+GET 共用 1 个 route.ts;`/chat` 拆 2 个 route.ts;`/pages` 改子路径)。具体 method 对照见各行"新路由"列。

---

## 8. API · 砍掉(老 4 → 0)

| 老路由 | 砍掉原因 |
|---|---|
| `/api/v1/upload` | **违反不变式 1**(原图永不写库 / 不存 R2)。浏览器压缩后 base64 直接走 `POST /api/v1/jobs`,服务端不落原图 |
| `/api/v1/albums/[uuid]/photos` (POST/GET) | 同上原因。原图永远不出浏览器,无需独立 photos 接口;编辑期靠 `PATCH /pages/[idx]` 维护 layout 关系 |
| `/api/v1/albums/[uuid]/order` | 订单查询并入 `/api/v1/user/billing` + Creem/Stripe webhook 落库,无独立路由 |
| `/api/v1/albums/[uuid]/checkout` | 老仓是"按本下单"模型,POST 创建针对单 album 的 Creem 订单。新项目改为**积分制**(`/credit/balance` + `/credit/history`):用户在 dashboard 充值积分(走 Creem Hosted Checkout 直连或前端 SDK 跳转),album 生成时直接扣积分,不再需要 album 维度的 checkout 端点。完整实现见 B4 |

---

## 9. API · 真新增(新有、老无,6 个)

> `POST /api/v1/jobs` **不在**本节 —— 它是 §7 中两条老路由(`/albums` POST + `/generate`)的合并目的地,已在 §7 计入。这里只列**没有任何老 endpoint 喂入**的纯新路由。

| 新路由 | 用途 | 出处 |
|---|---|---|
| `/api/webhooks/creem` | Creem 支付 webhook(海外主通道;老仓只有 Stripe)| architecture §0 + B4 |
| `GET /api/v1/jobs/[requestId]` | 浏览器 2s 轮询任务进度(老仓无独立 job 模型,状态挂在 album 上)| architecture §2.1 |
| `POST /api/v1/internal/job-progress` | Agent → Web callback,事件 `progress` / `completed` / `failed`(老仓 Web 自己跑生成,无 callback)| architecture §2 + agent/contract §2.1 |
| `GET /api/v1/credit/balance` | 积分余额(老仓无积分系统)| B4 |
| `GET /api/v1/credit/history` | 积分流水 | B4 |
| `POST /api/v1/albums/[uuid]/pdf-upload-url` | 签 R2 PUT presigned URL(老仓 PDF 走 server-side 路径,无此端点)| 不变式 4 |

---

## 10. API · Admin(老 2 → 新 2,保留)

| 老路由 | 新路由 | 备注 |
|---|---|---|
| `/api/v1/admin/recover-stuck` | `/api/v1/admin/recover-stuck` | 配合 zombie sweeper(agent/design §7)使用 |
| `/api/v1/admin/cleanup-photos` | `/api/v1/admin/cleanup-photos` | 兜底清理 |

---

## 11. 行数核对

> **计数口径**:本表全部按 **route.ts 文件数**(distinct path)算,**不按 (method, path) 对**算。一个 `route.ts` 里挂多个 method(如 `/albums/[uuid]` 的 GET/PATCH/DELETE、`/pdf` 的 PUT/GET)只算 1。

### 老 memoir-web

**页面 = 18** ✅(实测 `find src/app -name page.tsx`)
- 6 marketing(`/`、`/pricing`、`/privacy`、`/terms`、`/privacy-policy` 别名、`/terms-of-service` 别名)
- 2 auth(`/login`、`/register`)
- 3 tool(`/create`、`/album/[uuid]`、`/album/[uuid]/print`)
- 3 dashboard(`/credits`、`/my-creations`、`/settings`)
- 4 admin(`/admin`、`/admin/users`、`/admin/analytics`、`/admin/settings`)
- 合计 6 + 2 + 3 + 3 + 4 = 18 ✅

**API = 18** ✅,按本表 §6 + §7 + §8 + §10 拆:
- §6 一对一保留 = 5
- §7 合并 / 拆 / 重命名 = 7
- §8 砍掉 = 4
- §10 admin = 2
- **合计 5 + 7 + 4 + 2 = 18** ✅

### 新 memoir-agent-rebuild

**页面 = 15**
- 4 marketing(砍 2 个别名)+ 2 auth + 2 tool(砍 `/print`)+ 3 dashboard(`/my-creations` 改名 `/my-albums`)+ 4 admin

**API = 20**,按本表拆口径:
- §6 1:1 保留 = 5
- §7 合并 / 拆 / 重命名 的**新目的地** = 7 个 route.ts:
  - `/api/v1/jobs`(老 `/albums` POST + `/albums/[uuid]/generate` 共同合并)
  - `/api/v1/albums`(只剩 GET)
  - `/api/v1/albums/[uuid]`(GET/PATCH/DELETE)
  - `/api/v1/albums/[uuid]/pages/[idx]`
  - `/api/v1/albums/[uuid]/chat`
  - `/api/v1/albums/[uuid]/messages`(从 `/chat` GET 拆出)
  - `/api/v1/albums/[uuid]/pdf`(PUT 来自老 `/pdf` POST,GET 来自老 `/export`)
- §9 真新增 = 6
- §10 admin = 2
- **合计 5 + 7 + 6 + 2 = 20** ✅

### 与 `docs/web/api.md §1` 的口径差异(澄清)

`docs/web/api.md §1` 表格本身列 **18 行**(按 method, path)、对应 **15 个 distinct route.ts 文件**,范围仅覆盖 `/api/v1/*` 业务接口和 webhooks。下面 **5 个 route.ts** 在新项目里仍要写,但**未列入 api.md §1**(分别由其他文档管):

| 路由 | 谁管 |
|---|---|
| `/api/auth/[...all]` | better-auth 自动挂载,无业务 logic;见 B1 起手文档 |
| `/api/v1/user/me` | 见 `docs/web/database.md` users 表 + B5 dashboard |
| `/api/v1/user/billing` | 见 B4 账单轨道 |
| `/api/v1/admin/recover-stuck` | 见 agent/design §7 zombie sweeper + B6 |
| `/api/v1/admin/cleanup-photos` | 见 B6 admin 轨道 |

所以:**新项目 route.ts 总数 = api.md §1 的 15 + 上表 5 = 20** ✅,与本节上面拆口径一致。
若读者按 (method, path) 数,新项目是 18(api.md §1)+ 上表 5(各 1 method)= **23 (method, path)**。本表统一用 route.ts 口径。

---

## 12. 给后续批次的执行提示

| 批次 | 用本表做什么 |
|---|---|
| B1(i18n / auth / middleware)| 砍 `legacyRedirects` 时,本表 §1/§2 给出"哪些别名永久重定向→直接 410 或 301 到新路径"的最小集 |
| B2(DB)| 本表无表对照,但 `/photos` / `/order` 路由砍掉对应表也砍(`album_photos` / `orders` 改 `customers` + `credit_ledger`,见 `docs/web/database.md §2` 11 张表) |
| B3(`/create` + `/album/[uuid]`)| 本表 §3 + §7 给出客户端入口和 API 路径;PDF 出口看 §7 最后两行 |
| B4(支付)| §6 + §9 给出 webhook 双通道(Stripe + Creem)|
| B5(dashboard)| §4 给出 `/my-creations → /my-albums` 改名 + 新加 `/credits` 实现 |
| B6(admin)| §5 + §10 一对一保留,改写组件即可 |
| B7(marketing)| §1 别名砍掉,内容重写 |
| B8(memoir 21 模板)| 按本表头部"路线 A 签字"推进 |
| B9(agent 真实 pipeline)| §9 中 `/jobs` + `/internal/job-progress` 是 agent 的对端,实施按 `docs/agent/design.md` |
