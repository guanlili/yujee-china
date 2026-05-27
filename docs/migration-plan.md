# Migration · 老项目 → memoir-agent-rebuild

> 目标:**上线**。把老项目所有功能在新项目里跑起来。
>
> 起手:`CLAUDE.md` → `docs/architecture.md` → 角色起手文档(`CLAUDE.md §3`)。
>
> **写真实 AI pipeline 的人**:在起手文档之外**必须**读 [`docs/agent/design.md`](./agent/design.md) —— 阶段边界、Prompt、火山/DeepSeek 调用细节、校验/repair、模板注册表、日志红线、mock/real 边界,全部在那。本文档**不再复述**。

---

## 0. 仓库地图

所有老项目都在 GitHub `yvaineyu9` 组织下(private,需要被加 collaborator 才能 clone),**同时**已经 clone 到本地工作目录。**两种路径都给**,执行 agent 按自己的访问权限选:

| 仓库 | 本地路径(开发机)| GitHub URL | 角色 | 在本次迁移中 |
|---|---|---|---|---|
| **memoir-agent-rebuild** | `/Users/smalldog/Desktop/6.1 必上线/memoir-agent-rebuild/` | https://github.com/yvaineyu9/memoir-agent-rebuild | 新主线(本仓库) | 目的地 |
| **memoir-web** | `/Users/smalldog/Desktop/6.1 必上线/memoir-web/` | https://github.com/yvaineyu9/memoir-web | 海外版前端(登录 / 积分 / 订阅 / 支付 / 用户基础功能) | 迁过来 |
| **memoir** | `/Users/smalldog/Desktop/6.1 必上线/memoir/` | https://github.com/yvaineyu9/memoir | 排版引擎(Python CLI + 21 个 React 模板 + Chrome 出 PDF) | **只搬模板源**,见 §4 |
| **memoir-ai** | `/Users/smalldog/Desktop/6.1 必上线/遇己/memoir-ai/` | https://github.com/yvaineyu9/memoir-ai | 国内版(小程序) | 本次不动 |
| **life-magazine** | `/Users/smalldog/Desktop/6.1 必上线/life-magazine/` | https://github.com/yvaineyu9/life-magazine | 模板画布(给 memoir 喂模板) | 本次不动 |

老项目当前分支:
- `memoir-web` → `codex-merged-all-20260526`
- `memoir` → `main`

> **能访问本地的 agent 直接读本地路径**,引用形式如 `memoir-web/src/lib/auth/*`(相对 `6.1 必上线/` 工作目录)。
> **只能访问 GitHub 的 agent 用 URL**,引用形式 `https://github.com/yvaineyu9/<repo>/blob/<branch>/path`。
> 两种引用在文档里都允许出现。

---

## 1. 总原则

- 老项目 = **功能真相源**(行为、URL、错误码、邮件文案、积分公式、套餐价格 — 跟它对齐)
- 新项目 = **架构、目录、命名、视觉真相源**(`docs/` + `apps/web/design-v1/`)
- 不要把老代码原文粘过来。理解意图 → 按新规范重写。

---

## 2. memoir-web 是什么 / 不是什么

**memoir-web 只是前端壳**,覆盖:**登录、积分、订阅、支付、用户面板、相册基础 CRUD、对话式编辑界面**。

**它里面的 AI 调用代码**(`src/services/generation/ai/*` 等)**不要照搬** — 那是临时塞进去的,新项目里所有 AI 调用归 `apps/agent/`(FastAPI)管,见 `docs/architecture.md §1`。

---

## 3. 新项目功能清单(以本项目设计为权威)

> **重要原则**:本节是**新项目的目标清单**,不是老项目的"全功能盘点"。
> 老项目代码因历史原因比较杂乱(`videofly-template` fork 残留 + 临时塞的 AI 调用),
> 新项目**只迁意图,不照搬代码**。下面列出的就是新项目要做的全部。
> 老项目中不在此列表里的功能(如 `/album/[uuid]/print`、`/api/v1/upload`、Server Actions 等)**全部砍掉,不迁**。

### 3.1 页面(新项目目标,带 `[locale]` 前缀)

