# 国内版改造计划（路线 A：单仓 + deploy/china/ 部署层）

> 2026-10-25 起草。调研结论基于本仓当前 main；引用的 文件:行 在改动后需复核。
> 原则：**代码合回主仓、env 门控、海外部署不受影响**。不 fork。

## 0. 总览：三层工作

| 层 | 内容 | 改业务代码？ | 规模 |
|---|---|---|---|
| P1 基础设施 | `deploy/china/`：compose 编排、nginx、PG、对象存储、cron、密钥、构建镜像源 | 否 | 主要是新文件 |
| P2 代码改造 | compose 换 Ark、存储抽象 env 化、web Docker 化、域名硬编码、CI/CD | 是（全部 env 门控合回主仓） | 核心代码约 150 行 + 测试 |
| P3 产品国内化 | 支付（微信/支付宝）、手机号登录、人民币计价、默认语言 | 是 | 视目标用户拍板 |

关键调研结论（为什么改造面小）：
- engine 的 compose 调用有**唯一汇聚点** `handler.py:282-302 _gemini()`，且消息体**本来就是 OpenAI 多模态格式**（`image_url` content），`ai_client.chat_completion` 原样透传不拦截图片块，ark 带图调用已有生产实证（photo profile 的 semantic.py:145-172）。
- web 的 R2 依赖收敛在**唯一构造点** `src/lib/r2/r2-client.ts:19-37`，全仓无第二个 S3Client，门面 API 之下调用点零改动。
- `NEXT_PUBLIC_*` 源码零使用——换域名**不需要**重建客户端 bundle，全是服务端 env。
- 服务端无 TZ 依赖；design-agent 生产本来就跑火山 Ark。

## 1. P0 前置决策（阻塞项）

| 决策 | 推荐 | 状态 |
|---|---|---|
| ICP 备案 | 域名定下即启动（1–3 周，个人/企业主体确认） | ⬜ |
| 服务器 | 独立一台 4C/16G/100G+（不与英语测评机混部）；腾讯 CVM 或火山 g4i | ⬜ |
| 对象存储 | 腾讯云 COS（S3 兼容成熟）或自建 MinIO（零外部依赖） | ⬜ |
| 数据库 | docker PG 16 + 数据卷 + 第一天就配每日备份；有存量数据则 pg_dump 迁移 | ⬜ |
| 存量数据 | 生产有用户数据 → 写迁移脚本；无 → 空库新起、密钥全部重生成 | ⬜ |
| 目标用户 | 国内用户 → P3 必做；仅迁基础设施 → P3 全部可缓 | ⬜ |

## 2. P1 基础设施层（不改业务代码）

### 2.1 目录

```
deploy/china/
├── docker-compose.yml      # web + agent + clip + design-agent + postgres + (minio)
├── nginx/                  # 反代 + TLS（web 443；内网转发 agent/design/clip 不出机器）
├── .env.china.example      # 国内全套变量（含新增项）
├── crontab                 # 3 个 cron + PG 备份
├── build/                  # 镜像源与预下载：pip 清华源、torch TUNA 源、ONNX 权重、npmmirror
└── scripts/                # deploy.sh / backup.sh / healthcheck.sh
```

### 2.2 容器编排要点（来自 engine 调研的硬纪律）

- **每容器单进程**。engine 的全部并发原语是进程内的（`_GROUPING_SEMAPHORE`、按事件循环存的 `_PROFILE_SEMAPHORES`、`INFERENCE_LOCK`），**加 uvicorn workers = 全部失效**。design-agent 单机铁律不变（session 在内存，replicas=1）。
- **CLIP 容器独享 2GB、单实例**（torch+ViT-B-32 常驻 ~1.4GB，实测并发推理即爆）。冷加载数十秒，建议常驻不按需启停（与 Fly 省钱拓扑相反，自建机不差这点内存）。
- **端口**：engine 与 clip 镜像默认都听 8001，compose 里各自映射/容器网络 + 容器名寻址（`GROUPING_CLIP_BASE_URL=http://clip:8001`、`AGENT_BASE_URL=http://agent:8001`）。
- **关键参数**（⚠️ 不要照抄 `.env.example` 的 dev 值）：
  - `BACKGROUND_TASK_TIMEOUT_SECONDS=600`（example 里 180 是 dev 值；预算算术有守卫测试）
  - `COMPOSE_MAX_CONCURRENCY=4` 起步，观察 ark 限流
  - **僵尸超时耦合契约**：engine compose 封顶 11 分钟 ↔ web `COMPOSE_ZOMBIE_TIMEOUT_MS` 12 分钟，两侧必须一起核对
