# 国内部署（deploy/china/）—— IP 起步、域名后补

> 2026-10-25 起草,同日落地为单机全家桶(历史草案曾规划两台 CVM + 东京 Fly CLIP,
> 已废弃 —— 其遗留编排/env/wireguard 文件已于 2026-10-26 清仓,历史版本在 git)。
> 本目录是**国内专属部署层**：业务代码改动走主仓
> PR（env 门控），不在此 fork。

## 机器落位（2026-10-25 已部署：单机全家桶 @ 49.232.156.221）

```
用户浏览器 ──HTTP──▶ 49.232.156.221:8080（speakup 生产同机，80/443 归 speakup 不动）
   ┌─ yujee-web-1        Next.js :8080
   ├─ yujee-design-agent-1  容器内网 :8787（对话改书，kexiangai 中转站）
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
| P2.1 engine compose→Ark（`COMPOSE_PROVIDER=ark`） | ✅ 已合入主仓（`engine/tests/test_compose_provider_ark.py`）；2026-10-28 起成稿/改书切 kexiangai 中转站（OpenAI 兼容，`ARK_BASE_URL` 指向 `https://kexiangai.com/api/v1`，成稿 `doubao-seed-2-1-turbo-260628`、改书走 design-agent 新 `openai-compat` provider + `kimi-k2.6`） |
| P2.2 web 存储 env 化（COS endpoint/path-style） | ✅ 已合入主仓；桶 CORS + `analyze-uploads/` 生命周期已配好并实测 |
| P2.3 三个 Dockerfile（web/design/clip） | ✅ 已跑通，镜像 `yujee/{web,design,clip}:china` |
| 单机五容器部署 + 34 迁移 + crontab | ✅ 2026-10-25 全部上线健康（0034 手机号 +86 前缀收敛随 2026-10-28 短信 OTP 批） |
| 端到端验收 | ◐ 合成书 e2e 已过（成稿 7.2s、回调三连达）；**真实照片成稿质量验收待做** |
| 浏览器全流程实测 | ◐ 前置已清（8080 安全组放行、COS 预检 200）；实测本身待跑 |
| 短信 OTP（阿里云，登录/注册/找回） | ✅ 代码已合（2026-10-28 批）；上线待服务器配 `SMS_DELIVERY=aliyun` 四件套（见密钥清单与「短信 OTP」节） |
| 域名 / HTTPS / 备案 / 支付 | ⬜ 未做（见「域名后补」与 plans §3.4） |

⚠️ photo-profile 的视觉模型走 settings 默认 `doubao-seed-1-6-vision-250815`，
**该名不在中转站模型列表**（2026-10-28 起 ARK_* 槽指向 kexiangai；站内模型列表
`GET /api/v1/models` 免鉴权可查）——photo-profile 现默认关着无害，开启
`AGENT_ENABLE_PHOTO_PROFILE` 前必须先按站内列表换模型。另：中转站实测吞掉
thinking 类参数（thinking / reasoning_effort 均无效），思考关不掉，成稿与改书
每轮必然先思考（pi-ai 与 engine 的解析都兼容 reasoning_content）。
`DEEPSEEK_API_KEY` 仍是 engine 启动必检项（零消费方），由 env_file 供给。

## 自动部署（2026-10-26 起：merge 即上线）

merge 到 main → CI 五门全绿 → `deploy` job 用**专用 restricted key**（ForceCommand
锁死只能跑 `bin/deploy-from-git.sh`，无 pty/转发，密钥在 GitHub Secrets）SSH 到
本机执行：`git fetch → reset --hard → compose up -d --build --wait` → **容器内
`db:migrate`**（2026-10-27 起,幂等,见脚本注释）+ 首页 200 + 巡检验证。
部署现场 `~/yujee-clip/` 已 git 化（remote = 本仓 public URL，fetch 免凭证）。

- 未跟踪的 `env/`（密钥）、`pgssl/`、**`weights/`（540MB CLIP/isnet 权重，不进
  git）**不受 reset 影响；**新机器重建时 weights 须单独传输**。
- deploy 日志：`~/yujee-clip/logs/deploy.log`（与 CI job log 双写）。
- 回滚：revert PR 走同一通道，或登服跑 `git reset --hard <旧sha> && compose up -d --build`。
- 失败兜底：`compose up` 失败时旧容器继续运行（滚动替换失败不退旧），deploy job
  红，线上仍是上一版。