| 区域 | 路由 | 备注 |
|---|---|---|
| marketing | `/`, `/pricing`, `/privacy`, `/terms` | 简化:不再保留 `privacy-policy` / `terms-of-service` 别名 |
| auth | `/login`, `/register` | better-auth |
| tool | `/create`, `/album/[uuid]` | 编辑器自带 Chat 面板 + 双击就地编辑;**没有** `/print` 子路由,PDF 在编辑页内导出 |
| dashboard | `/my-albums`, `/credits`, `/settings` | 老项目 `/my-creations` → 新 `/my-albums` |
| admin | `/admin`, `/admin/users`, `/admin/analytics`, `/admin/settings` | 内部用 |

### 3.2 API routes(新项目目标)

权威清单见 [`docs/web/api.md §1`](./web/api.md)。这里只是供 PM/老项目对照用的速查:

```
/api/auth/[...all]                                  better-auth
/api/webhooks/stripe                                Stripe webhook
/api/webhooks/creem                                 Creem webhook
/api/v1/health
/api/v1/jobs                                        POST 触发生成(fire-and-forget)
/api/v1/jobs/[requestId]                            GET 轮询任务
/api/v1/albums                                      GET 列表
/api/v1/albums/[uuid]                               GET/PATCH/DELETE
/api/v1/albums/[uuid]/pages/[idx]                   PATCH 单页(精确编辑)
/api/v1/albums/[uuid]/chat                          POST Chat 编辑(同步,转 Agent)
/api/v1/albums/[uuid]/messages                      GET 对话历史
/api/v1/albums/[uuid]/pdf-upload-url                POST 签 R2 PUT URL
/api/v1/albums/[uuid]/pdf                           PUT/GET PDF 完成通知 + 下载
/api/v1/credit/balance
/api/v1/credit/history
/api/v1/user/me
/api/v1/user/billing
/api/v1/internal/job-progress                       Agent → Web callback
/api/v1/admin/recover-stuck
/api/v1/admin/cleanup-photos
```

**老项目里**有但新项目**已明确砍掉**的接口:
- `/api/v1/albums/[uuid]/generate` → 合并到 `POST /api/v1/jobs`
- `/api/v1/albums/[uuid]/photos` `/order` → 不需要,原图在浏览器 IndexedDB,编辑用 PATCH page
- `/api/v1/albums/[uuid]/checkout` / `/export` → 合并到 `pdf-upload-url` + `pdf` 两个接口
- `/api/v1/upload`(R2 上传原图)→ 违反不变式 1,永远不做

### 3.3 模块对照(从老 memoir-web 抽哪些意图)

| memoir-web 模块 | 迁移 | 新项目去向 |
|---|---|---|
| `src/db/schema.ts`(pg) | ✅ 只抽 better-auth 4 张表 + 业务表的字段意图 | `apps/web/src/db/schema.ts`,以 [`docs/web/database.md`](./web/database.md) **§2 的 11 张表清单**为准 |
| `src/services/album` `billing` `customer` | ✅ 抽意图 | `apps/web/src/services/{album,billing,user}/` |
| `src/services/generation` 业务编排部分 | ✅ 抽意图 | `apps/web/src/services/generation/`(只做编排,**不调 AI**) |
| `src/services/generation/ai/*` | ❌ | AI 调用全在 `apps/agent/` |
| `src/payment/`(Stripe + Creem)| ✅ | `apps/web/src/services/billing/{stripe,creem}-service.ts` |
| `src/mail/` | ✅ | `apps/web/src/lib/email/templates/` |
| `src/i18n/` + `src/messages/{en,zh}.json` | ✅ | `apps/web/src/messages/` + `lib/i18n/routing.ts` |
| `src/middleware.ts` | ✅ | 新 `middleware.ts`(砍 `legacyRedirects`) |
| `src/hooks/` `src/stores/` `src/components/` `src/config/` | ✅ 重写 | 按 [`docs/web/directory.md`](./web/directory.md) 分层就近放 |
| `src/actions/` Server Actions | ❌ | 全走 `/api/v1/*` Route |
| `src/content/` `src/registry/` `src/types/` | ❌ | videofly 残留,全砍 |
| `POST /api/v1/upload` 上传到 R2 | ❌ | 违反不变式 1,见 [`docs/architecture.md §3`](./architecture.md) |

