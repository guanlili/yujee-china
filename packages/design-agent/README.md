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

## 十三个写工具

`update_page_texts` · `write_page_html` · `swap_page_template` · `update_page_images` ·
`set_image_pos` · `set_text_colors` · `set_page_background` · `apply_book_style` ·
`set_text_fonts` · `move_pages` · `delete_page` · `set_photo_filter` · `set_photo_cutout`

**后两个是条件注册的**:`set_photo_filter` / `set_photo_cutout` 写的是
`albums.photo_filter` 列(走 `settingsRevision` 那套 OCC),不是页面 draft ——
它们不调 `commitWrite`,而是走 `AlbumToolsOptions.applyPhotoFilter` 这个注入的 seam。
**seam 没注入就不注册**:宁可没这个能力,也不能让模型调一个写不进去的工具、还在
回复里跟用户说改好了。同理,兜底读工具 `look_at_photos` 由 `lookAtPhotos` seam 决定。

### 照片三件套的接线(2026-09-09)

**滤镜/抠图走「响应带回」,不开跨服务回调** —— 沿用本服务的既有约定:agent 不直接
写库,写入后的书由响应带回,调用方负责持久化。具体:

- 装书(`POST /api/book`)时 web 多推三样:`book.photoFilter`(全书调色现状)、
  顶层的 `hasPublishedShare`(这本书发布过分享没有)、`viewablePhotoIds`
  (有 R2 原图可看的照片)。后两样走顶层不进 `book` —— 它们是相册属性,掺进书契约
  会污染 `parseAlbumBookInput`。
- `applyPhotoFilter` seam 是**本地**的(`src/web/album-photo-seams.ts`):合进内存
  的书(同一轮 `read_page` 要立刻读得到)+ 累计 patch;书已分享时返回一条固定
  warning 进工具 `notes`。
- `POST /api/chat` 响应带回 `photoFilter`(最终状态)和 `photoFilterPatch`(累计
  patch)。**web 落库要用的是后者**。

⚠️ **落库必须用累计 patch,不能拿最终状态反推**:最终状态里 `cutouts` 只有 `true`,
「这张关掉了」表现为键不存在,而 patch 里键不存在的语义是「没提到,别动」——
反推会让关抠图永远落不了库。

⚠️ 分享 warning **不精确到 photoId**:要算「哪几张的 renderVersion 变了」就得在
agent 侧镜像 web 的 `effectiveRenderVersion`,白多一个漂移面。精确判定留在 web 的
`shareMismatchWarnings`(那边拿得到备份集合)。

**`look_at_photos` 按需取图**:POST 到 web 的 `/api/v3/internal/photo-bytes`,鉴权
与 `job-progress` / `agent-data` / `photo-profiles` 同款(`AGENT_SHARED_SECRET` 的
Bearer)。请求体只送 `albumId` + `photoIds`,**不送 R2 key** —— key 由 web 从
`(albumId, photoId)` 推导并用 `album_photos` 校验归属,否则那把 secret 就成了整桶
任意对象的读取钥匙。不发签名 URL:`ImageContent` 只收 base64,图终究要经过本进程,
何况 `signGetUrl` 默认 300s 比一轮对话短。

需要两个环境变量才通(缺一样 `look_at_photos` 就不注册):

```bash
fly secrets set WEB_BASE_URL=https://<web> AGENT_SHARED_SECRET=... -a yujee-design-agent
```


`set_text_colors` 带对比度硬校验(2026-08-29):三色配到该页**实际底色**上(取
carrier → 模板自带深底 → 白底默认的优先级,即 `effectivePageBackground`)任何一色
低于 4.5:1 就打回,报错点名哪几页、实测比值。AI 看不见渲染结果,不拦的话用户拿到
的是一整页读不了的书。打回时给的建议按「这本书里到底有没有一个字色能过全书」分流:
有就只报真能用的那个;没有(多巴胺每页底色不同 —— 淡黄配浅字 1.05、橙配深字 3.46,
没有哪个 hex 能同时过)就明说统一刷一个字色做不到,并指向 `apply_book_style` /
`set_page_background` 这两条走得通的路。判据是「有没有可用色」而不是「底色统不统一」
—— 底色不统一但全是浅底的书,深字每页都过得了,一刀切拒绝会误伤。
`swap_page_template` 换模板跨过明暗边界(浅底↔深底,如换到 mag-62)时会自动把该页
文字 carrier 翻成对应的深字/浅字,不翻的话新底色配旧字色会读不了(mag-62 实测约 1.3:1)。

`set_page_background`(2026-08-29 新增)刷单页或全书底色:颜色只能从当前风格的
调色板里挑(传错会打回并列出可选值,不接受自由 hex —— 会超四色印刷色域、对比度也
守不住),该页文字色按深底浅字/浅底深字自动跟着翻。只改某几页用它;整本换气质用
`apply_book_style`。

