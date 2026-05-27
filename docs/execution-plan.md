# Yujee 迁移执行需求

> 这是 PM 给每个执行窗口的派工单。**migration-plan.md** 是策略,**architecture.md** 是骨架,这份是「现在去干什么」。
>
> 起手:`CLAUDE.md` → `architecture.md` → 你的轨道 §3.x → 老仓库源链接。

---

## 1. 锁定的决策(不要再回头讨论)

| 决策项 | 锁定值 |
|---|---|
| 范围 | **完整迁移** memoir-web 全部 18 页 + 18 API,无 MVP 砍刀 |
| 模板路线 | **路线 A**(21 个 jsx → tsx 进 `apps/web/src/components/album/templates/`),PDF 走浏览器 `@react-pdf/renderer`。架构不变式 4 不破。 |
| 支付 | Stripe + Creem 双线都迁,Stripe 为主 |
| 语言 | en + zh 全量。en 是默认,zh 跟齐 |
| 路由命名 | `/my-creations` → `/my-albums`(其他保留) |
| Server Actions | 全部砍掉,只走 `/api/v1/*` Route |
| videofly 残留 | 全砍(`src/registry/magicui`、`src/content/docs`、`legacyRedirects`、任何 `video` / `text-to-video` 字样) |
| `POST /api/v1/upload`(R2 上传原图) | **不要**,违反不变式 1 |
| 旧 `src/services/generation/ai/*` | **不照搬**,AI 全归 `apps/agent/` |
| 旧 `src/actions/` | 全砍,改 Route |
| Mock vs 真实 | Agent 必须接真实火山 + DeepSeek,不留 mock |
| 老 Python 排版引擎(`memoir/engine/`) | 不要 |

---

## 2. 不可妥协的核心流程

E2E 跑通这条线 = 验收通过的最低门槛:

```
注册 → 邮箱验证 → 登录
  → /create 选 3-30 张照片(浏览器压缩 800px base64)
  → POST /api/v1/jobs(fire-and-forget)
  → Agent 调火山 + DeepSeek 出 layout
  → /album/[uuid] 轮询 → 看到 layout 渲染杂志
  → 用户改文案 / 换图位
  → 点导出 → 浏览器 @react-pdf 生成 PDF → presigned PUT R2
  → 触发结算:Stripe checkout 扣款 / 积分扣减
  → 拿到 PDF 公网 URL,可下载
```

每一步都要有 curl / Playwright 证据,贴在对应轨道的验收里。

---

## 3. 并行轨道(每条 = 一个 Claude Code 窗口)

> 一个窗口干一条轨道,**不要派子 agent**,git branch 接力([[feedback_single_window_orchestration]])。
>
> 老仓库地址(GitHub `yvaineyu9` 组织,private):
> - memoir-web: https://github.com/yvaineyu9/memoir-web `codex-merged-all-20260526`
> - memoir: https://github.com/yvaineyu9/memoir `main`

### Wave 1(立刻起跑,7 个窗口并行,无依赖)

#### T0 · Contracts + 模板 schema 公约(PM/架构,**最优先**)
- 老仓库源:无
- 新仓库目标:
  - `packages/contracts/src/agent.ts`:`AlbumLayoutPlan` zod schema 全量(见 `agent/contract.md §4`)
  - `packages/contracts/src/errors.ts`:错误码枚举(对齐 `web/errors.md` + `agent/contract.md §8`)
  - `packages/contracts/src/templates.ts`:21 个模板的 `templateId` + slot 定义(images/texts 各自的 slotName)
- 验收:
  - `pnpm --filter contracts build` 零错
  - `apps/web` 和 `apps/agent` 都能 `from @yujee/contracts import ...`
- 阻塞:T3 / T4 / T6 都等这条

#### T1 · Foundation(基建工程师)
- 老仓库源:
  - `memoir-web/src/lib/auth/*`、`src/middleware.ts`、`src/i18n/*`、`src/mail/*`、`src/messages/{en,zh}.json`