### 3.4 videofly fork 残留(明确砍)

memoir-web 是 `videofly-template` fork(老项目 `upstream` remote 还在):
- `src/registry/magicui/*`
- `src/content/docs/*.mdx`
- `middleware.ts` 里的 `legacyRedirects: { "/dashboard": "/create", "/text-to-video": "/create", ... }`
- 任何 `video` / `text-to-video` / `reference-to-video` 字样

---

## 4. memoir 排版引擎 —— 需要先做架构选择

`memoir` 仓库当前是**后端排版引擎**:
- Python CLI:`python3 -m engine compose -i layout.json` → 生成 `content-memoir.js`
- 浏览器渲染层:`frontend/layouts/` 下 21 个 React 模板(`.jsx`,Babel 直接跑,零构建)
- PDF 输出:`python3 -m engine pdf` → Chrome headless 打印

**这跟新项目当前的设计有架构 gap:**

| | memoir 老引擎 | memoir-agent-rebuild 当前设计 |
|---|---|---|
| layout 数据流 | CLI 写 `content-memoir.js` 静态文件 | API 返回 JSON,前端 fetch |
| 模板 | `.jsx` + Babel 浏览器编译 | 计划用 Next.js 编译后的 React 组件 |
| PDF 出口 | Chrome headless 跑在后端 | 浏览器本地 `@react-pdf/renderer` |

**两种合并路线供你拍**(B0 必须先回答这个):

- **路线 A · 把 21 个模板搬到 `apps/web/src/components/album/templates/`**
  - 前端直接渲染(SSR / CSR 都行)
  - PDF 在浏览器出
  - memoir 仓库的 Python 引擎**整个不要**,只搬模板源码
  - 工作量小,风险低,但要把 21 个 `.jsx` 全部转成 TSX + 适配新 schema

- **路线 B · 保留 Python 引擎,放进 `apps/agent/` 或新建 `apps/renderer/`**
  - Agent 调 AI → 输出 layout JSON → 内部调引擎 → 出 PDF → 上传 R2
  - 浏览器只下载 PDF
  - 跟新项目"浏览器持原图、PDF 本地生成"的不变式有冲突,需要重新评估
  - 但能 100% 复用现有引擎和 21 模板

**默认推荐路线 A**(跟 `docs/architecture.md §1` 已经定的"浏览器渲染 PDF"对齐)。
**路线 B 需要先回开架构师对齐会议**,改 `docs/architecture.md` 和不变式。

---

## 5. 批次(并行交付)

| 批次 | 范围 | 依赖 |
|---|---|---|
| **B0** | 路由对照表 + 回答 §4 A/B 路线 + 读完 `docs/agent/design.md` 签字 | — |
| **B-1** | 从 `yvaineyu9/memoir frontend/schema.js` 抽 21 模板,填 `packages/contracts/src/templates.ts`(当前只 3 个占位)。**硬阻塞 B3 / B8 / B9 真实 composing 与编辑器验收** | B0 |
| **B1** | i18n + better-auth + middleware + 邮件模板基建 | B0 |
| **B2** | DB schema 全量(**11 张表**,以 [`docs/web/database.md §2`](./web/database.md) 为准:`users/sessions/accounts/verifications/customers/albums/album_pages/album_messages/agent_jobs/credit_holds/credit_ledger`)+ 全部 repos + zombie-sweeper.ts | B0 |
| **B3** | 核心生成流程:`/create` 上传 + `/album/[uuid]` 编辑器(双击就地编辑 + Chat 面板 + PDF 导出) | B1, B2, B8, B-1, B9(chat-edit 端点) |
| **B4** | 账单 / Stripe + Creem(checkout、webhook、订单、积分流水) | B2 |
| **B5** | Dashboard 三页(`/my-albums` `/credits` `/settings`) | B2, B4 |
| **B6** | Admin 四页 + `recover-stuck` / `cleanup-photos` 接口 | B5 |
| **B7** | Marketing 兜底(`/pricing` 还原、`/privacy`、`/terms`) | B0 |
| **B8** | memoir 引擎 / 21 模板按 §4 路线合并进来 | B0 拍板路线 + B-1 |
| **B9** | Agent 真实 pipeline:**两个端点**——`/v1/layout`(火山 vision + DeepSeek writing/composing,异步)+ `/v1/chat-edit`(DeepSeek 单次,同步)+ repair + 校验(按 [`docs/agent/design.md`](./agent/design.md) §1-§13 实施) | B-1 |

