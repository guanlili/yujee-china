# Web 数据库 Schema

> **前置阅读**: `CLAUDE.md` → `docs/architecture.md` → `docs/web/layering.md`
>
> 谁读这份: 写 repo / migration 的人,或需要查"某个字段叫什么"的人。
> **权威源是 `apps/web/src/db/schema.ts`**;本文档与之冲突时以代码为准。

---

## 1. 通用约定

- 数据库: **Postgres**(Neon serverless)
- ORM: **Drizzle** + `drizzle-kit` migrations(`db/migrations/`,顺序编号 `0000_…`)
- 表名 / 字段: `snake_case`,Drizzle map 到 TS `camelCase`
- 主键: `id text`,默认 `gen_random_uuid()`(注意是 `text` 列,不是原生 `uuid` 类型)
- 时间戳: `timestamptz`,业务表带 `created_at`(部分带 `updated_at`)
- FK: 多数 `references(... onDelete: 'cascade')`;`albums.credit_hold_id` **故意不加 FK**(打破 albums ↔ credit_holds 环),强连接在 `credit_holds.album_id`

---

## 2. 表清单

| 表名 | 作用 | 由 better-auth 管? |
|---|---|---|
| `users` | 用户主表(含 `credit_balance` additionalField) | ✅ 是,不动 |
| `accounts` | 第三方登录 | ✅ |
| `sessions` | 会话 | ✅ |
| `verifications` | 邮箱验证 | ✅ |
| `customers` | 用户 → 支付平台客户号映射 | |
| `subscriptions` | 订阅记录 | |
| `albums` | 相册主表 | |
| `album_pages` | 相册单页 | |
| `album_messages` | Chat / 章节对话历史 + AI 改动痕迹 | |
| `agent_jobs` | Agent 生成任务 | |
| `credit_holds` | 积分冻结 | |
| `credit_ledger` | 积分流水 | |

合计 **12 张**(4 张 better-auth + 8 张业务)。

> `users.credit_balance` 是 better-auth additionalField(`int` notNull default 100);`credit_ledger` 是积分变更的真相源。

---

## 3. 枚举(`pgEnum`)

| 枚举 | 取值 | 用在 |
|---|---|---|
| `album_status` | `AGENT_RUNNING` / `EDITING` / `COMPLETED` / `FAILED` | `albums.status` |
| `album_stage` | `analysing` / `story` / `theme` / `cover` / `ready` | `albums.stage`(取值来自 contracts `AlbumStage`,见 §4) |
| `agent_job_status` | `QUEUED` / `RUNNING` / `COMPLETED` / `FAILED` | `agent_jobs.status` |
| `agent_job_kind` | `init` / `finalize` / `add` | `agent_jobs.kind` |
| `credit_hold_status` | `HOLDING` / `SETTLED` / `RELEASED` | `credit_holds.status` |
| `message_role` | `user` / `assistant` | `album_messages.role` |
| `customer_provider` | `stripe` / `creem` | `customers.provider` / `subscriptions.provider`(旧 `stripe` 仅历史兼容,新代码只写 `creem`) |
| `credit_ledger_reason` | `SIGNUP_BONUS` / `GENERATION_HOLD` / `GENERATION_SETTLE` / `GENERATION_RELEASE` / `PURCHASE` / `REFUND` / `ADMIN_ADJUST` | `credit_ledger.reason` |

---

## 4. `albums`

`status`(init 生命周期 + 积分)与 `stage`(五环节状态)**正交并存、互不派生**。

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | text PK | default `gen_random_uuid()` | |
| user_id | text FK users(id) | NOT NULL, ON DELETE CASCADE | |
| title | text | NOT NULL | |
| status | `album_status` | NOT NULL, default `AGENT_RUNNING` | 见 §10 状态机 |
| stage | `album_stage` | NOT NULL, default `analysing` | 五环节状态唯一真相源(Agent 不持 stage) |
| prompt | text | NOT NULL | 用户原始 prompt |
| layout_json | jsonb | NULL | finalize 后的扁平 layout;**`layout_json IS NULL` = 仍在 draft 阶段** |
| draft_json | jsonb | NULL | V3 authoring 树 + preview pages + progress,仅 draft 期存在;null = v1 相册 |
| photo_count | int | NOT NULL | |
| page_count | int | NOT NULL default 0 | |
| pdf_r2_key | text | NULL | 完成后写 |
| pdf_url | text | NULL | |
| cover_thumbnail_r2_key | text | NULL | 封面缩略图(列表展示) |
| cover_thumbnail_url | text | NULL | |
| credit_hold_id | text | NULL | **无 FK**(见 §1) |
| error_message | text | NULL | FAILED 时填 |
| created_at / updated_at | timestamptz | NOT NULL default now() | |