- 新仓库目标:
  - `apps/web/src/lib/auth/`(better-auth 配置 + drizzle adapter,接 `users/sessions/accounts/verifications` 表)
  - `apps/web/src/middleware.ts`(只保留 i18n + auth,**砍 legacyRedirects**)
  - `apps/web/src/lib/i18n/routing.ts`、`apps/web/src/messages/{en,zh}.json`
  - `apps/web/src/lib/email/templates/`(验证邮件 + 订单邮件,文案对齐老项目)
  - `apps/web/src/lib/env.ts`(zod 校验 process.env,统一出口)
- 验收:
  - 注册 + 邮箱验证 + 登录 curl 跑通
  - `/login` `/register` `/[locale]/...` 路由能切 en/zh
- 依赖:T2 的 better-auth 表必须存在(并行但要 sync 一次 schema)

#### T2 · DB schema + repos(DB 工程师)
- 老仓库源:`memoir-web/src/db/schema.ts`
- 新仓库目标:
  - `apps/web/src/db/schema.ts`:10 张表全量(`users/sessions/accounts/verifications/customers/albums/album_pages/agent_jobs/credit_holds/credit_ledger`),按 `web/database.md`
  - `apps/web/src/db/repos/*`:每张业务表一个 repo,只暴露 Drizzle query 方法
  - drizzle migrations 跑通
- 验收:
  - `pnpm --filter web db:generate` 出 SQL,`db:migrate` 在 Neon dev 库跑通
  - 所有 repo 有最小 happy-path 测试(`pnpm --filter web test:repos`)
- 阻塞:T1 / T5 / T6 / T7 / T8 / T9 都等表存在

#### T3 · Agent pipeline 真实化(Agent 工程师)
- 前置必读:`docs/agent/design.md` 全文(14 节)
- 老仓库源:
  - `memoir-web/src/services/generation/ai/*`(只看意图,不照搬)
  - 火山 doubao-vision API 文档、DeepSeek API 文档(以**实施时官方最新文档**为准)
- 新仓库目标:
  - `apps/agent/src/services/vision.py`(替 `vision_mock.py`)
  - `apps/agent/src/services/planning.py`(writing + composing 两个 DeepSeek 调用,替 `planning_mock.py`)
  - `apps/agent/src/services/pipeline.py`:三阶段编排,每阶段按 `design.md §6` 进度语义 callback
  - `apps/agent/src/schemas.py`:镜像 TS contracts(discriminated union + extra='forbid')
  - `apps/agent/src/logging_config.py`:加 redact processor(`design.md §9`)
  - `AGENT_PIPELINE_MODE` 启动检查(`design.md §12`)
  - 输出严格符合 `@yujee/contracts` 的 `AlbumLayoutPlan`
- 验收:
  - `tests/test_pipeline.py` 用 3 张测试图跑通,layout schema 校验通过
  - callback 三个 event(progress/completed/failed)都能正确触发 Web 端;失败前先发 progress
  - 超时 / 重试 / 错误码全按 `agent/contract.md §6 §8` + `design.md §1.1`
  - `AGENT_PIPELINE_MODE=mock` 仍能跑通(CI 用),`production + 非 real` 启动失败
- 依赖:
  - **T0**(Contracts + PhotoAnalysis 扩字段 + Usage 重定义,见 `design.md §13` D-1/D-3/D-4)
  - **T4 / B-1**(TemplateRegistry 21 个模板)—— 真实 composing 阶段所选 templateId 必须在注册表里。**T4 未完成前,T3 只能交付"vision + writing + composing 骨架(选模板从 3 个占位)",真实 composing 验收等 T4 落地**

