# 生产环境变量模板

> ⚠️ **本文件只写变量名 + 来源,绝不写真值。** 真实密钥只存在于 Vercel
> 项目设置、Fly secrets,以及你本地的密码管理器里 —— 永远不进仓库。

两个服务,两套环境变量:

- **Web** → Vercel 项目环境变量(Production scope)
- **Agent** → Fly.io。机密用 `fly secrets set`,非机密(模型名/端点)已写进
  `apps/agent/fly.toml` 的 `[env]`,无需重复设置。

来源图例:`复制` = 从老项目 `memoir-web` 的生产值搬过来;`新生成` = 这次新建;
`已在 fly.toml` = 非机密,已硬编码在 `apps/agent/fly.toml`。

---

## 1. Web(Vercel 环境变量)

| 变量 | 来源 | 说明 |
|---|---|---|
| `DATABASE_URL` | 复制 | Neon Postgres 连接串(生产库,含 `?sslmode=require`) |
| `AGENT_BASE_URL` | 新生成 | Agent 的 Fly 公网地址,如 `https://yujee-agent.fly.dev`(或 `https://agent.yujeeai.com`) |
| `AGENT_SHARED_SECRET` | 新生成 | web↔agent 共享密钥,**必须与 Agent 侧同值**(见 §2) |
| `WEB_BASE_URL` | 新生成 | `https://yujeeai.com` |
| `BETTER_AUTH_SECRET` | 复制 | better-auth 会话签名密钥(≥16 字符) |
| `AUTH_EMAIL_FROM` | 复制 | 如 `Yujee <noreply@yujeeai.com>` |
| `EMAIL_DELIVERY` | 新生成 | 生产设 `resend` |
| `RESEND_API_KEY` | 复制 | Resend 发信 key |
| `CRON_SECRET` | 新生成 | cron 鉴权(见 §4)。Vercel cron 会自动带 `Authorization: Bearer <CRON_SECRET>` |
| `CREEM_API_KEY` | 复制 | Creem 支付(海外主通道) |
| `CREEM_API_BASE_URL` | 复制 | 默认 `https://api.creem.io`,通常不用设 |
| `CREEM_WEBHOOK_SECRET` | 复制 | Creem webhook 验签 |
| `STRIPE_API_KEY` | 复制 / 可空 | Stripe 备用通道,缺省即关闭 Stripe |
| `STRIPE_WEBHOOK_SECRET` | 复制 / 可空 | 同上 |
| `R2_ACCOUNT_ID` | 复制(映射) | 见 §3 |
| `R2_ACCESS_KEY_ID` | 复制(映射) | 见 §3 |
| `R2_SECRET_ACCESS_KEY` | 复制(映射) | 见 §3 |
| `R2_BUCKET` | 复制(映射) | 见 §3,默认 `yujee-pdfs` |
| `R2_PUBLIC_BASE_URL` | 复制(映射) | 见 §3,如 `https://cdn.yujeeai.com` |

> 权威清单:`apps/web/src/lib/env.ts`。带 `.default()` 的变量缺省也能 build;
> `.optional()` 的(Resend/Creem/Stripe/R2)缺省即关闭对应能力。

---

## 2. Agent(Fly secrets)

机密 —— 用 `fly secrets set`(不要写进 fly.toml):

| 变量 | 来源 | 说明 |
|---|---|---|
| `AGENT_SHARED_SECRET` | 新生成 | **与 Web 侧同值**(§1) |
| `ARK_API_KEY` | 复制 | 火山方舟 API key(doubao vision + planning 共用) |
| `DEEPSEEK_API_KEY` | 复制 | 生产指向火山,**填同一个 ARK key** |

非机密(已在 `apps/agent/fly.toml` 的 `[env]`,此处仅列出便于核对):