**索引**:
- `idx_albums_user_created` = `(user_id, created_at desc)` —— 列表查询
- `idx_albums_active` = `(status)` partial where `status in ('AGENT_RUNNING','EDITING')` —— 扫活跃任务

---

## 4.1 `customers`

内部 `user_id` → 外部支付平台客户号。当前应用层只写 `creem`;`stripe` enum 值仅兼容历史行。

| 字段 | 类型 | 约束 |
|---|---|---|
| id | text PK | default `gen_random_uuid()` |
| user_id | text FK users(id) | NOT NULL, ON DELETE CASCADE |
| provider | `customer_provider` | NOT NULL |
| external_customer_id | text | NOT NULL |
| email | text | NULL(冗余) |
| created_at / updated_at | timestamptz | NOT NULL default now() |

**索引**: `UNIQUE(user_id, provider)`、`UNIQUE(provider, external_customer_id)`、`(user_id)`。

---

## 4.2 `subscriptions`

订阅记录(按本售卖为主,订阅作为可选形态)。

| 字段 | 类型 | 约束 |
|---|---|---|
| id | text PK | default `gen_random_uuid()` |
| user_id | text FK users(id) | NOT NULL, ON DELETE CASCADE |
| provider | `customer_provider` | NOT NULL |
| external_customer_id | text | NULL |
| external_subscription_id | text | NOT NULL |
| plan_id / billing_cycle / status | text | NOT NULL |
| current_period_start / current_period_end | timestamptz | NOT NULL |
| cancel_at_period_end | boolean | NOT NULL default false |
| created_at / updated_at | timestamptz | NOT NULL default now() |

**索引**: `(user_id, current_period_end desc)`、`UNIQUE(provider, external_subscription_id)`。

---

## 5. `album_pages`