#### T4 · Templates 迁移(21 个版式,模板工程师)
- 老仓库源:`memoir/frontend/layouts/*.jsx`(21 个文件)
- 新仓库目标:
  - `apps/web/src/components/album/templates/<templateId>/index.tsx`:每个模板一个 TSX
  - `apps/web/src/components/album/templates/<templateId>/pdf.tsx`:对应的 `@react-pdf/renderer` 版本
  - `apps/web/src/components/album/templates/registry.ts`:`{ templateId → { Component, PdfComponent, slots } }`
  - 字体 / 图片处理用 `@react-pdf/renderer` 的标准 API(`<Image src={base64}>`)
- 验收:
  - 每个模板有 storybook / preview 路由(`/_design-page/template/<id>`)
  - 任选 5 个模板,用 mock layout 渲染出 PDF,样式跟老项目 ±5% 一致
  - 21 个全部上 = 入合并门槛
- 依赖:T0(`templateId` + slot 定义)

#### T7 · Marketing 页面(UI 工程师)
- 老仓库源:`memoir-web/src/app/[locale]/{page.tsx,pricing,privacy,terms,...}`
- 新仓库目标:
  - `apps/web/src/app/[locale]/page.tsx`(landing)
  - `apps/web/src/app/[locale]/pricing/page.tsx`
  - `apps/web/src/app/[locale]/privacy/page.tsx`、`privacy-policy/page.tsx`
  - `apps/web/src/app/[locale]/terms/page.tsx`、`terms-of-service/page.tsx`
- 验收:
  - en/zh 双语跑通
  - 视觉跟 `apps/web/design-v1/` 对齐
  - pricing 价格从 `config/pricing.ts` 单一源读取(给 T7-billing 复用)
- 依赖:T1(i18n)

#### T11 · i18n messages 全量(可并 T1)
- 老仓库源:`memoir-web/src/messages/{en,zh}.json`
- 新仓库目标:`apps/web/src/messages/{en,zh}.json`
- 验收:所有 namespace key 在两个文件里都存在,跑 `pnpm --filter web i18n:check` 无 missing
- 依赖:无,但 key 命名要跟 T5/T6/T7/T8/T9 一边走一边补

---

### Wave 2(T0 + T1 + T2 落地后,3 个窗口并行)

#### T5 · Create flow + 照片上传链路(UI 工程师 A)
- 老仓库源:`memoir-web/src/app/[locale]/create/*`、`src/lib/photo/*`
- 新仓库目标:
  - `apps/web/src/app/[locale]/create/page.tsx`
  - `apps/web/src/lib/photo/compress.ts`(Canvas 缩 800px / quality 0.6,**只在浏览器跑**)
  - `apps/web/src/lib/photo/store.ts`(IndexedDB 存原图 blob,`photoId` 索引)
  - `apps/web/src/app/api/v1/jobs/route.ts`(fire-and-forget,见 `web/api.md §3.1`)
  - `apps/web/src/services/generation/generation-service.ts`(编排:precheck → album.create → job.create → agentClient.submitLayout)
- 验收:
  - 选 5 张图 → 点开始制作 → 5 秒内 redirect 到 `/album/[uuid]?job=req_xxx`
  - `agent_jobs` 表有一条 RUNNING 记录
  - **原图永不出浏览器**(network tab 检查:发出去的是 base64 ≤ 800KB,不是 file)
- 依赖:T0 + T1 + T2 + T3(联调时)

#### T6 · Album 编辑器 + 轮询 + PDF 导出(UI 工程师 B)
- 老仓库源:`memoir-web/src/app/[locale]/album/[uuid]/*`、`src/app/[locale]/album/[uuid]/print/*`
- 新仓库目标:
  - `apps/web/src/app/[locale]/album/[uuid]/page.tsx`(编辑器主页)
  - `apps/web/src/app/api/v1/albums/[uuid]/route.ts`(GET/PATCH/DELETE)
  - `apps/web/src/app/api/v1/albums/[uuid]/pages/[idx]/route.ts`(PATCH 单页)
  - `apps/web/src/app/api/v1/albums/[uuid]/pdf-upload-url/route.ts`(签 presigned PUT)
  - `apps/web/src/app/api/v1/albums/[uuid]/pdf/route.ts`(PUT 通知 + GET 拿 URL)
  - `apps/web/src/app/api/v1/jobs/[requestId]/route.ts`(轮询)
  - `apps/web/src/app/api/v1/internal/job-progress/route.ts`(Agent callback,幂等)
  - `apps/web/src/lib/hooks/use-job-poll.ts`(2 秒轮询,3 分钟兜底超时)
  - `apps/web/src/lib/pdf/render.ts`(@react-pdf/renderer 调度,用 T4 registry)
  - 编辑器:文案双击就地编辑、图位拖拽切换 slot