**可同时启动**:B-1 / B1 / B2 / B7。
B8 等 B-1;B9 等 B-1;B3 等 B1+B2+B-1+B8。

---

## 6. 每批次合并前的验收

1. 对应老路由 / 接口在新项目能跑(贴 curl 或截图证据)
2. `pnpm typecheck` 零错误
3. `./scripts/e2e-test.sh` 仍 PASS
4. 没在 `docs/web/directory.md §11` 黑名单里建目录
5. commit 末尾带 `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`

---

## 7. 上线 = 完成定义

- memoir-web 18 个页面、所有 API,在新项目都有等价实现
- memoir 21 个模板按 §4 路线合并完成
- 关键 user journey(注册 → 登录 → 选照片 → 生成 → 编辑 → 下单 → 收款 → 拿 PDF)端到端跑通
- 老项目 memoir-web `codex-merged-all-20260526` 分支冻结,memoir 仓库归档,新项目 `main` 成唯一开发主线
- 部署到 yujeeai.com,真用户能用

---

## 8. 工作流

1. 读本文档 + `CLAUDE.md` + `docs/architecture.md` + 老仓库 README
2. `gh issue create` 认领批次(`gh -R yvaineyu9/memoir-agent-rebuild issue create ...`)
3. 起 branch:`feat/migrate-bN-<slug>`
4. PR 描述贴对照表(老 → 新)+ 验收证据

---

## 8.1 跨批次 TODO

| 来源 | 项 | 责任批次 |
|---|---|---|
| B2 review (PR #8) | `creditService.settle / hold` 必须同步写 `credit_ledger`(`delta` + `reason='GENERATION_SETTLE'` / `'PURCHASE'`),并把 `userRepo.updateCredit` 封到一个 `creditService.applyDelta(tx, userId, delta, reason)` 里,确保 balance 和 ledger 双写。当前 B2 只建表,没接入。 | B4(付费/积分) |
| B2 review (PR #8) | `db/repos/*` 的 `DbOrTx` 收紧为只接 `Tx`(transaction handle),让类型系统强制所有写都在事务里。需要同步重写 `job-service` 几个 handler。 | B5 / B6(job 与生成流) |
| B2 review (PR #8) | `docs/web/database.md §1` 写"主键 id uuid",实际实现用 `text` + `default gen_random_uuid()`(better-auth 兼容)。文档同步,或迁到真正的 `uuid` 类型 + 改 better-auth adapter。 | 架构师同步 |
| B2 review (PR #8) | `albums.credit_hold_id` 没加 FK(避免 albums ↔ credit_holds 循环)。若决定加,Postgres `ALTER TABLE ... DEFERRABLE INITIALLY DEFERRED` 可破环,但要评估迁移代价。 | 架构师拍板 |

---

## 9. 状态(由 PM 维护)

| 批次 | Owner | Branch | PR | 状态 |
|---|---|---|---|---|
| B0 | Claude Opus (B0 window) | `feat/b0-route-map` | (待 PR)| 进行中 |
| B-1 | — | — | — | 待领 |
| B1 | — | — | — | 待领 |
| B2 | — | — | — | 待领 |
| B3 | — | — | — | 待领 |
| B4 | — | — | — | 待领 |
| B5 | — | — | — | 待领 |
| B6 | — | — | — | 待领 |
| B7 | — | — | — | 待领 |
| B8 | — | — | — | 待领(等 §4 路线拍板) |
| B9 | — | — | — | 待领 |
