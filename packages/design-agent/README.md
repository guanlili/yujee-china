# @smalldog/design-agent

**生成之后**的对话式改书 Agent。用户在编辑器里说「把第 3 页标题改小一点」,走的是这里,
不是 `engine/` 那条生成链路。两者是不同服务、不同鉴权、不同响应信封 —— 别混。

## 在系统里的位置

```text
编辑器 → Web /api/v3/albums/[uuid]/design-chat → 本服务 (Fly: yujee-design-agent, :8787)
```

Web 侧客户端:`apps/web/src/lib/agent/design-agent-client.ts`。
响应是**直接 JSON**(不是 Web 内部那套 `{ok,data}` 信封),书状态随响应带回。

## 对外 surface

`src/web/album-server.ts`:

| Endpoint | Purpose |
|---|---|
| `GET /health` | 健康检查 |
| `POST /api/book` | 装载某册的书状态(每轮对话前调) |
| `POST /api/chat` | 一轮对话;`?stream=1` 走 NDJSON 事件流 |
| `GET /api/albums` · `/api/traces` · `/api/state` | 调试/观测 |

## 六个写工具

`update_page_texts` · `write_page_html` · `swap_page_template` · `update_page_images` ·
`set_text_colors` · `set_text_fonts`

新增写工具时,**必须同步** `design-chat/route.ts` 里的 `DESIGN_WRITE_TOOLS` 集合,
否则该工具的改动不会进 `layout_patch.designOps`,历史回放里会丢更新、彩色条少报。
(`set_text_fonts` / `write_page_html` 就漏过一次。)

## 部署:必须单机

每册的 session / trace / 书状态**在进程内存里**,而 Web 每轮先 `POST /api/book`
再 `POST /api/chat` —— 这两个请求必须命中同一台机器。Fly 的多机负载均衡会直接打断编辑。

```bash
fly deploy -c packages/design-agent/fly.toml \
  --dockerfile packages/design-agent/Dockerfile --ha=false .
fly scale count 1 -a yujee-design-agent    # 保持 1,不要开 HA
```

`auto_stop_machines = false`(停机会丢正在进行的会话)。完整理由写在 `fly.toml` 注释里。

密钥不入库,out-of-band 设置:

```bash
fly secrets set ARK_API_KEY=... DESIGN_AGENT_SHARED_SECRET=... -a yujee-design-agent
```

## 本地

```bash
pnpm design:album   # :8787 —— 生产同款 album-server;起 web/agent 时漏了它,design-chat 直接 502
```

`design:dev` 只启动 `src/web/server.ts` 的精简调试 surface,没有 `/health`、`/api/book`
或 `/api/albums`,不能替代完整产品链路使用的 `design:album`。

## 代码边界

本包放产品特有的设计行为:system prompt、design tools、resources、runtime/session policy、
print/RPC/interactive 三种模式。**通用 agent loop 在 `packages/agent`**,除非设计 Agent
需要一个通用能力,否则不要改它。

<!-- doc-scope
paths: packages/design-agent/src/**, packages/design-agent/fly.toml, apps/web/src/lib/agent/design-agent-client.ts
checked-at: 7f8d657c
-->