- 验收:
  - 完整跑一遍核心流程,落 PDF 到 R2,拿到公网 URL
  - 轮询在 COMPLETED / FAILED 后自动停
  - callback 重复推送只写一次(幂等)
  - PDF 在浏览器生成,Network tab 不存在 PDF 流量经过 Vercel
- 依赖:T0 + T2 + T4

#### T8 · Billing(账单工程师)
- 老仓库源:`memoir-web/src/payment/`、`src/services/billing/`、`src/app/api/webhooks/{stripe,creem}/*`
- 新仓库目标:
  - `apps/web/src/services/billing/stripe-service.ts`、`creem-service.ts`
  - `apps/web/src/services/credit/credit-service.ts`(precheck/hold/settle/release,事务内,见不变式 8)
  - `apps/web/src/app/api/v1/albums/[uuid]/checkout/route.ts`
  - `apps/web/src/app/api/webhooks/stripe/route.ts`、`creem/route.ts`(签名校验)
  - `apps/web/src/services/billing/pricing-config.ts`(单一价格源,T7 共用)
  - `credit_ledger` 表沿用老结构(T2 拷过来)
- 验收:
  - Stripe test mode 完整下单 + webhook 入账 + 积分 +N
  - 用积分生成相册 → hold → settle 一气呵成,流水正确
  - 失败任务自动 release,不扣积分
- 依赖:T2

---

### Wave 3(T5 + T6 + T8 落地后,2 个窗口并行)

#### T9 · Dashboard(/my-albums + /credits + /settings)
- 老仓库源:`memoir-web/src/app/[locale]/{my-creations,credits,settings}/*`
- 新仓库目标:
  - `apps/web/src/app/[locale]/my-albums/page.tsx`(列表 + 状态徽标 + 删除)
  - `apps/web/src/app/[locale]/credits/page.tsx`(余额 + 流水)
  - `apps/web/src/app/[locale]/settings/page.tsx`(profile + 改密 + 退出)
  - `apps/web/src/app/api/v1/credit/{balance,history}/route.ts`
  - `apps/web/src/app/api/v1/user/{me,billing}/route.ts`
- 验收:列表 / 流水 / 设置三页跑通,en/zh 双语
- 依赖:T2 + T8

#### T10 · Admin(/admin 四页 + 后台接口)
- 老仓库源:`memoir-web/src/app/[locale]/admin/*`、`src/app/api/v1/admin/*`
- 新仓库目标:
  - `apps/web/src/app/[locale]/admin/{page,users,analytics,settings}/page.tsx`
  - `apps/web/src/app/api/v1/admin/{recover-stuck,cleanup-photos}/route.ts`
  - admin 鉴权 middleware(`user.role === 'admin'`,401/403 明确)
- 验收:
  - admin 账号能看用户列表、能手动 recover 一个卡住的 job
  - 非 admin 访问 → 403
- 依赖:T2 + T9

---

## 4. 收尾(所有 Wave 完成后)

#### T-Integration · 端到端联调
- 跑核心流程(§2),全程录屏
- 跑 gstack `/qa-only` 全量,health score ≥ 8
- 修联调出来的 bug(branch:`fix/integration-*`)

#### T-Deploy · 部署
- Vercel:`apps/web`,绑 yujeeai.com,env 全量配置
- Fly.io:`apps/agent`,绑 agent.yujeeai.com
- Neon:prod 库 + migrations
- R2:bucket + CORS + 自定义域名 cdn.yujeeai.com
- DNS:Cloudflare 全量
- Stripe / Creem live key,webhook 注册
- 火山 + DeepSeek 生产 API key + 配额

