# Web 目录结构

> **前置阅读**: `CLAUDE.md` → `docs/architecture.md` → `docs/web/layering.md`
>
> 谁读这份: 所有 Web 工程师在创建新文件前必读。以 `apps/web/src/` 现状为准。

这份文档定义 `apps/web/src/` 下**每一个目录的归属**。新增文件前先在这里找到对应目录,**找不到的先停下来问架构师**,不要随便建目录。

---

## 1. 顶层结构

```
apps/web/src/
├── app/                      # Layer 1: Routes & Pages（含 API）
├── services/                 # Layer 2: 业务编排
├── db/                       # Layer 3: 数据（schema / repos / migrations）
├── lib/                      # Layer 4: 横向能力
├── components/               # React UI 组件
├── config/                   # 静态产品配置
├── messages/                 # i18n 文案
├── styles/                   # 全局样式
├── types/                    # 全局 .d.ts
└── middleware.ts             # next-intl 路由 + 鉴权中间件
```

> 没有独立的 `stores/` 或 `hooks/` 顶层目录。客户端 hooks 放 `lib/hooks/`;UI 局部状态就近放组件。

---

## 2. `app/` —— Routes & Pages

页面在 `[locale]/` 下平铺(无 `(marketing)`/`(tool)` 之类路由组),API 在 `app/api/` 下按 `v1`(基建)与 `v3`(五环节编排)两个命名空间分。

```
app/
├── [locale]/                          # i18n 包裹层（所有用户页面）
│   ├── page.tsx                       # 首页（营销 + Composer 选图入口）
│   ├── layout.tsx
│   ├── pricing/ · privacy/ · terms/   # 营销页
│   ├── login/ · register/             # 登录 / 注册
│   ├── album/[uuid]/                  # 相册编辑器（选完图直接进，无 /create）
│   ├── my-albums/ · credits/ · settings/   # 登录后私有页
│   └── admin/                         # 内部管理（analytics / settings / users）
├── _design-page/                      # 设计预览页（非生产路由）
└── api/
    ├── auth/
    │   ├── [...all]/route.ts          # better-auth
    │   └── creem/webhook/route.ts
    ├── webhooks/creem/route.ts
    ├── v1/                            # 基建端点（保留复用）
    │   ├── albums/
    │   │   ├── route.ts                            # GET 列表
    │   │   └── [uuid]/
    │   │       ├── route.ts                        # GET/PATCH/DELETE
    │   │       ├── pages/[idx]/route.ts            # PATCH 单页
    │   │       ├── chapters/route.ts
    │   │       ├── messages/route.ts               # chat 历史
    │   │       ├── pdf-upload-url/ · pdf/          # PDF 签 URL / 标记完成
    │   │       └── cover-thumbnail-upload-url/ · cover-thumbnail/
    │   ├── credit/{balance,history}/route.ts
    │   ├── billing/checkout/route.ts
    │   ├── user/{me,billing}/route.ts
    │   ├── fonts/subset/route.ts                   # PDF 字体 subset
    │   ├── admin/{cleanup-photos,recover-stuck}/route.ts
    │   └── health/route.ts
    └── v3/                            # 五环节编排（详见 docs/agent/contract.md）
        ├── albums/
        │   ├── route.ts                            # POST 建册 + 扣费 + 派 analyze
        │   └── [uuid]/
        │       ├── draft/route.ts                  # GET draft_json
        │       ├── story-progress/route.ts
        │       ├── chapter-chat/route.ts           # ② 章节故事
        │       ├── recommend/ · apply-theme/route.ts   # ③ 主题/章节色
        │       ├── cover/route.ts                  # ④ 书籍设计
        │       ├── finalize/route.ts               # ⑤ 待导出（flatten）
        │       └── retry/route.ts
        └── internal/job-progress/route.ts          # Agent → Web 回调 sink
```

> V3 编排端点与 Web↔Agent 契约 → `docs/agent/contract.md`。`/v1` 端点行为细节 → `docs/web/api.md`。

---

## 3. `services/` —— 业务编排

一个业务名词一个目录;文件名 `<名词>-service.ts`。

```
services/
├── album/album-service.ts             # 相册 CRUD + draft/stage 编排
├── generation/generation-service.ts   # base64 → Agent → 写回
├── chat/chat-service.ts               # 章节对话编排
├── credit/credit-service.ts           # 预检 / 冻结 / 结算 / 释放
├── job/                               # agent_job 状态机 + 清扫
│   ├── job-service.ts
│   ├── zombie-sweeper.ts              # RUNNING 僵尸任务回收
│   └── draft-expiry-sweeper.ts        # draft 过期清理
├── billing/
│   ├── billing-service.ts
│   └── creem-service.ts
├── font/font-service.ts               # 字体 subset 编排
├── user/user-service.ts
└── admin/admin-service.ts
```