底色和**页根字色**是成对写的(2026-08-29 评审):写底色的地方一并按 `bestInkFor(底色)`
写页根 `color`,收在 carrier 一处(`contracts/render/page-background.ts`),四个会重烘
页面的写工具一次全都受益。只写底色不写字色的话,**不带 carrier** 的静态装饰(mag-10 的
1/2/3/4 序号走 `color:currentColor`)会黑压深底 —— 多巴胺的橙/绿/蓝底上实测
3.41/3.36/3.22,全在 4.5 线下。

`apply_book_style`(2026-08-29 新增)整本换气质:换封面/封底版式 + 刷全书页底色和
三个文字色(四个风格 = editorial 素白散文 / magazine 杂志刊头 / dopamine 多巴胺 /
postcard 旅行画报,定义见 `packages/contracts/src/design/book-styles.ts`)。换版式会
重排封面/封尾文案,迁不过去的槽会清空,回复里必须提醒用户,动手前先确认。

`set_image_pos`(2026-09-09 新增)调整照片在框里的位置和缩放。**几何归代码,模型只
表达意图**:优先传 `fit`(`center-subject` / `avoid-face-crop` / `fill`),坐标由
`image-fit.ts` 的 `resolveImagePos` 拿照片档案的 `subjectBox` / `faceBoxes` 算出来 ——
LLM 心算坐标必错,而且错得没规律、测不出来。手动 `x/y/scale` 只在用户明确说了方向
时才用(x/y 是 0-100 百分比,与 `objectPosition` 同口径;scale 1-2)。

⚠️ 两条容易踩的:① `object-position` / `transform` 是**烘进 `page.html` 的**
(fill-template 的 `IMG_POS` / `IMG_TF` token),所以写 `imagePos` 必须同步
`patchHtmlImagePos` 槽位级 patch —— 只改数据不改 html,画板上照片纹丝不动;整页重烘
则会冲掉 `write_page_html` 的手工版面。② `fit` 是**近似解**:精确把主体推到容器正中
需要「照片宽高比 / 槽位宽高比」,而槽位宽高比在 catalog 和模板 JSON 里都没有(只在
HTML 模板的 CSS 里),所以取「object-position = 主体中心」,保证主体落在可见区内。
这不是 bug。③ rotate 本批明确不动:schema 不收它,旋转过的槽直接拒绝(它的 html 是
盒交换几何,按无旋转分支 patch 会毁掉旋转)。

`set_photo_filter` / `set_photo_cutout`(2026-09-09 新增)整本定调与逐张抠图。
滤镜真相源是 `apps/web/src/lib/photo/filter-state.ts`;design-agent 是 `packages/**`
里的库,够不着 `apps/web`,所以 `photo-filter.ts` 是一份本地镜像,由
`album-photo-filter-tools.test.ts` 的守卫直接读真相源比对 LUT 清单防漂移。
**契约铁律:`cutouts` 只认 `true`,关掉是删键(patch 里写 `null`),绝不写 `false`** ——
允许 `false` 会让「没抠」有两种表示,renderVersion 和派生缓存 key 立刻产生歧义。
`strength` 一律过 `quantizeStrength`(5 的倍数),与 web 同一归一化,否则两边算出的
renderVersion 对不齐、分享快照直接失配。

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

## 七个技能

`read_skill` 按名字取一份技能说明书的**全文**(不是工具描述里那句摘要)。这里不重复
抄内容,只记名字和数量,避免说明书抄成三份、抄着抄着就漂了(与上面写工具/类别映射
同一条纪律)。

技能定义有**两份**,改一份必须同步另一份:生产加载的是文件版
`packages/contracts/skills/<name>/SKILL.md`(见 `skills-loader.ts`,engine/agent 共用
一份,可用 `YUJEE_DESIGN_SKILLS_DIR` 覆盖);`src/core/album/skills.ts` 是**目录缺失
或为空时的内置兜底**。两份的实质内容由 `album-style-skill.test.ts` /
`album-skills-theme.test.ts` 钉着,不许各说各话。

`页面HTML编辑` · `相册文案` · `相册排版` · `相册配色` · `相册字体` · `风格理解` ·
`照片处理`

`照片处理`(2026-09-09 新增,技能从六个变七个)收口调色/构图裁切/抠图三件事的策略:
先读 `read_page` 每个图槽的 `profile`(照片视觉档案),`look_at_photos` 是兜底不是默认
输入(一次最多 6 张);构图用 `fit` 意图别自己算坐标;抠图逐张开,不做整本默认全抠。

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
checked-at: 70d38c4e
-->