| 变量 | 值 |
|---|---|
| `AGENT_ENV` | `production` |
| `AGENT_PIPELINE_MODE` | `real` |
| `WEB_BASE_URL` | `https://yujeeai.com` |
| `ARK_BASE_URL` | `https://ark.cn-beijing.volces.com/api/v3` |
| `ARK_VISION_MODEL` | `doubao-seed-1-6-vision-250815` |
| `DEEPSEEK_BASE_URL` | `https://ark.cn-beijing.volces.com/api/v3`(指火山,非 deepseek.com) |
| `DEEPSEEK_MODEL` | `doubao-seed-2-0-lite-260428` |

> 权威清单:`apps/agent/src/settings.py`。`main.py` 启动自检:`AGENT_ENV=production`
> 强制 `AGENT_PIPELINE_MODE=real`,且 real 模式下 `ARK_API_KEY` 与
> `DEEPSEEK_API_KEY` 缺一不可 —— 漏设会在 boot 直接 fail-fast,不会等到首个请求。

设置示例(值用占位符):

```bash
fly secrets set \
  AGENT_SHARED_SECRET=<同 web> \
  ARK_API_KEY=<火山 key> \
  DEEPSEEK_API_KEY=<同 ARK_API_KEY>
```

---

## 3. R2 变量映射(从老 memoir-web `STORAGE_*`)

新项目用 `R2_*` 命名。从老项目的 `STORAGE_*` 生产值按下表换算:

| 老变量(memoir-web) | → 新变量(Yujee web) | 换算规则 |
|---|---|---|
| `STORAGE_ENDPOINT` | `R2_ACCOUNT_ID` | **抽 host 段**:`https://<account_id>.r2.cloudflarestorage.com` → 取 `<account_id>` |
| `STORAGE_ACCESS_KEY` | `R2_ACCESS_KEY_ID` | 原值直接搬 |
| `STORAGE_SECRET_KEY` | `R2_SECRET_ACCESS_KEY` | 原值直接搬 |
| `STORAGE_BUCKET` | `R2_BUCKET` | 原值直接搬(如沿用旧桶) |
| `STORAGE_DOMAIN` | `R2_PUBLIC_BASE_URL` | 公网访问域,补全为完整 URL(如 `https://cdn.yujeeai.com`) |

> 关键:`R2_ACCOUNT_ID` 不是整条 endpoint URL,而是其中的 account id 段。
> SDK(`@aws-sdk/client-s3`)在代码里用它拼回 `https://<id>.r2.cloudflarestorage.com`。

---

## 4. CRON_SECRET 与 cron 鉴权

`recover-stuck` / `cleanup-photos` 平时走管理员登录态(`requireAdmin`),但 Vercel
cron **带不了 session cookie**。修法:这两个 route 加了 CRON_SECRET 旁路 ——
请求带 `Authorization: Bearer <CRON_SECRET>`(Vercel cron 自动注入)或
`?secret=<CRON_SECRET>` 即放行,否则仍要管理员登录。

生成并设置:

```bash
# 生成一个高熵随机值
openssl rand -hex 32
# 设进 Vercel(Production)。设了之后 Vercel cron 会自动带上 Bearer 头。
```

`apps/web/vercel.json` 里的两个 cron 用的是干净路径(不在 URL 里放 secret),
鉴权全靠 Vercel 注入的 Bearer 头 —— 避免密钥进日志/URL。

手动验证(`<SECRET>` 换成真值):

```bash
# 不带凭证 → 401
curl -i -X POST https://yujeeai.com/api/v1/admin/recover-stuck
# 带正确 secret → 200(GET,模拟 cron)
curl -i "https://yujeeai.com/api/v1/admin/recover-stuck?secret=<SECRET>"
curl -i -H "Authorization: Bearer <SECRET>" https://yujeeai.com/api/v1/admin/recover-stuck
```

---

## 5. Vercel monorepo 设置

- **Root Directory** 设为 `apps/web`(Vercel 项目设置)。`vercel.json` 也在该目录下。
- pnpm workspace 由 Vercel 自动识别:`pnpm install` 会爬到仓库根装全 workspace,
  `@yujee/contracts` 经 `transpilePackages` 可正常引用。
- 若 Vercel 提示需要根目录外文件,打开 "Include files outside the root directory"。
