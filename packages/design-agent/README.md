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

## 十个写工具

`update_page_texts` · `write_page_html` · `swap_page_template` · `update_page_images` ·
`set_text_colors` · `set_page_background` · `apply_book_style` · `set_text_fonts` ·
`move_pages` · `delete_page`

`set_text_colors` 带对比度硬校验(2026-08-29):三色配到该页**实际底色**上(取
carrier → 模板自带深底 → 白底默认的优先级,即 `effectivePageBackground`)任何一色
低于 4.5:1 就打回,报错点名哪几页、实测比值。AI 看不见渲染结果,不拦的话用户拿到
的是一整页读不了的书;`swap_page_template` 换模板跨过明暗边界(浅底↔深底,如换到
mag-62)时会自动把该页文字 carrier 翻成对应的深字/浅字,不翻的话新底色配旧字色会
读不了(mag-62 实测约 1.3:1)。

`set_page_background`(2026-08-29 新增)刷单页或全书底色:颜色只能从当前风格的
调色板里挑(传错会打回并列出可选值,不接受自由 hex —— 会超四色印刷色域、对比度也
守不住),该页文字色按深底浅字/浅底深字自动跟着翻。只改某几页用它;整本换气质用
`apply_book_style`。

`apply_book_style`(2026-08-29 新增)整本换气质:换封面/封底版式 + 刷全书页底色和
三个文字色(四个风格 = editorial 素白散文 / magazine 杂志刊头 / dopamine 多巴胺 /
postcard 旅行画报,定义见 `packages/contracts/src/design/book-styles.ts`)。换版式会
重排封面/封尾文案,迁不过去的槽会清空,回复里必须提醒用户,动手前先确认。

`move_pages` 挪动页面:批量 move(插入)/swap(对调)重排页序,只动内页
(封面/目录/封尾钉死),单纯挪位置不改任何页内容(纯逻辑在 `page-move.ts`)。

`delete_page` 删除书页(2026-08-03 设计:`docs/specs/2026-08-03-delete-page-design.md`):
只删内页,照片随页移除不回流,拒删到内页数为 0。与 move_pages 同口径只动数组、
不改余页 pageIndex —— 落库行序由 Web 侧 `persistDesignChat` 按数组位置重编号。

新增写工具时,**必须同步** `design-chat/route.ts` 里的 `DESIGN_WRITE_TOOLS` 集合、
`apps/web/src/components/album/editor-v2/chat-history.ts` 的 `DESIGN_CHANGE_CATEGORY`
映射,否则该工具的改动不会进 `layout_patch.designOps`,或进了但撞不出类别 ——
历史回放里会丢更新、少一类彩色条。(`set_text_fonts` / `write_page_html` 就漏过一次
前者;`set_page_background` / `apply_book_style` 落地时两处都是跟工具本身同批补的。)

另有 `write_todos`:复诵式长任务计划工具(参考 deepagents TodoListMiddleware,设计:
`docs/specs/2026-08-05-write-todos-design.md`)。整表覆盖、服务端无状态、纯 no-op
不动书 —— 它**不是写工具,不进** `DESIGN_WRITE_TOOLS`,与 read_page 同类。

## 六个技能

`read_skill` 按名字取一份技能说明书的**全文**(不是工具描述里那句摘要)。技能定义
只住在 `src/core/album/skills.ts` 一处 —— 这里不重复抄内容,只记名字和数量,
避免说明书抄成两份、抄着抄着就漂了(与上面写工具/类别映射同一条纪律)。

`页面HTML编辑` · `相册文案` · `相册排版` · `相册配色` · `相册字体` · `风格理解`

`风格理解`(2026-08-29 新增,技能从五个变六个)是用户对**整本书**观感不满或提气质
诉求时用的(「太素/太花/不够活泼/想文艺点/换个感觉」),负责判断该换哪个风格,
对应的写工具是 `apply_book_style`。

## 部署:必须单机

每册的 session / trace / 书状态**在进程内存里**,而 Web 每轮先 `POST /api/book`
再 `POST /api/chat` —— 这两个请求必须命中同一台机器。Fly 的多机负载均衡会直接打断编辑。

部署由 `.github/workflows/deploy-design-agent.yml` 自动完成(main 上
`packages/design-agent/**` 或 `packages/contracts/**` 变动时触发,CI 里带 `--ha=false`)。
要手动补一次:

```bash
gh workflow run deploy-design-agent.yml --ref main
fly scale count 1 -a yujee-design-agent    # 保持 1,不要开 HA
```

**不要在本机跑 `flyctl deploy`**,这台开发机上它已经跑不通(原因见 `engine/README.md`)。

**镜像里烤着 `packages/contracts/templates`**(Dockerfile 是 `COPY . .`,运行时从磁盘读),
所以 contracts 一变它就必须重新部署 —— 这正是 workflow 的 paths 包含
`packages/contracts/**` 的原因。2026-07-25 漏了这一步:模板改动比部署晚 2 小时,
之后 6 天没再部署,导致 mag-59 槽位漂移、任何用到该模板的册子对话改书 100% 失败
(`422 book 契约不合法`)。

2026-08-02 同类事故再发(mag-33 哑槽清除后,老书 draft 还带着 body/label/title
旧文字键,装书被整本 422 拒掉)—— 与 07-25 不同,这次是**数据老、目录新**,重发
也救不回来。自那次起 `/api/book` 装书对目录漂移**宽容**:体检结果降级为响应里的
`warnings` 原样装入(页面真相是 HTML,过期键不影响渲染),只有结构性损坏才 400;
严格校验留在写工具层,AI 写错槽仍会被逐次拦下。重发在模板变更后依然必要(换模板/
写槽校验要用新目录),但目录漂移不再把任何册子锁死在设计对话外。

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
checked-at: e8217ce9
-->
