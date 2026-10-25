# 国内部署（deploy/china/）—— IP 起步、域名后补

> 2026-10-25 起草。两台腾讯 CVM 起步，CLIP 复用东京 Fly worker（实测跨境稳定）。
> 本目录是**国内专属部署层**：业务代码改动走主仓 PR（env 门控），不在此 fork。

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

## 启动顺序（重要：P2 代码改造是前置依赖）

| 步骤 | 依赖 | 状态 |
|---|---|---|
| 0. WireGuard 两机组网 + 安防组收紧 | 无 | ⬜ |
| 1. **P2.1 engine compose→Ark 改造**（`COMPOSE_PROVIDER=ark`） | 主仓 PR | ⬜ 未做，不做则 agent 启动都过不了（`SELECT_LAYOUT_API_KEY` fail-fast）或成稿全是模板占位文案 |
| 2. **P2.2 web 存储 env 化**（`r2-client.ts` 支持 COS endpoint/path-style） | 主仓 PR + COS 桶 | ⬜ 未做，不做则照片无处直传、建书走不通 |
| 3. **P2.3 web Dockerfile**（`deploy/china/build/web.Dockerfile`） | 无 | 草稿已放本目录，待跑通 |
| 4. agent机：`docker compose -f compose.agent.yml up -d` | 1 + Ark key + CLIP secret | ⬜ |
| 5. web机：`docker compose -f compose.web.yml up -d` + crontab | 2/3 + 密钥 | ⬜ |
| 6. 端到端验收（见 docs/plans/2026-10-25-china-deployment-plan.md §5） | 全部 | ⬜ |

## 域名后补（一次性动作，配置已参数化）

1. `web.env` 里 `WEB_BASE_URL` 换域名；engine 侧 callbackUrl 由 web 请求自动携带，无需改。
2. web机加 nginx + certbot（`-p 80:3000` 改为 nginx 443 反代容器）。
3. 硬编码域名清单见 plans 文档 §3.4（`lib/seo/site.ts` SITE_URL 等 5 处 + OAuth 回调注册）。
4. WireGuard 保留不动（机器间内网长期用它）。

## 安全基线

- **安全组**：web机只开 22/80/51820(udp，仅对端 IP)；agent机只开 22/51820(udp，仅 web机 IP)——8001 不进公网安全组。
- 所有 `待生成` 密钥用 `openssl rand -base64 32` 现生成，不使用海外现值（`GROUPING_CLIP_SECRET` 除外，必须与东京 worker 同值）。
- IP 阶段浏览器→web 为明文 HTTP：**仅限内部测试账号，禁止真实用户**（密码明文过网）。

## 密钥清单

| 密钥 | 用在哪 | 来源 |
|---|---|---|
| `AGENT_SHARED_SECRET` | web机+agent机+CLIP 容器（同值） | 新生成 |
| `DESIGN_AGENT_SHARED_SECRET` | web机+design-agent（同值） | 新生成 |
| `GROUPING_CLIP_SECRET` | agent机→本机 CLIP | **已生成**（在 49.232 `~/yujee-clip/deploy/china/env/clip.env`；agent 落位时复用同值） |
| `ARK_API_KEY` | agent机(compose)+web机(生图)+design-agent | 用户新建 |
| `BETTER_AUTH_SECRET` | web机 | 新生成 |
| `CRON_SECRET` | web机 crontab | 新生成 |
| `DATABASE_URL` 密码 | web机 PG | 新生成 |
| COS 三件套 | web机 | 开桶后填 |

## 目录

```
deploy/china/
├── README.md                 # 本文件
├── compose.agent.yml         # agent机（48）
├── compose.web.yml           # web机（117）
├── env/agent.env.example     # agent机环境变量
├── env/web.env.example       # web机环境变量
├── build/web.Dockerfile      # web 镜像（P2.3 草稿，standalone 优化后移主仓）
├── wireguard/                # 两机组网配置模板 + 步骤
└── crontab.web.example       # 3 个 cron + PG 备份
```