- engine 不连数据库（psycopg 是死依赖），PG 只服务 web。

### 2.3 构建外网依赖（国内镜像化清单）

| 依赖 | 源 | 措施 |
|---|---|---|
| `python:3.12-slim` / `node:24-slim` | Docker Hub | 配 registry mirror（云厂商加速器） |
| torch CPU wheel（~170–200MB，仅 CLIP 镜像） | download.pytorch.org | 换 TUNA pytorch 镜像或预下载 wheel |
| fastapi/httpx/pydantic 等 | PyPI | `-i` 清华/阿里 pypi |
| u2netp(4MB) + isnet(170MB) ONNX 权重 | **GitHub Releases**（rembg v0.0.0，URL 锁死是刻意的） | 预下载后 COPY 进镜像（勿改 URL 指向漂移分支） |
| pnpm install（web/design-agent） | npm registry | npmmirror |

构建上下文一律从**仓根**（engine 与 design-agent 的 Dockerfile 都 COPY 了 `packages/contracts/templates`）。

### 2.4 cron 迁移（Vercel → crontab）

- 鉴权：`Authorization: Bearer $CRON_SECRET`（`src/lib/auth/cron-auth.ts`）。⚠️ `CRON_SECRET` 不在生产必填清单里，漏配不炸只 401——部署脚本要自检。
- Vercel cron 是 **UTC**，crontab 按北京时间换算：cleanup-anon 02:00 / cleanup-photos 03:00 / recover-stuck 04:00（UTC）→ 北京 10/11/12 点，或自行重排低峰。
- 顺手把 PG 每日备份挂进同一 crontab（参考英语测评项目踩过的 cron 坑：`set -e` 与注册姿势）。

### 2.5 对象存储

- 选 COS/MinIO 后配**生命周期规则**：`analyze-uploads/` 前缀 1 天过期（应用层不删，不配则无限累积）。其余前缀（pdfs/photo-originals/photo-masks/photo-snapshots/cover-thumbs）不可变长期保留，靠 cleanup-photos cron GC。
- `R2_PUBLIC_BASE_URL` 换成国内 CDN/直链域——**浏览器直连存储域上传/取图**，这个域名的可达性才是国内化的核心，不只是服务端签名目标。

## 3. P2 代码改造（env 门控，合回主仓）

### 3.1 engine：compose provider 切换（0.5–1 人日）

| 位置 | 改动 |
|---|---|
| `engine/src/settings.py:143-155` | 新增 `COMPOSE_PROVIDER: Literal["gemini","ark"]="gemini"`（默认不动海外） |
| `engine/src/workflows/core/compose/handler.py:282-302` | `_gemini()` 加 ark 分支 → `ai_client.chat_completion` + `extract_text/extract_usage` |
| `vision_provider.py:98-118` | `ark_vision_slot` 加 `model`/`timeout_seconds` 覆盖参数（compose 不能复用写死的 ark_vision 槽参数） |
| `engine/tests/` | 仿 test_compose.py 的 monkeypatch 注入 + 预算/降级路径测试 |

行为差异三坑（切 ark 必处理）：
1. doubao 文本模型 `response_format=json_object` 会 400 → ark 分支不传，靠 prompt + `parse_json_loose` 兜底；
2. **thinking 必须 disabled**（reasoning token 与 max_tokens 共享预算，compose 单章 8192 token 长文会被思考挤截断）——`extra_body {"thinking":{"type":"disabled"}}` 已有封装；
3. `maxOutputTokens` → `max_tokens` 参数名映射（chat_completion 已支持）。

验收：同一批照片 + chapterContext，Gemini（海外）与 ark（国内）成稿质量对比，重点看中文文案质量与 JSON 结构稳定性。

### 3.2 web：存储抽象 env 化（半天）

- `src/lib/r2/r2-client.ts:19-37` 的 `client()`：endpoint/region/`forcePathStyle` 改从 env 读（保留 R2 默认值不变 → 海外零影响）。新增 `S3_ENDPOINT`/`S3_REGION`/`S3_FORCE_PATH_STYLE`（或复用现有 R2_* 语义扩展）。
- 现有 checksum 配置（`WHEN_REQUIRED`，防 SDK 把 CRC32 签进 presigned PUT）对 COS/MinIO 同样安全，保留。
- 实测项：COS/MinIO 的 presigned PUT/GET（SigV4）浏览器直传兼容性——这是全链路最关键的实测点，**先于一切编码验证**。
- `IMAGE_PROVIDER=ark` + `ARK_API_KEY`（国内红利：env.ts 注释实测北京 Ark 直连 5.6s；缺 key 仅生图入口 501）。

