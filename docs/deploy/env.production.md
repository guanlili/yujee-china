# 生产环境变量参考

> ⚠️ **本文件只写变量名 + 来源,绝不写真值。** 真实密钥只存在于 Vercel
> 项目设置、Fly secrets,以及本地密码管理器里 —— 永远不进仓库。
>
> 权威清单是代码,不是本文:Web 看 `apps/web/src/lib/env.ts`,Agent 看
> `apps/agent/src/settings.py`。本文按服务分组、标注来源,方便上线时核对。

两个服务,两套环境变量:

- **Web** → Vercel 项目环境变量(Production scope)
- **Agent** → Fly.io。机密用 `fly secrets set`;非机密(模型名/端点/开关)已写进
  `apps/agent/fly.toml` 的 `[env]`,无需重复设置。

来源图例:`复制` = 从老项目搬生产值;`新生成` = 这次新建;
`已在 fly.toml` = 非机密,已硬编码进 `apps/agent/fly.toml`。

---

## 1. Web(Vercel 环境变量)

权威:`apps/web/src/lib/env.ts`。带 `.default()` 的缺省也能 build;`.optional()`
的(Google OAuth / Resend / Creem / R2)缺省即关闭对应能力。

### 必填

| 变量 | 来源 | 说明 |
|---|---|---|
| `DATABASE_URL` | 复制 | Neon Postgres 连接串(生产库,含 `?sslmode=require`) |
| `AGENT_BASE_URL` | 新生成 | Agent 的 Fly 公网地址,如 `https://yujee-agent.fly.dev` |
| `AGENT_SHARED_SECRET` | 新生成 | web↔agent 共享密钥,**必须与 Agent 侧同值**(见 §2) |
| `WEB_BASE_URL` | 新生成 | `https://yujeeai.com` |
| `BETTER_AUTH_SECRET` | 复制 | better-auth 会话签名密钥 |

### 可选(缺省即关闭对应能力)

| 变量 | 来源 | 说明 |
|---|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | 复制 | Google OAuth 登录;缺省则只剩邮箱登录 |
| `AUTH_EMAIL_FROM` | 复制 | 发信地址,如 `Yujee <noreply@yujeeai.com>` |
| `EMAIL_DELIVERY` | 新生成 | 生产设 `resend`;本地可走 capture |
| `RESEND_API_KEY` | 复制 | Resend 发信 key(`EMAIL_DELIVERY=resend` 时必填) |
| `CRON_SECRET` | 新生成 | cron 鉴权(见 §3),`openssl rand -hex 32` 生成 |
| `CREEM_API_KEY` | 复制 | Creem 支付主通道 |
| `CREEM_API_BASE_URL` | 复制 | 默认 `https://api.creem.io`,通常不用设 |
| `CREEM_WEBHOOK_SECRET` | 复制 | Creem webhook 验签 |
| `CREEM_PRODUCT_ID_PACK_2400` | Creem dashboard | 对应包的 Creem 产品 ID(`prod_...`) |
| `CREEM_PRODUCT_ID_PACK_4800` | Creem dashboard | 同上 |
| `CREEM_PRODUCT_ID_PACK_8000` | Creem dashboard | 同上 |
| `CREEM_PRODUCT_ID_PACK_16000` | Creem dashboard | 同上 |
| `R2_ACCOUNT_ID` | 复制(映射) | 见 §4 |
| `R2_ACCESS_KEY_ID` | 复制(映射) | 见 §4 |
| `R2_SECRET_ACCESS_KEY` | 复制(映射) | 见 §4 |
| `R2_BUCKET` | 复制(映射) | 见 §4,默认 `yujee-pdfs` |
| `R2_PUBLIC_BASE_URL` | 复制(映射) | 见 §4,如 `https://cdn.yujeeai.com` |

> 仅本地/调试用(生产不设,有缺省值):`DEMO_USER_ID`、`DEMO_USER_EMAIL`、
> `EMAIL_CAPTURE_FILE`。

---

## 2. Agent(Fly.io)

权威:`apps/agent/src/settings.py`。app `yujee-agent`,region `nrt`,内部端口 `8001`。

`main.py` 启动自检会 fail-fast:`AGENT_ENV=production` 强制
`AGENT_PIPELINE_MODE=real`,且 real 模式下 `ARK_API_KEY` 与 `DEEPSEEK_API_KEY`
缺一不可 —— 漏设直接 boot 失败,不会等到首个请求。

### 机密(`fly secrets set`,不要写进 fly.toml)

| 变量 | 来源 | 说明 |
|---|---|---|
| `AGENT_SHARED_SECRET` | 新生成 | **与 Web 侧同值**(§1) |
| `ARK_API_KEY` | 复制 | 火山方舟 API key(doubao vision + planning 共用) |
| `DEEPSEEK_API_KEY` | 复制 | 生产指向火山,**填同一个 ARK key** |

可选机密(只在切换识图主模型到 OpenAI 时才需要):

| 变量 | 说明 |
|---|---|
| `OPENAI_API_KEY` | 仅当 `VISION_PROVIDER=openai` 或启用 describe-content 的 GPT 主链路时需要 |

