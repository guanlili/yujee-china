# 国内部署（deploy/china/）—— 正式入口 https://outman.press

> 2026-10-25 起草,同日落地为单机全家桶(历史草案曾规划两台 CVM + 东京 Fly CLIP,
> 已废弃 —— 其遗留编排/env/wireguard 文件已于 2026-10-26 清仓,历史版本在 git)。
> 本目录是**国内专属部署层**：业务代码改动走主仓
> PR（env 门控），不在此 fork。
>
> **正式用户入口（2026-10-28 起）**：仅 **`https://outman.press`**（备案号
> **京ICP备2022033467号-4**，主体展示 **李梨🍐个人主体**（个人域名备案））。
> **禁止**对真实用户宣传或依赖明文 **`http://49.232.156.221:8080`** —— 该口仅
> 供本机 nginx 反代与运维内测；公网 8080 在 merge + DevOps 收口后应关闭（见下）。

## 机器落位（2026-10-25 已部署：单机全家桶 @ 49.232.156.221）

```
用户浏览器 ──HTTPS──▶ outman.press:443（SpeakUp frontend 容器 nginx，SNI 选证书）
        │                      │
        │                      └── proxy_pass host.docker.internal:8080 → yujee-web
        └── HTTP :80 ──301──▶ https://outman.press（运维须保证 301 正常，勿留 500）

内网/运维（非公网入口）：49.232.156.221:8080 → yujee-web-1（Next.js 容器 :8080）
   ┌─ yujee-design-agent-1  容器内网 :8787（对话改书，kexiangai 中转站）
   ├─ yujee-agent-1      容器内网 :8001（生成主链路；调试口 127.0.0.1:8002）
   ├─ yujee-clip-1       CLIP+isnet（调试口 127.0.0.1:8001）
   ├─ yujee-postgres-1   PG16 + 自签 TLS（web 的 db 客户端对非 localhost 强制 ssl require）
   └─ root crontab        3 个 cron + PG 每日备份（4 行已装）
编排：compose.single.yml（五服务同一网络，agent→clip / web→agent 全走容器名）
```

SpeakUp 仍占同机 **80/443**；遇己 HTTPS 通过 **english-speaking-assessment** 仓库已入库的
`nginx-extra/outman.press.conf`（证书存在时 entrypoint 启用）反代到 **8080**，**不改
SpeakUp 业务代码**。conf 维护在 SpeakUp 仓，本 PR 只文档化 coexistence。

部署记录（2026-10-25）：五服务全部上线健康；33 个 drizzle 迁移已跑；三个镜像
yujee/{clip:2.73GB, web:2.38GB, design:750MB}；实测内存 ~0.5G 常驻（CLIP 惰性
加载，embedding 时 +1G）；speakup 全程无影响（无 OOM、无重启，其 10:45 的容器
重建是它自己的 CI 部署）。**历史 IP 入口** `http://49.232.156.221:8080` 仅测试期使用；
正式收口后不对真实用户开放。部署现场 `~/yujee-clip/`，密钥 `deploy/china/env/{clip,single}.env`。

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
| 域名 / HTTPS / 备案 / 支付 | ◐ **outman.press** 已备案（京ICP备2022033467号-4 / 李梨🍐个人主体）；HTTPS 反代已入库 SpeakUp nginx；应用侧 SITE_URL/页脚/WEB_BASE_URL 示例本 PR；生产 `single.env` + 关公网 8080 = **DevOps merge 后** |

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

## HTTPS 正式入口与 DevOps 收口（merge 后，本 PR 不改云控制台）

应用仓（本 PR）已做：

