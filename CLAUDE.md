# Yujee(遇己) Agent 起手约束

本仓是 AI 人生纪念册应用。**线上跑的是四个部署单元,不是两个**:

```text
Browser
   |
   v
Web (Next.js, Vercel: yujee-web)
   |-- POST /v3/*  --> Agent      (FastAPI, Fly: yujee-agent)      生成主链路
   |                                  `-- 远程 CLIP (Fly: yujee-agent-clip)
   |-- POST /api/* --> Design Agent (Node,  Fly: yujee-design-agent) 对话式改书
   v
Postgres + Cloudflare R2
```

漏看 Design Agent 是本仓最常见的判断错误。它不是历史残留,是活的:
`apps/web/src/app/api/v3/albums/[uuid]/design-chat/route.ts` 每天在调它。

## 必读顺序

1. 仓根 `README.md`:系统总框架和当前工作流。
2. 做 Web 相关任务:再读 `apps/web/README.md`。
3. 做生成链路(分章/选版/成稿):再读 `engine/README.md`。
4. 做对话改书:再读 `packages/design-agent/README.md`。
5. 改跨服务字段:读 `packages/contracts/src/v3.ts` 和 `engine/src/contracts/schemas.py`。
6. 改模板:读 `packages/contracts/templates/README.md` 和对应 JSON。

## 当前重要现实

### 生成 Agent(yujee-agent)

- route surface **只有四个**:`GET /health`、`POST /v3/analyze`、`POST /v3/select-layout`、
  `POST /v3/compose`。已删除的端点:`/v3/judge-layout`、`/v3/judge-page-template`、`/v3/design`。
- 分析是**纯确定性分组**:`/v3/analyze` 走 CLIP/时间/GPS/像素,零 AI 调用、不识图;
  章标题由拍摄时间跨度确定性派生到 `V3Chapter.title`。
- 排版是**一次确定性选版**:`/v3/select-layout` 直接回调 `completed` + 完整 `pages`,
  零 AI 调用,没有候选缩略图/评委来回;文案先填模板 JSON 的 `sample` 示例文案。
- 生成链路只剩**一次** AI 调用:`/v3/compose`(按章并发的 Gemini 成稿,看真实照片 +
  读用户故事,外加一次全局封面/封尾/字体)。已设计的书追加照片后,Web 会在增量排版
  落地时自动再发一单**范围收窄**的 `/v3/compose`(空 `coverSlots`/`endingSlots`、只送
  新章;engine 侧全局批次因此直接跳过,不写封面不动字体)—— 仍是同一个端点、同一种
  AI 调用,只是多了一个触发点(`composeAppend` 服务/路由),不是第二种生成能力。
- 判断端到端能力时必须同时看 Web caller 和 `engine/src/api/routes.py`。

### 设计 Agent(yujee-design-agent)

- 提供**生成之后**的对话式改书,与上面那条生成链路完全分开:不同 base URL、不同鉴权
  变量(`DESIGN_AGENT_BASE_URL` / `DESIGN_AGENT_SHARED_SECRET`)、不同响应信封
  (直接 JSON,不是 `{ok,data}`)。客户端是 `apps/web/src/lib/agent/design-agent-client.ts`。
- 对外:`GET /health`、`POST /api/book`、`POST /api/chat`、`GET /api/albums|traces|state`。
- **必须单机运行。** 每册的 session/trace/书状态在进程内存里,Web 每轮先 `POST /api/book`
  再 `POST /api/chat`,两个请求必须命中同一台机器。`fly scale count 1`,不要开 HA,
  不要 `auto_stop_machines`。理由和部署命令写在 `packages/design-agent/fly.toml` 注释里。
- 八个写工具:`update_page_texts` / `write_page_html` / `swap_page_template` /
  `update_page_images` / `set_text_colors` / `set_text_fonts` / `move_pages` /
  `delete_page`。新增写工具时,
  `design-chat/route.ts` 的 `DESIGN_WRITE_TOOLS` 集合必须同步,否则历史回放会丢更新。

### 页面真相

- **页面真相 = HTML**:每页 draft 存完整 794×1123 HTML(`Page.html`)。锚点契约
  `data-text-key` / `data-image-slot`,图片 src 一律 `{{IMG_SRC:slotId}}` token。
- 渲染注册表的**唯一真相**是 `apps/web/src/components/album/web-registry.ts`。
  不要在 `components/album/templates/` 下再建第二套注册表(2026-07 已删过一次)。

### 照片滤镜与派生物

- `albums.photo_filter` 是全书默认 + 单张覆盖的持久化真相;显式 `null` 覆盖表示原片。
  26 个确定性 LUT 只以生成后的 17³/33³ 二进制资源随 Web 发布,`.cube` 源文件不进仓。
- 滤镜引擎只在 Browser 运行,只生成缓存/导出/上传用的派生像素;IndexedDB 原图不改写,
  Web/Agent 不做服务端滤镜处理。
- 照片规范原图(压缩派生物,长边 3400/q0.82 无滤镜 JPEG,`getCanonicalUploadBlob` 产出)
  以 R2 私有桶 `photo-originals/{albumId}/{photoId}.jpg` 为真相源,presigned PUT 上传 +
  确认落 `album_photos` 表(`status` uploaded/missing,upsert 靠 CASE 保护不倒退),
  私有读走 `r2.signGetUrl`(300s 预签名);IndexedDB 降级为缓存,原始相机文件仍不出
  浏览器。与下面按渲染版本存的 photo-snapshots 备份链路彼此独立、未受影响。
- 每张备份快照使用不可变 `photoId/renderVersion` R2 key。新分享必须在 album 行锁内确认
  页面引用照片都有精确当前版本,否则以 409 拒绝,不会生成带空图的分享。
- 改滤镜会清 PDF/封面派生元数据。封面签名/确认是 CAS:revision 绑定规范化滤镜、
  album `updatedAt` 和第 0 页状态;旧签名不能覆盖新状态。

## 验证陷阱(先读再声称通过)

- 仓根 `pnpm test` 是 `pnpm -r test`,**撞到第一个失败的包就中断**,后面的包一个都不跑。
  只跑它然后看到红,不等于只有那一处坏;看到绿也要确认 scope 覆盖了你改的包。
- `pnpm typecheck` **不含 engine**。改 Python 要单独跑 pytest。
- Web 测试单跑:`cd apps/web && pnpm test`(或 `pnpm --filter @yujee/web test`)。
- Agent 测试从仓根跑:`PYTHONPATH=engine engine/.venv/bin/python -m pytest engine/tests`。
- 本地起全流程要**三个**服务:web 3000 / agent 8001 / design-agent 8787。
  漏了第三个,design-chat 直接 502。

## 动手规则

- 先读真实文件和 `git status`;不要按记忆或旧文档下结论。
- 不恢复用户删除的文件,除非用户明确要求。
- 新增顶层目录、依赖、数据库 schema、外部 API、跨服务协议前,先说明影响面。
- 临时脚本、验证产物、trace 文件用完即删。
- 长期说明放在仓根 README、对应 app README,或靠近模块的小 README。
- 推送/PR/合并前先跑相应验证;没验证不要声称通过。

## 文档时效规则

带 `doc-scope` 尾块的文档,声明了自己描述哪些路径、校对到哪个提交。

**改动落在某份文档的 `paths` 覆盖范围内时,必须回头核对该文档,并把 `checked-at` 更新到
你这次的提交。** 文档内容确实无需改动时也要更新 `checked-at` —— 它记录的是「已核对」,
不是「已改写」。

`pnpm docs:check` 会校验这件事:覆盖路径自 `checked-at` 以来有新提交、而 `checked-at`
没跟上,就报错。它已挂进 `pnpm typecheck`。不要靠自觉,靠这个脚本。

<!-- doc-scope
paths: engine/src/api/routes.py, apps/web/src/app/api/**, packages/design-agent/src/web/**, apps/web/src/lib/agent/**, package.json, engine/fly*.toml, packages/design-agent/fly.toml
checked-at: 7a6f5508
-->