### 3.3 web：Docker 化（半天–1 天）

- 无现成 Dockerfile。加 `output: 'standalone'`（保留 `outputFileTracingIncludes` 的字体追踪与 `serverExternalPackages: ['subset-font']`）。
- 迁移独立成部署 step（`pnpm db:migrate` = `drizzle-kit migrate`），**不要**挂在 start 前——多实例会并发跑迁移。注意 drizzle.config 读 `.env`，容器里显式注入 `DATABASE_URL`。

### 3.4 域名切换清单（换域即查）

- env：`WEB_BASE_URL`、`R2_PUBLIC_BASE_URL`、`AUTH_EMAIL_FROM`
- 硬编码：`lib/seo/site.ts:10` SITE_URL（sitemap/canonical/JSON-LD 全走它）、`next.config.mjs:44-45` www 308、`config/social.ts:21`、`settings/page.tsx:10`、`templates/mag-20/index.tsx:48`（**印在书页上的网址**，模板改版要过 templates:check）
- Google/Apple OAuth 控制台回调（国内版可不配：Google 缺省自动关闭、Apple 四件套缺一即禁用，邮箱密码登录不受影响）
- `NEXT_PUBLIC_*` 零使用，无需重建客户端 bundle

### 3.5 CI/CD

- 复用英语测评项目的成熟链路：GitHub Actions → SSH 部署到国内服务器（gh-proxy 镜像 + git bundle 兜底）。
- engine/design-agent 现有 Fly workflow 保留不动（海外线）；国内线新增 workflow，按 paths 过滤触发（engine/**、apps/web/**、packages/**、deploy/china/**）。
- 记得 README「手动 flyctl deploy」的说法已过时（现为 CI 部署），国内线文档写清楚自己的部署入口。

## 4. P3 产品国内化（视"目标用户"拍板）

1. **支付**：照 Waffo 模式加 wechat-pay/alipay provider——5 个插入点已定位（`services/billing/` 新 service、`config/pricing.ts:33-36` 扩类型、checkout 路由映射表、webhook 薄壳、env 凭证组）；落账统一走 `creditService.applyDelta` + `external_event_id` 幂等。
2. **手机号登录**：better-auth 1.4.17 应带官方 `phone-number` 插件（需 pnpm install 后验证），接线点 `better-auth.ts:187-197` plugins 数组（⚠️ `nextCookies()` 必须收尾）；users 表加 phoneNumber 迁移；`lib/sms/` 接云厂商 SMS。游客匿名账号 → 手机号过户链路可复用 `anonTransferService`。
3. **人民币计价**：`config/pricing.ts`（priceUsd 单一来源）+ `pricing/page.tsx:51-59` USD 硬编码格式化，价格体系与展示层双改。
4. **默认语言/SEO**：next-intl 默认 locale 与 sitemap 策略；国内 SEO 另议（llms.txt/hreflang 对百度无意义）。

## 5. 验收清单（端到端）

- [ ] 空库新用户注册 → 上传 50 张照片（浏览器直传国内存储）→ 分章正确
- [ ] select-layout 出全页 → 逐章讲故事 → **compose 全书成稿（ark，中文质量验收）**
- [ ] 编辑器对话改书（design-agent）一轮含写工具 + 滤镜/抠图（CLIP worker 2GB 实测）
- [ ] 协同编辑双人并发（OCC 三版本号）
- [ ] PDF 导出 + 分享页 + 封面缩略图
- [ ] 大书压测：100 张照片 analyze 内存峰值（base64+解码图双驻留）+ compose 并发 4 的 ark 限流表现
- [ ] 3 个 cron 跑通 + PG 备份可恢复演练
- [ ] 重启演练：全部容器重启后状态无损（design-agent 丢 session 属预期，书状态由 web 回灌）

## 6. 风险与坑速查

- `.env.example` 的 `BACKGROUND_TASK_TIMEOUT=180` 是 dev 值，生产必须 600。
- `CRON_SECRET` 漏配静默 401（不在生产必填清单）。
- engine/web 僵尸超时（11/12 分钟）是隐式契约，改一侧必须同步另一侧。
- presign 的存储域名必须**浏览器可达**，别只换服务端 endpoint。
- isnet 权重 170MB 从 GitHub Releases 下载——构建机要么走代理要么预下载 COPY。
- `mag-20` 模板书页上印着 www.yujeeai.com，换品牌要过模板改版流程。
- photo profile 默认关（零 AI 承诺）；国内若开，成本核算先做（每张一次视觉调用）。