每页一行,方便编辑器局部更新。

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | text PK | default `gen_random_uuid()` | |
| album_id | text FK albums(id) | NOT NULL, ON DELETE CASCADE | |
| page_index | int | NOT NULL | 0-based |
| template_id | text | NOT NULL | 模板 id |
| images_json | jsonb | NOT NULL default `{}` | `{ slotId: photoId }` |
| texts_json | jsonb | NOT NULL default `{}` | `{ slotId: string }` |
| image_pos_json | jsonb | NOT NULL default `{}` | 每槽位置/缩放覆盖(#165),按 slotId 键;空 = 默认 50/50/1 |
| updated_at | timestamptz | NOT NULL default now() | |

**索引**: `UNIQUE(album_id, page_index)`、`(album_id)`。

**注意**: `images_json` 里的 `photoId` 是**浏览器侧本地编号**(`p1`/`p2`…),服务器只存字符串;编辑器从本地存储用 photoId 查原图。

---

## 5.1 `album_messages`

Chat / 章节对话历史。一行 = 一条消息(user 或 assistant)。

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | text PK | default `gen_random_uuid()` | |
| album_id | text FK albums(id) | NOT NULL, ON DELETE CASCADE | |
| user_id | text FK users(id) | NOT NULL, ON DELETE CASCADE | 冗余;Agent 永远看不到 |
| role | `message_role` | NOT NULL | `user` / `assistant` |
| content | text | NOT NULL | |
| layout_patch | jsonb | NULL | assistant 消息的 layout 改动;user 消息固定 NULL |
| usage | jsonb | NULL | assistant 模型用量;user 消息固定 NULL |
| chapter_id | text | NULL | 分组章节(Stage 4)对话;null = v1 chat-edit 消息 |
| created_at | timestamptz | NOT NULL default now() | |

**索引**: `(album_id, created_at)`、`(user_id, created_at desc)`、`(album_id, chapter_id, created_at)`。

**注意**: Agent 看到的对话历史**不带 `user_id` / `email`**,Web 转发时剥掉(§3 隐私)。

---

## 6. `agent_jobs`

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | text PK | default `gen_random_uuid()` | |
| request_id | text | NOT NULL UNIQUE | 全链路追踪 + 轮询 key |
| album_id | text FK albums(id) | NOT NULL, ON DELETE CASCADE | |
| user_id | text FK users(id) | NOT NULL, ON DELETE CASCADE | |
| status | `agent_job_status` | NOT NULL default `QUEUED` | |
| kind | `agent_job_kind` | NOT NULL default `init` | init / finalize / add;驱动失败/僵尸分支(失败语义相反) |
| stage | text | NULL | vision / writing / composing 等 |
| progress | int | NOT NULL default 0 | 0–100 |
| usage | jsonb | NULL | |
| error | jsonb | NULL | `{ code, message }` |
| created_at | timestamptz | NOT NULL default now() | |
| started_at | timestamptz | NULL | QUEUED→RUNNING 时置,之后每次进度回调刷新(**心跳,非固定开始时间**) |
| completed_at | timestamptz | NULL | |

**索引**:
- `(user_id, created_at desc)`
- `idx_agent_jobs_running_started` = `(started_at)` partial where `status = 'RUNNING'` —— 僵尸任务扫描
- `uq_agent_jobs_album_kind_active` = `UNIQUE(album_id, kind)` partial where `status in ('QUEUED','RUNNING')` —— DB 兜底「一个 (album, kind) 同时只一个活跃任务」
- `(album_id, created_at desc)` —— `findLatestByAlbum`(album 轮询)

---

## 7. `credit_holds`

| 字段 | 类型 | 约束 |
|---|---|---|
| id | text PK | default `gen_random_uuid()` |
| user_id | text FK users(id) | NOT NULL, ON DELETE CASCADE |
| album_id | text FK albums(id) | NOT NULL, ON DELETE CASCADE |
| amount | int | NOT NULL(冻结积分数) |
| status | `credit_hold_status` | NOT NULL default `HOLDING` |
| created_at | timestamptz | NOT NULL default now() |
| settled_at | timestamptz | NULL |

**索引**: `(user_id, created_at desc)`、`idx_credit_holds_holding` = `(status)` partial where `status = 'HOLDING'`。

---

## 8. `credit_ledger`

积分流水(append-only)。**修改 credit_ledger 必须先和架构师沟通**——支付相关表。

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | text PK | default `gen_random_uuid()` | |
| user_id | text FK users(id) | NOT NULL, ON DELETE CASCADE | |
| delta | int | NOT NULL | 变更量(正负) |
| reason | `credit_ledger_reason` | NOT NULL | 见 §3 |
| balance_after | int | NOT NULL | 变更后余额 |
| related_album_id | text FK albums(id) | NULL, ON DELETE SET NULL | |
| related_hold_id | text FK credit_holds(id) | NULL, ON DELETE SET NULL | |
| meta | jsonb | NULL | |
| created_at | timestamptz | NOT NULL default now() | |

**索引**: `(user_id, created_at desc)`。

---

## 9. 类型导出

`schema.ts` 末尾为每张表导出 `$inferSelect` / `$inferInsert`(如 `Album` / `NewAlbum`、`AgentJob` / `NewAgentJob`)。repo 与 service 直接复用这些类型,不要手写行类型。

---

## 10. 状态机

```
album.status（init 生命周期 + 积分）:
  AGENT_RUNNING ──► EDITING ──► COMPLETED
       │              │
       └─►FAILED      └─►FAILED

  • init 成功即按张实扣（⌈张数/10⌉，创建 credit_hold→直接结算 / ledger 扣减）
  • init 失败 → FAILED 时 release（credit_hold.status=RELEASED，不扣）
  （积分语义以 architecture §3 不变式 ④ 为准）

album.stage（五环节，正交于 status）:
  analysing ──► story ──► theme ──► cover ──► ready
                                    （cover 可跳，theme 可直接到 ready）
  • 导出闸门 = 章节故事全章完成即解锁；主题/封面不卡导出

agent_jobs.status:
  QUEUED → RUNNING → COMPLETED
                  └→ FAILED
  • kind=init 与 kind=finalize 的失败语义相反（init→FAILED+release；finalize→回 EDITING+保留 hold）

credit_holds.status:
  HOLDING → SETTLED / RELEASED
```

---

## 11. Migration 流程

```bash
# 1. 改 schema.ts
# 2. 生成 migration（顺序编号 0000_… / 0009_…）
pnpm --filter web db:generate
# 3. review 生成的 SQL
# 4. apply
pnpm --filter web db:migrate
```

**migration 硬规则**:
- 一次 migration **只做一件事**(加一列 / 加一个索引 / 一张表)
- 文件由 drizzle-kit 顺序编号(`0009_albums_stage.sql`),不要手改编号
- 改字段类型 / 改 NULL 约束之类破坏性修改,**先开 issue 由架构师 review**
- 涉及 `users` / `credit_ledger` / `credit_holds` 时,**先和架构师沟通**(支付相关)

---

## 12. 自查

- [ ] 字段命名是 snake_case 吗?TS 侧 camelCase 对得上吗?
- [ ] 索引建对了吗?(列表查询需要 `(user_id, created_at desc)`)
- [ ] 是不是只改了一件事?
- [ ] 涉及 `users` / `credit_ledger` / `credit_holds` / 支付表时,先和架构师沟通了吗?
- [ ] `albums.status` 与 `albums.stage` 没搞混吗?(正交,互不派生)
