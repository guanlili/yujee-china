# Yujee · 一夜赶出来的可演示版 — 早晨验收

> 时间紧、用户睡了、我自己干完。这份文档让你 30 秒内验收。

## 你现在看到的状态

- ✅ **架构文档**已经按"SSE → 轮询"重做(`docs/`)
- ✅ **设计稿** `apps/web/design-v1/` 已就位
- ✅ **Contracts 包** `packages/contracts/` — Agent ↔ Web 全部 zod schema
- ✅ **Agent 服务** `apps/agent/` — FastAPI + mock pipeline(不烧火山/DeepSeek)
- ✅ **Web 应用** `apps/web/` — Next.js 15 + libsql + Tailwind v4
- ✅ **端到端跑通** — 7 秒生成一本 3 页 memoir

## 验收方式 A:跑那条端到端测试

```bash
# 一行命令(在仓库根)
WEB=http://127.0.0.1:3002 ./scripts/e2e-test.sh
```

期望输出(我刚跑过):
```
▶ POST /api/v1/jobs (requestId=<uuid>)
  ↳ {"ok":true,"data":{"albumId":"…","requestId":"…"}}

▶ polling /api/v1/jobs/… …
  01s  status=RUNNING     stage=vision      progress=0
  ...
  07s  status=COMPLETED   stage=composing   progress=100

▶ GET /api/v1/albums/…
{ layout JSON 含 3 页 cover-01 / spread-01 / spread-02 ... }

✓ PASS — end-to-end OK
```

## 验收方式 B:在浏览器里点一遍

打开 **http://127.0.0.1:3002** (端口是 3002 不是 3000,因为 3000 被别的 Next 占着)

1. 首页 → 点 **Start a memoir**
2. 写一句 prompt(中文英文都行,自动判语言),拖 3–30 张照片
3. 点 **Generate my memoir** → 自动跳转到 album 页
4. 看 progress bar 走 7 秒 → 自动渲染出 layout(每页带原图缩略图)
5. 也可去 **/my-albums** 看历史

## 服务起停

我在你睡前已经把两个进程都起好了:

```bash
# 检查是否还在
lsof -i :3002 -t   # Web (Next.js dev)
lsof -i :8001 -t   # Agent (FastAPI)

# 日志
tail -f /tmp/yujee-web.log
tail -f /tmp/yujee-agent.log
```

如果挂了,重启:

```bash
# Agent
cd "apps/agent" && source .venv/bin/activate && set -a && source .env && set +a
nohup uvicorn src.main:app --host 127.0.0.1 --port 8001 > /tmp/yujee-agent.log 2>&1 &

# Web (注意要先把 PATH 切到 nvm 的 node,Codex 的 node 编译会挂)
export PATH="/Users/smalldog/.nvm/versions/node/v24.15.0/bin:$PATH"
cd "apps/web" && set -a && source .env && set +a
nohup pnpm dev > /tmp/yujee-web.log 2>&1 &
```

## 干净起步:推倒重装

```bash
# 在仓库根
export PATH="/Users/smalldog/.nvm/versions/node/v24.15.0/bin:$PATH"
pnpm install
cd apps/web
rm -f yujee-dev.db
DATABASE_URL="file:./yujee-dev.db" pnpm exec drizzle-kit push
DATABASE_URL="file:./yujee-dev.db" pnpm db:seed   # 写入 demo-user-001 + 1000 积分
pnpm dev                                            # 自动从 .env 读
```

Agent 端:
```bash
cd apps/agent
python3 -m venv .venv && source .venv/bin/activate
pip install -e .
cp .env.example .env && echo "AGENT_SHARED_SECRET=dev_secret_2026" >> .env
uvicorn src.main:app --port 8001
```

## 工程交接清单

| 我已经干完的 | 状态 |
|---|---|
| docs/* 架构(SSE → 轮询,异步 Agent) | ✅ commit 78772a3 |
| `packages/contracts/` 所有 schema | ✅ 3 commit(子 agent A 做的) |
| `apps/agent/` mock pipeline + 验收脚本 | ✅ 4 commit(子 agent B 做的) |
| `apps/web/` 三页面 + 完整 API + DB | ✅ 1 commit |
| 端到端 e2e-test.sh | ✅ 含在 web commit 里 |
| 设计稿 React 化(21 模板还原) | ❌ 没做,先 demo 用 raw JSON 渲染 |
| 真火山/DeepSeek 调用 | ❌ Agent 是 mock 模式 |
| better-auth / Stripe / Creem | ❌ 占位 + 写死 demo 用户 |
| PDF 导出 | ❌ 文档 + 协议齐了,代码占位 |
| i18n / 路由 locale | ❌ 全英文 hardcode |

## 已知遗留

1. **服务端 album-page-repo.updateOne** 在编辑器里没接路由(PATCH /albums/[uuid]/pages/[idx]),编辑页目前只读
2. **PDF 导出**整条链路没做,album 页底有"coming soon"
3. **better-auth** 用 `lib/auth/require-auth.ts` 一行返回 demo user。生产替换前注意 ERRORS.UNAUTHORIZED() 的抛出点都会失效
4. **WEB_BASE_URL** 在 `.env` 里写死 3002,因为 3000 被你机器上别的 Next dev 占了 — 部署前改回 3000 或正式域名

## 验收完了你想干的事

- 直接打开 `/my-albums` 应该已经有我刚跑测试时生成的那本(或没有,因为 db 被 ignore 了 — 那就 `/create` 自己再生成一本)
- 看 layout JSON: `apps/web/yujee-dev.db` 是单文件 SQLite,用 `sqlite3 yujee-dev.db ".tables"` / `pnpm db:studio` 都行
- 想接真火山:`apps/agent/src/services/pipeline.py` 把 mock 改实调即可,callback 协议不动

---

睡好。