- 升级路线：镜像改由 CI 构建推腾讯 TCR、服务器只 pull（生产机减负，方案见
  「TCR 镜像 CI」待办）。

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
| `ARK_API_KEY` | agent（compose 成稿 + photo-profile 视觉槽） | kexiangai 中转站 key（`sk-`+控制台 x-api-key；2026-10-28 起） |
| `DESIGN_AGENT_API_KEY` | design-agent（openai-compat provider） | 与 `ARK_API_KEY` 同值 |
| `ARK_IMAGE_API_KEY` | web AI 生图（仍直连火山 seedream，待第二批迁中转） | 火山方舟 key |
| `BETTER_AUTH_SECRET` | web | 已生成 |
| `CRON_SECRET` | web crontab | 已生成（曾泄露轮换过一次） |
| `PG_PASSWORD` | web+postgres | 已生成 |
| `R2_*` 三件套 + `S3_ENDPOINT/REGION/FORCE_PATH_STYLE` | web → 腾讯 COS | 已配好并实测（CORS/生命周期见上表） |
| `ALIYUN_SMS_ACCESS_KEY_ID/SECRET` | web 短信 OTP（RAM 子账号，只授 `dysms:SendSms`） | 待建（2026-10-28 起，见「短信 OTP」节；不复用 ARK 主账号 key） |
| `ALIYUN_SMS_SIGN_NAME` + `ALIYUN_SMS_TEMPLATE_CODE` + `SMS_DELIVERY` | web 短信 OTP（签名/模板 CODE/开关） | 具体值在生产 single.env（模板形态见 single.env.example 示例行） |

## 短信 OTP（阿里云国内短信，2026-10-28 批）

登录（密码/验证码双模式）、注册强制验证、手机号找回全部走阿里云国内短信；
代码开关 `SMS_DELIVERY=capture|aliyun`（`capture` 回落 email-capture.jsonl，
作为阿里云故障/欠费期的应急降级通道，勿长期停留）。上线前人工清单：

1. **RAM 子账号**：专用子账号 + 自定义策略只授 `dysms:SendSms`，AK/SK 进
   single.env（600）。泄露应急 = RAM 控制台禁用 AK → 换新 AK 改 env 重启 web。
2. **签名**：复用公司已有可用签名（名称见生产 single.env / 阿里云控制台）；
   若需新申请，国内站验证码签名要实名主体资质（本站尚无域名/备案，新签名
   大概率卡备案）。
3. **模板**：验证码类模板 ×1（登录/注册与找回共用），变量 `${code}`，文案
   含「5 分钟内有效」；控制台拿到 CODE 后填 `ALIYUN_SMS_TEMPLATE_CODE`。
4. **控制台流控**（应用限流之外的最后防线）：同一号码 1 条/分钟、5 条/小时、
   10 条/天；应用侧另有同号 60s + 同 IP 3 次/分钟（send-otp）与 3 次/小时（找回）。
5. **余额告警**：阿里云费用中心设余额预警 —— 欠费即停发且接口层看不出
   （`isv.AMOUNT_NOT_ENOUGH` 只在日志里 error），必须告警兜底。
6. **切换步骤**：single.env 填四件套 + `SMS_DELIVERY=aliyun` → `compose up -d`
   （web 重启）；env.ts 会在漏配时启动即炸（fail-fast），真机冒烟一条验证码。
7. **对账**：web 日志 `sms.send.ok {scene, 脱敏手机号, bizId}` ↔ 阿里云控制台
   「发送记录」按 BizId/手机号/时间检索；日志任何模式都不落验证码明文。

## 目录

```
deploy/china/
├── README.md                 # 本文件
├── compose.single.yml        # ★ 单机编排（现行唯一入口）
├── env/single.env.example    # ★ single.env 模板（web/agent/design-agent 三容器共用）
├── env/clip.env.example      # clip 容器密钥模板（CLIP worker 版 env 说明也在此）
├── build/{web,design,clip}.Dockerfile  # 三镜像构建
├── bin/renew-pg-cert.sh      # PG 自签证书 ≤30 天零停机自续(cron 每日)
├── bin/daily-patrol.sh       # 每日只读巡检:容器/内存/error 计数/磁盘(cron 05:10)
├── crontab.web.example       # 6 个 cron + PG 备份
└── pgssl/（服务器上生成，不进仓）       # PG 自签证书
```