| 项 | 说明 |
|---|---|
| 页脚 | 全站 chrome 展示 **京ICP备2022033467号-4**，链 [beian.miit.gov.cn](https://beian.miit.gov.cn) |
| SEO | `lib/seo/site.ts` → `https://outman.press`（sitemap / canonical / OG / JSON-LD） |
| Auth | `WEB_BASE_URL` 驱动 better-auth `baseURL`；`buildTrustedOrigins()` 含 apex + `www` |
| 示例 env | `single.env.example` 中 `WEB_BASE_URL=https://outman.press`（无尾斜杠） |

**DevOps / 运维（merge + 李梨🍐确认 deploy 后执行，勿在 PR 中声称已完成）：**

| 步骤 | 动作 |
|---|---|
| B0 | [工信部 beian.miit.gov.cn](https://beian.miit.gov.cn) 再核备案号与 **李梨🍐个人主体** |
| 证书 | 核对 SpeakUp `./ssl/outman.press/` 链路与续期；必要时补签 |
| nginx | 备份 conf/ssl → 确认 `outman.press.conf` 已启用 → `nginx -t` → reload **仅 frontend** |
| HTTP→HTTPS | 修 `http://outman.press` 301（曾见 500）；www 策略与 conf 一致 |
| 应用 env | 生产 `~/yujee-clip/deploy/china/env/single.env`：`WEB_BASE_URL=https://outman.press` → `compose up -d` 重启 web（**密钥不入仓**） |
| COS CORS | 控制台 Origin 增加 `https://outman.press`（及 `https://www.outman.press` 若使用） |
| 安全组 | **关闭公网 8080**；保留 22 + 80/443；8080 仅本机反代可达 |
| 冒烟 A1–A8 | HTTPS 首页/登录/成书路径各 1 轮；SpeakUp 原域名无回归；页脚可见备案号 |
| 回滚演练 | 移走 outman 证书或 conf → SpeakUp 仍正常、遇己 HTTPS 下线（见下） |

**应用 env 回滚**：`single.env` 中 `WEB_BASE_URL` 改回上一值（或临时 IP 内测）→ `compose up -d` 重启 web；nginx/证书按 SpeakUp 仓备份恢复。**DNS 默认不回滚**。

勿混淆 **`outman.vip`**（浙ICP备20004006号-1，不同域名）。

## 域名与 WEB_BASE_URL（一次性动作，配置已参数化）

1. 生产 `single.env` 里 `WEB_BASE_URL=https://outman.press`（无尾斜杠）；engine 侧 callbackUrl 由 web 请求自动携带，无需改。
2. better-auth 读 `WEB_BASE_URL` 作 `baseURL`；HTTPS 下 Set-Cookie 应带 **Secure**（验证登录一轮）。
3. `trustedOrigins`：`buildTrustedOrigins(WEB_BASE_URL)` = localhost 列表 + 生产 apex/www + Apple。
4. 硬编码域名清单见 plans §3.4（`lib/seo/site.ts` SITE_URL、`next.config.mjs` www 308 等）；书页模板 `mag-20` 仍印旧域，换品牌另开模板流程。

## 安全基线（单机 49.232 现实）

- **安全组（目标态）**：22 + 80/443；**公网 8080 关闭**（仅本机 nginx→8080）。80/443 与同机 speakup 共用，改 nginx 前先备份。
- 与 speakup 的隔离：独立 compose 项目（name: yujee）、全部容器 mem/cpus 限额、
  yujee-web 只监听 8080（不经公网暴露）。
- 所有 `待生成` 密钥用 `openssl rand -base64 32` 现生成。
- **正式用户仅走 HTTPS 域名**；明文 IP:8080 禁止对真实用户开放。
- 遗留：ARK key 仍是主账号密钥，正式前应换 CAM 子账号。

## 密钥清单

| 密钥 | 用在哪 | 来源 |
|---|---|---|
| `AGENT_SHARED_SECRET` | web+agent 容器（同值） | 已生成（服务器 single.env） |
| `DESIGN_AGENT_SHARED_SECRET` | web+design-agent 容器（同值） | 已生成 |
| `GROUPING_CLIP_SECRET` | agent→clip 本机回落链 | 已生成（clip.env） |
| `ARK_API_KEY` | agent（compose 成稿 + photo-profile 视觉槽） | kexiangai 中转站 key（`sk-`+控制台 x-api-key；2026-10-28 起） |
| `DESIGN_AGENT_API_KEY` | design-agent（openai-compat provider） | 与 `ARK_API_KEY` 同值 |
| `ARK_IMAGE_API_KEY` | web AI 生图（ark 直连火山；2026-10-28 决策暂不迁中转，kexiang provider 已合入备用） | 火山方舟 key |
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