### 非机密(已在 `apps/agent/fly.toml` 的 `[env]`,此处列出便于核对)

| 变量 | 值 |
|---|---|
| `PORT` | `8001` |
| `AGENT_ENV` | `production` |
| `AGENT_PIPELINE_MODE` | `real` |
| `WEB_BASE_URL` | `https://yujeeai.com` |
| `ARK_BASE_URL` | `https://ark.cn-beijing.volces.com/api/v3` |
| `ARK_VISION_MODEL` | `doubao-seed-1-6-vision-250815` |
| `DEEPSEEK_BASE_URL` | `https://ark.cn-beijing.volces.com/api/v3`(指火山,非 deepseek.com) |
| `DEEPSEEK_MODEL` | `doubao-seed-2-0-lite-260428` |

### 有代码缺省、一般不必设(调优才覆盖)

`settings.py` 给了健壮缺省,生产通常不动:

- `LOG_LEVEL`(默认 `info`)
- `VISION_PROVIDER`(默认 `ark` 火山;设 `openai` 才切到 GPT 识图)
- 超时与并发:`BACKGROUND_TASK_TIMEOUT_SECONDS`(600)、`INIT_WRITE_CONCURRENCY`(3)、
  `ARK_TIMEOUT_SECONDS`(120)、`OPENAI_TIMEOUT_SECONDS`(120)、`DEEPSEEK_TIMEOUT_SECONDS`(60)
- describe-content 链路:`DESCRIBE_OPENAI_MODEL`(`gpt-5.5-mini`)、
  `DESCRIBE_OPENAI_TIMEOUT_SECONDS`(30)、`DESCRIBE_BATCH_DEADLINE_SECONDS`(90)、
  `DESCRIBE_CONCURRENCY_THRESHOLD_LO`(20)、`DESCRIBE_CONCURRENCY_THRESHOLD_HI`(40)、
  `DESCRIBE_MAX_CONCURRENCY`(3)
- 推理开关:`ARK_DISABLE_THINKING`(True)、`OPENAI_USE_JSON_OBJECT`(True)、
  `DEEPSEEK_USE_JSON_OBJECT`(False)、`DEEPSEEK_DISABLE_THINKING`(False)、
  `COMPOSING_DISABLE_THINKING`(True)
- OpenAI 槽端点/模型:`OPENAI_BASE_URL`、`OPENAI_VISION_MODEL`

设置示例(值用占位符):

```bash
fly secrets set \
  AGENT_SHARED_SECRET=<同 web> \
  ARK_API_KEY=<火山 key> \
  DEEPSEEK_API_KEY=<同 ARK_API_KEY>
```

---

## 3. CRON_SECRET 与 cron 鉴权

`recover-stuck` / `cleanup-photos` 平时走管理员登录态(`requireAdmin`),但 Vercel
cron **带不了 session cookie**。修法:这两个 route 加了 CRON_SECRET 旁路 ——
请求带 `Authorization: Bearer <CRON_SECRET>`(Vercel cron 自动注入)或
`?secret=<CRON_SECRET>` 即放行,否则仍要管理员登录。

```bash
openssl rand -hex 32   # 生成高熵随机值,设进 Vercel(Production)
```

`apps/web/vercel.json` 里的两个 cron 用干净路径(不在 URL 里放 secret),鉴权全靠
Vercel 注入的 Bearer 头 —— 避免密钥进日志/URL。

---

## 4. R2 变量映射(从老项目 `STORAGE_*`)

新项目用 `R2_*` 命名。从老项目 `STORAGE_*` 生产值按下表换算:

| 老变量 | → 新变量 | 换算规则 |
|---|---|---|
| `STORAGE_ENDPOINT` | `R2_ACCOUNT_ID` | **抽 host 段**:`https://<account_id>.r2.cloudflarestorage.com` → 取 `<account_id>` |
| `STORAGE_ACCESS_KEY` | `R2_ACCESS_KEY_ID` | 原值直接搬 |
| `STORAGE_SECRET_KEY` | `R2_SECRET_ACCESS_KEY` | 原值直接搬 |
| `STORAGE_BUCKET` | `R2_BUCKET` | 原值直接搬 |
| `STORAGE_DOMAIN` | `R2_PUBLIC_BASE_URL` | 公网访问域,补全为完整 URL(如 `https://cdn.yujeeai.com`) |

> 关键:`R2_ACCOUNT_ID` 不是整条 endpoint URL,而是其中的 account id 段。
> SDK(`@aws-sdk/client-s3`)在代码里用它拼回 `https://<id>.r2.cloudflarestorage.com`。

---

## 5. Vercel monorepo 设置

- **Root Directory** 设为 `apps/web`(Vercel 项目设置),`vercel.json` 也在该目录下。
- pnpm workspace 由 Vercel 自动识别:`pnpm install` 爬到仓库根装全 workspace,
  `@yujee/contracts` 经 `transpilePackages` 可正常引用。
- 若 Vercel 提示需要根目录外文件,打开 "Include files outside the root directory"。
