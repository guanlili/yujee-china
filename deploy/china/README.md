# 国内部署（deploy/china/）—— IP 起步、域名后补

> 2026-10-25 起草,同日落地为单机全家桶(历史草案曾规划两台 CVM + 东京 Fly CLIP,
> 已废弃,见文末「三机时代遗物」)。本目录是**国内专属部署层**：业务代码改动走主仓
> PR（env 门控），不在此 fork。

## 机器落位（2026-10-25 已部署：单机全家桶 @ 49.232.156.221）

```
用户浏览器 ──HTTP──▶ 49.232.156.221:8080（speakup 生产同机，80/443 归 speakup 不动）
   ┌─ yujee-web-1        Next.js :8080
   ├─ yujee-design-agent-1  容器内网 :8787（对话改书，火山 Ark）
   ├─ yujee-agent-1      容器内网 :8001（生成主链路；调试口 127.0.0.1:8002）
   ├─ yujee-clip-1       CLIP+isnet（调试口 127.0.0.1:8001）
   ├─ yujee-postgres-1   PG16 + 自签 TLS（web 的 db 客户端对非 localhost 强制 ssl require）
   └─ root crontab        3 个 cron + PG 每日备份（4 行已装）
编排：compose.single.yml（五服务同一网络，agent→clip / web→agent 全走容器名）
```

部署记录（2026-10-25）：五服务全部上线健康；33 个 drizzle 迁移已跑；三个镜像
yujee/{clip:2.73GB, web:2.38GB, design:750MB}；实测内存 ~0.5G 常驻（CLIP 惰性
加载，embedding 时 +1G）；speakup 全程无影响（无 OOM、无重启，其 10:45 的容器
重建是它自己的 CI 部署）。入口：**http://49.232.156.221:8080**（IP 阶段明文，
仅测试账号）。部署现场 `~/yujee-clip/`，密钥 `deploy/china/env/{clip,single}.env`。

途中排掉的坑（都已固化到配置注释）：
1. open_clip 3.x `pretrained="openai"` 拉 HuggingFace 国内不通 → ViT-B-32.pt 烤进
   镜像走 `GROUPING_CLIP_MODEL_PATH`；
2. web db 客户端 `client.ts:15` 对非 localhost 强制 `ssl:'require'` → PG 挂自签
   证书开 TLS（长期应在 P2 把 ssl 做成可配）；
3. CRON_SECRET 泄露过会话输出 → 已轮换并重渲染 crontab；
4. compose 的 rsync `--relative` 拼出嵌套目录、sed `/` 分隔符撞 base64 —— 教训：
   模板渲染用 python，别用 sed。

东京 Fly CLIP worker 已从架构中移除；117/48 两台小机退出本方案（48 建议做
uptime-kuma 监控 + 异地备份接收端）。

## 改造与部署状态（2026-10-25 核对）

| 项 | 状态 |
|---|---|
| P2.1 engine compose→Ark（`COMPOSE_PROVIDER=ark`） | ✅ 已合入主仓（`engine/tests/test_compose_provider_ark.py`），生产 single.env 配 `COMPOSE_ARK_MODEL=doubao-seed-2-0-pro-260215` |
| P2.2 web 存储 env 化（COS endpoint/path-style） | ✅ 已合入主仓；桶 CORS + `analyze-uploads/` 生命周期已配好并实测 |
| P2.3 三个 Dockerfile（web/design/clip） | ✅ 已跑通，镜像 `yujee/{web,design,clip}:china` |
| 单机五容器部署 + 33 迁移 + crontab | ✅ 2026-10-25 全部上线健康 |
| 端到端验收 | ◐ 合成书 e2e 已过（成稿 7.2s、回调三连达）；**真实照片成稿质量验收待做** |
| 浏览器全流程实测 | ◐ 前置已清（8080 安全组放行、COS 预检 200）；实测本身待跑 |
| 域名 / HTTPS / 备案 / 支付 / 手机号登录 | ⬜ 未做（见「域名后补」与 plans §3.4） |

⚠️ compose.single.yml 里 `ARK_VISION_MODEL=doubao-seed-1-6-vision-250815` 指向的
独立 vision 模型方舟已停开（seed 系原生多模态）——photo-profile 现默认关着无害，
开启 `AGENT_ENABLE_PHOTO_PROFILE` 前必须先换模型；`agent` 的 `DEEPSEEK_MODEL=
deepseek-v4-flash-260425` 当前无消费方且未开通，属死配置，清理时一并处理。

## 域名后补（一次性动作，配置已参数化）

1. `single.env` 里 `WEB_BASE_URL` 换域名；engine 侧 callbackUrl 由 web 请求自动携带，无需改。
2. web 容器前加 nginx + certbot（`8080:3000` 改为 nginx 443 反代容器；届时根布局的
   crypto.randomUUID polyfill 自动让位于原生实现）。
3. 硬编码域名清单见 plans 文档 §3.4（`lib/seo/site.ts` SITE_URL 等 5 处 + OAuth 回调注册）。

## 安全基线（单机 49.232 现实）

- **安全组**：只开 22/8080（80/443 归同机 speakup，绝不动）；8001/8002 调试口仅绑定
  127.0.0.1，不进公网安全组。
- 与 speakup 的隔离：独立 compose 项目（name: yujee）、全部容器 mem/cpus 限额、
  端口只用 8080。
- 所有 `待生成` 密钥用 `openssl rand -base64 32` 现生成。
- IP 阶段浏览器→web 为明文 HTTP：**仅限内部测试账号，禁止真实用户**（密码明文过网）。
- 遗留：ARK key 仍是主账号密钥，正式前应换 CAM 子账号。

## 密钥清单

| 密钥 | 用在哪 | 来源 |
|---|---|---|
| `AGENT_SHARED_SECRET` | web+agent 容器（同值） | 已生成（服务器 single.env） |
| `DESIGN_AGENT_SHARED_SECRET` | web+design-agent 容器（同值） | 已生成 |
| `GROUPING_CLIP_SECRET` | agent→clip 本机回落链 | 已生成（clip.env） |
| `ARK_API_KEY` | agent(compose 成稿)+web(AI 生图)+design-agent | 用户主账号 key（待换 CAM 子账号） |
| `BETTER_AUTH_SECRET` | web | 已生成 |
| `CRON_SECRET` | web crontab | 已生成（曾泄露轮换过一次） |
| `PG_PASSWORD` | web+postgres | 已生成 |
| `R2_*` 三件套 + `S3_ENDPOINT/REGION/FORCE_PATH_STYLE` | web → 腾讯 COS | 已配好并实测（CORS/生命周期见上表） |

## 目录

```
deploy/china/
├── README.md                 # 本文件
├── compose.single.yml        # ★ 单机编排（现行唯一入口）
├── env/single.env.example    # ★ single.env 模板（web/agent/design-agent 三容器共用）
├── env/clip.env.example      # clip 容器密钥模板（CLIP worker 版 env 说明也在此）
├── build/{web,design,clip}.Dockerfile  # 三镜像构建
├── crontab.web.example       # 3 个 cron + PG 备份
├── pgssl/（服务器上生成，不进仓）       # PG 自签证书
├── compose.agent.yml         # ┐
├── compose.web.yml           # │ 三机时代遗物（82.156/152.136 已退场），仅存档；
├── compose.clip.yml          # │ 不要按它们部署
├── env/agent.env.example     # │
├── env/web.env.example       # ┘
└── wireguard/                # 组网配置模板（历史；单机方案不再需要）
```