**新增 service 的判断**:
- 是不是一个**业务名词**(album / credit / billing)?如果是,可以独立成 service。
- 是不是一个**横向能力**(zod / http / log)?如果是,放 `lib/`。

---

## 4. `db/` —— 数据层

```
db/
├── client.ts                          # Drizzle 客户端单例
├── schema.ts                          # 所有表 + 枚举（权威，见 database.md）
├── migrations/                        # drizzle-kit 生成（0000_… 顺序编号 + meta/）
└── repos/                             # 一表一文件（+ 同名 .test.ts）
    ├── user-repo.ts
    ├── customer-repo.ts
    ├── album-repo.ts
    ├── album-page-repo.ts
    ├── album-message-repo.ts
    ├── agent-job-repo.ts
    ├── credit-hold-repo.ts
    └── credit-ledger-repo.ts
```

> 枚举内联在 `schema.ts` 里(无独立 `enums.ts`)。详细 schema → `docs/web/database.md`。

---

## 5. `lib/` —— 横向能力

```
lib/
├── auth/                              # better-auth / require-auth / require-admin
│   │                                  #   require-agent-secret / cron-auth / client
├── api/                               # ok / err / zod-parse / error-codes / from-exception
├── agent/                             # agent-client（HTTP 调 Agent）/ layout-schema
├── album/                             # authoring-client / skeleton
├── generation/                        # client / draft
├── r2/r2-client.ts                    # R2 + presign
├── photo/                             # compress / cluster / cover-thumbnail / store（client only）
├── pdf/                               # render（@react-pdf）/ subset
├── billing/handle-creem-webhook.ts
├── email/                            # send-email + templates/
├── hooks/use-album-poll.ts            # 客户端轮询 hook
├── i18n/                              # routing / request / messages
├── log/logger.ts                      # pino，自动带 requestId
└── env.ts                             # 启动时校验 env
```

**新增 lib 的判断**:它知道"相册""积分"是什么吗?如果知道,放 `services/` 而不是 `lib/`。

---

## 6. `components/` —— UI 组件

```
components/
├── app/                               # AppChrome / Sidebar / UserMenu / 状态栏 / 语言切换
├── album/                             # 编辑器 + 模板
│   ├── AlbumEditor / EditorTopbar / ChatPanel / PageEditPanel / FlipBook …
│   ├── AlbumGeneratingShell          #   分析期加载态（building 分支）
│   ├── editor-v2/                     #   编辑器实现
│   ├── templates/                     #   模板组件
│   ├── web-registry.ts · pdf-registry.ts   # 模板注册表（web 渲染 / PDF）
│   └── spreads.ts · adapt-layout.ts …
├── landing/                           # 首页营销组件（HeroComposer / Marquee …）
├── marketing/                         # 营销框架（Nav / Footer / Faq / PricingSection）
└── admin/                             # 内部管理 UI
```

**组件命名**: PascalCase,文件名 = 组件名(`AlbumEditor.tsx`)。

---

## 7. `config/` · `messages/` · `styles/` · `types/`

```
config/
└── pricing.ts                         # 定价 / 单本消耗（纯常量，无函数逻辑）

messages/
├── en.json                            # 主语言（英文 UI）
├── zh.json                            # 运营备用
└── marketing.ts                       # 营销文案常量

styles/globals.css

types/subset-font.d.ts                 # 第三方模块声明
```

**config 与 services 的区别**: config 是**纯常量**,没有任何函数逻辑。

---

## 8. 顶层不允许的目录

不要在 `src/` 下创建以下目录:

- ❌ `actions/` —— 用 Server Action 时直接放在 `app/.../actions.ts`
- ❌ `payment/` —— 已归并到 `services/billing/`
- ❌ `stores/` / `hooks/` —— 客户端 hooks 放 `lib/hooks/`,局部状态就近放组件
- ❌ `content/` —— 第一版不做 CMS

---

## 9. 新增文件 / 目录的流程

1. 在本文件搜索关键词,找到归属目录
2. 找不到 → 在 GitHub issue 里 @架构师,说明新文件用途
3. **不要先创建,再补文档**——本文件是真相源,先改本文件再写代码