#### T-Smoke · 上线后烟雾测试
- 用真用户邮箱跑一遍核心流程
- 检查 Sentry 没有 P0
- 检查首日积分流水对账

---

## 5. 横切约束(所有轨道都得守)

1. **路由 ≤ 40 行**,业务全进 service(不变式 5)
2. **Route 不 import drizzle**,只调 service(不变式 6)
3. **Service 第一参 = `userId` / `actor`**(不变式 7)
4. **积分变更必须在 DB 事务内**(不变式 8)
5. **Agent 输出写库前 zod 校验**(不变式 9)
6. **`AGENT_SHARED_SECRET` 不进 client bundle**(不变式 10)
7. **原图永不落服务器**(不变式 1/2/3)
8. **PDF 浏览器生成,presigned PUT 上 R2**(不变式 4)
9. 加表 / 改 schema / 加顶层目录 / 加依赖 / 改对外 API / 改协议 → **先问架构师**
10. 每个 PR 验收必须贴 curl 或截图证据(`migration-plan.md §6`)

---

## 6. Git 协议

- 主分支:`main`(冻结直推,只接 PR)
- 轨道分支:`feat/T<N>-<slug>`,例如 `feat/T6-album-editor`
- 接力规则:Wave 2 起跑前,Wave 1 涉及到的轨道**至少**已经 merge schema / contracts / templates。其他 UI / 接口部分可以边开发边 review
- PR 描述模板(每个轨道都用):
  ```
  ## 老 → 新对照
  | 老路径 | 新路径 |
  | --- | --- |
  ## 验收证据
  - curl 截图 / Playwright 录屏
  ## 自查
  - [ ] 跟 architecture.md 不变式对齐
  - [ ] route.ts ≤ 40 行
  - [ ] 没新增顶层目录
  ```
- commit 末尾带 `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`

---

## 7. PM 进度表(我维护,实时更新)

| 轨道 | 窗口 / Owner | Branch | PR | 状态 | 阻塞 |
|---|---|---|---|---|---|
| T0 Contracts | — | — | — | 待领 | — |
| T1 Foundation | — | — | — | 待领 | T2 同步 schema |
| T2 DB | — | — | — | 待领 | — |
| T3 Agent | — | — | — | 待领 | T0(骨架);T0 + T4 全量(真实 composing 验收) |
| T4 Templates | — | — | — | 待领 | T0 — **硬阻塞:21 个模板未填齐前,T3 真实 composing 不允许验收;T6 编辑器不允许进入合并** |
| T5 Create flow | — | — | — | 待领 | T0/T1/T2 |
| T6 Editor + PDF | — | — | — | 待领 | T0/T2/T4 |
| T7 Marketing | — | — | — | 待领 | T1 |
| T8 Billing | — | — | — | 待领 | T2 |
| T9 Dashboard | — | — | — | 待领 | T2/T8 |
| T10 Admin | — | — | — | 待领 | T2/T9 |
| T11 i18n | — | — | — | 待领 | — |
| Integration | — | — | — | 待启 | 全部 |
| Deploy | — | — | — | 待启 | Integration |

---

## 8. 给执行窗口的开工 SOP

每个窗口起手做这 5 步,**做完才开始动代码**:

1. 读 `CLAUDE.md` + `docs/architecture.md`(十条不变式过一遍)
2. 找到本文件里你的轨道(§3.x),把"老仓库源"全部打开看一遍
3. 找到角色起手文档(`CLAUDE.md §3` 角色表),按顺序读完
4. `gh -R yvaineyu9/memoir-agent-rebuild issue create` 用一句话认领轨道
5. `git checkout -b feat/T<N>-<slug>` 开始干

干完一条交付 = PR 开出来 + 验收证据贴齐 + ping PM 更 §7 表。
