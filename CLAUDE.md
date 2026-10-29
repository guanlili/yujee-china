# Yujee(遇己) Agent 起手约束

> ## 🇨🇳 国内版现状（本仓 = guanlili/yujee-china，2026-10-25 起生效）
>
> 本仓是海外项目的国内独立演进分支。**下面正文里的 Vercel/Fly/Gemini/R2 描述是海外历史架构,仅作理解原始设计用**;国内现实以本段与 [`deploy/china/README.md`](deploy/china/README.md) 为准:
>
> - **部署 = 单机 docker 全家桶** @ 49.232.156.221（`~/yujee-clip/`,五容器:web :8080 入口 / design-agent / agent / clip / postgres,同 compose 网络,同机另有英语测评生产 speakup 不可干扰;编排 `deploy/china/compose.single.yml`）
> - **provider 已换 kexiangai 中转站**(2026-10-28,OpenAI 兼容 `https://kexiangai.com/api/v1`,key=`sk-`+控制台 x-api-key,模型列表 `GET /api/v1/models` 免鉴权):compose 成稿 = `doubao-seed-2-1-turbo-260628`(engine 的 ARK_* 槽整体指向中转,含 photo-profile);design-agent = `kimi-k2.6`(models.ts 的 `openai-compat` provider,实测 1.9s/轮;deepseek-v4-pro 为备用)。**thinking 参数按模型分**:doubao 系透传 engine 默认的 thinking:disabled(成稿 4~6s 零思考),deepseek 系无视(永远思考);engine 与 pi-ai 的解析都兼容 reasoning_content。web AI 生图仍走火山 seedream(2026-10-28 决策:`IMAGE_PROVIDER=ark` + 独立 `ARK_IMAGE_API_KEY`,火山账号因生图保留);中转站 provider 已合入备用(imagegen/kexiang.ts:异步任务 API asyncCreateWithCost+passAuth 轮询,x-api-key 原始 key,2K=0.2 元/张,比例写进 prompt —— 充值积分后改一行 env 即可切换,届时火山可退场)。seed 系原生多模态已实测真透传;deepseek-v4-pro 是假多模态(收图不报错全靠幻觉)。对象存储 = 腾讯 COS(S3_ENDPOINT 覆盖分支)。
> - **CI 四门全绿**(`.github/workflows/ci.yml`:typecheck 含 docs/sitemap/templates 三闸 / engine pytest 538 / web 需先 design:build+PG service / packages)。改代码必推 CI,红了先修。基线回滚点 tag:`china-baseline-20261025`。
> - **密钥全部在服务器** `~/yujee-clip/deploy/china/env/{single,clip}.env`(600,不进仓);ARK key 未换子账号、邮件仍 capture 模式(注册激活须从 web 容器 `/app/apps/web/.tmp/email-capture.jsonl` 捞验证链接)。
> - **部署姿势**:rsync 必须 `--relative` 从仓根(尾斜杠=内容平铺,已踩两次);远端长任务一律 nohup;SSH 会随机断,操作要幂等。浏览器侧 HTTP+IP 阶段靠根布局的 crypto.randomUUID polyfill(安全上下文限制),上 HTTPS 后自动让位。
> - 域名/备案/支付/手机号登录未做,见 `docs/plans/2026-10-25-china-deployment-plan.md` 与记忆。

本仓是 AI 人生纪念册应用。**海外历史架构是四个部署单元,不是两个**:

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

- route surface = **四个对外 + 两个 internal**。对外:`GET /health`、`POST /v3/analyze`、
  `POST /v3/select-layout`、`POST /v3/compose`。internal(只在 2GB CLIP worker 上开,
  普通 1GB Agent 的开关关着 => 404):`POST /internal/open-clip/embeddings`、
  `POST /internal/photo-profile`。已删除的端点:`/v3/judge-layout`、
  `/v3/judge-page-template`、`/v3/design`。
  `/internal/photo-profile` 有两个调用方:Agent 的 analyze 建档(见下条开关),和 **Web 直连**
  CLIP worker 取抠图 mask(`AGENT_CLIP_BASE_URL`,不是 `AGENT_BASE_URL` 那台)。
  (已销账)`/internal/agent-ack` 的「生产有、源码没有」漂移,随 2026-10-25 国内
  单机从源码全量重部自然消失;2026-10-26 用生产 OpenAPI 核验,运行路由 == 本表。
- 分析是**纯确定性分组**:`/v3/analyze` 走 CLIP/时间/GPS/像素,零 AI 调用、不识图;
  章标题由拍摄时间跨度确定性派生到 `V3Chapter.title`。前提是建档开关
  `AGENT_ENABLE_PHOTO_PROFILE` **默认关**:开了 analyze 就会经 `/internal/photo-profile`
  每本书多出 N 次视觉模型调用,「零 AI」不再成立,开之前先算成本。
- 排版是**一次确定性选版**:`/v3/select-layout` 直接回调 `completed` + 完整 `pages`,
  零 AI 调用,没有候选缩略图/评委来回;文案先填模板 JSON 的 `sample` 示例文案。
- 生成链路只剩**一次** AI 调用:`/v3/compose`(按章并发的 Gemini 成稿,看真实照片 +
  读用户故事,外加一次全局封面/封尾/字体)。已设计的书追加照片后,Web 会在增量排版
  落地时自动再发一单**范围收窄**的 `/v3/compose`(空 `coverSlots`/`endingSlots`、只送
  新章;engine 侧全局批次因此直接跳过,不写封面不动字体)—— 仍是同一个端点、同一种
  AI 调用,只是多了一个触发点(`composeAppend` 服务/路由),不是第二种生成能力。
- 以上说的都是**生成链路**。产品里另有一处 AI 调用:编辑器里的 **AI 生图**
  (`POST /api/v1/albums/[uuid]/generate-image`),按用户描述出一张图填进图槽,
  产出当作一张普通照片存(photoId → R2 → `album_photos`),因此导出/分享/备份
  零改动。生产 provider 是 Gemini、本地是火山 Ark,靠 `IMAGE_PROVIDER` 切。
  它与 Agent、Design Agent 都无关,别把它算进生成链路的调用计数。
- 判断端到端能力时必须同时看 Web caller 和 `engine/src/api/routes.py`。

### 设计 Agent(yujee-design-agent)

- 提供**生成之后**的对话式改书,与上面那条生成链路完全分开:不同 base URL、不同鉴权
  变量(`DESIGN_AGENT_BASE_URL` / `DESIGN_AGENT_SHARED_SECRET`)、不同响应信封
  (直接 JSON,不是 `{ok,data}`)。客户端是 `apps/web/src/lib/agent/design-agent-client.ts`。
- 对外:`GET /health`、`POST /api/book`、`POST /api/chat`、`GET /api/albums|traces|state`。
- **必须单机运行。** 每册的 session/trace/书状态在进程内存里,Web 每轮先 `POST /api/book`
  再 `POST /api/chat`,两个请求必须命中同一台机器;compose 里就一个 design-agent 容器,
  不要扩副本。理由见 `packages/design-agent/README.md`「部署:必须单机」。
- 十三个写工具:`update_page_texts` / `write_page_html` / `swap_page_template` /
  `update_page_images` / `set_image_pos` / `set_text_colors` / `set_page_background` /
  `apply_book_style` / `set_text_fonts` / `move_pages` / `delete_page` /
  `set_photo_filter` / `set_photo_cutout`(最后三个是 2026-09-09 照片视觉档案那批加的:
  构图裁切 / 整本调色 / 逐张抠图)。新增写工具时,
  `design-chat/route.ts` 的 `DESIGN_WRITE_TOOLS` 集合、
  `editor-v2/chat-history.ts` 的 `DESIGN_CHANGE_CATEGORY` 映射都必须同步,
  否则历史回放会丢更新/少一类彩色条。
- **后两个写工具与兜底读工具 `look_at_photos` 是条件注册的**(seam 没注入就不注册 ——
  宁可没这个能力,也不能让模型调一个写不进去/看不到图的工具)。滤镜/抠图写的是
  `albums.photo_filter` 列(走 `settingsRevision`,不是页面 draft 的 version);
  `applyPhotoFilter` seam 是 design-agent **本地**的:只合进内存书并累计 patch,由
  `/api/chat` 响应的 `photoFilterPatch` 带回,web 的 `persistDesignChat` 带装书时取的
  设置基线调 `applyAgentPhotoFilter` 落库 —— agent 不写库,且落不落看 patch 非空,
  **与 `committed` 无关**(只调色的一轮 committed 是 false)。看真图的 `lookAtPhotos`
  要 design-agent 配齐 `WEB_BASE_URL` + `AGENT_SHARED_SECRET`,回拉 web 的
  `POST /api/v3/internal/photo-bytes`;缺一个就不注册。实际注册了哪些看 `GET /api/state`
  的 `toolNames`。

### 页面真相

- **页面真相 = HTML**:每页 draft 存完整 794×1123 HTML(`Page.html`)。锚点契约
  `data-text-key` / `data-image-slot`,图片 src 一律 `{{IMG_SRC:slotId}}` token。
- 渲染注册表的**唯一真相**是 `apps/web/src/components/album/web-registry.ts`。
  不要在 `components/album/templates/` 下再建第二套注册表(2026-07 已删过一次)。

### 协同编辑(2026-09 移植自黑客松站)

- **授权只有两个 seam,别再逐点手写归属判断**:`collaborationService.requireAccess`
  (owner|editor 都是 Creator —— 改内容/结构/设置、传照片、跑 AI、导出、建分享)与
  `requireOwner`(治理:管成员、删相册、转所有权)。库里曾有 16 处硬写
  `album.userId !== userId`,逐点改必漏,漏一个就是越权。
- **写路径一律在 `albumRepo.findByIdForUpdate` 行锁内用 `resolveRole`**,不用无锁的
  `requireAccess` —— 否则有 TOCTOU 窗口。读路径才用 `requireAccess`。
- 能力模型的唯一真相是 `apps/web/src/lib/collaboration/capabilities.ts`,**前后端共用
  同一份纯函数**。前端显隐只是体验,每条能力后端都有锁内检查兜底。
- 三种 OCC 各管各的版本列,**刻意不复用**:页面 `draft_pages.version`(baseVersion +
  `updateOneIfVersion` 双防线)、结构 `albums.draft_structure_revision`(整批/结构写点,
  见 `bumpDraftRevision({structural:true})`)、设置 `albums.settings_revision`
  (title/背景/滤镜)。拿错版本号只会让对应写点误判冲突。
- 新增整批替换页面的写点(`draftPageRepo.replaceAll`)时,**必须**配 structural 的
  `bumpDraftRevision`,否则协作者的增量同步会收到错误增量而不是整书重载。
  `collaboration-service.test.ts` 的写点清单守卫会拦。
- 基线字段(`baseVersion`/`baseStructureRevision`/`baseSettingsRevision`)在 schema 里
  是**可选**。两端前端(EditorPort / MobileEditorRoot)现在都会带上,但存量客户端可能
  不带,所以服务端口径仍是「owner 省略走旧盲写,**editor 省略一律拒绝**」—— 后半句是
  可选 schema 下唯一的协同并发防线,`settings-wiring.test.ts` 有守卫钉住它。
  将来确认无存量客户端后可收紧为必填。
- AI 长任务(layout/compose)在派发时于 album 行锁内记 `agent_jobs.meta.baseline`,
  回写前重验;失配即 `AI_RESULT_STALE` **零写入** + 释放计费 hold —— 人工编辑优先于
  AI 结果。`replaceAll` 的 `updatedBy` 是发起者(AI 继承发起者身份),不再是 null。
- 协作者的书出现在「我的相册」,但 **editor 的 RUNNING 书不驱动轮询、不触发
  `resolveGeneration`** —— 账务清扫归书的 owner,否则僵尸共享书会在协作者侧
  形成永不终止的轮询。

### 照片滤镜与派生物

- `albums.photo_filter` 是全书默认 + 单张覆盖的持久化真相;显式 `null` 覆盖表示原片。
  26 个确定性 LUT 只以生成后的 17³/33³ 二进制资源随 Web 发布,`.cube` 源文件不进仓。
- 滤镜引擎只在 Browser 运行,只生成缓存/导出/上传用的派生像素;IndexedDB 原图不改写,
  Web/Agent 不做服务端滤镜处理。**抠图是例外**:alpha mask 由 CLIP worker 的 isnet
  在服务端出(`persistMask:true`),Web 写 R2 `photo-masks/{albumId}/{photoId}.png`
  并回填 `album_photos.profile.maskKey`,浏览器经 `photo-masks/urls` 签名取用;取不到才
  退回浏览器漫水填充(无语义、棚拍人像实测不可用,所以生产没配 `AGENT_CLIP_BASE_URL`
  会启动告警)。
- **建书照片直传 R2**:`POST /api/v3/albums` 的 body 里**没有照片字节**。浏览器先
  `POST /api/v3/albums/upload-urls` 换预签名 PUT(不建书/不扣积分/不写库,游客在此
  就按 `ANON_MAX_PHOTOS_PER_GENERATION` 卡住),直传到
  `analyze-uploads/{userId}/{uploadSessionId}/{photoId}.jpg`,建书请求只带
  `uploadSessionId` + 元信息;Web 在**建库之前**从 R2 取回字节拼成 `V3AnalyzeRequest`
  (engine 侧零改动),取不齐就 409 `ANALYZE_UPLOAD_INCOMPLETE`。理由:内联 base64
  时 27~50 张就撞 Vercel 4.5MB 的 `FUNCTION_PAYLOAD_TOO_LARGE`。
  `/retry` 和 `/add-photos` **仍走内联**(`RetryBodySchema` 里 base64 必填)。海外
  Vercel 时代的 4.5MB 上限在国内 docker 部署已不成立(2026-10-26 实测 7.3MB body
  完整通过解析,约束只剩积分检查);真遇超大重试再让它读 R2 即可。
  `analyze-uploads/` 前缀需要 R2 生命周期规则回收(运维前置条件,应用层不删)。
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

- 仓根 `pnpm test` 是 `pnpm -r --no-bail test`:失败**不再中断**、后续包照跑,但
  **退出码恒 0** —— 失败信号在输出里(pnpm 的 ERR 错误块),不在退出码里,别在
  脚本/CI 里拿它的退出码当判据。CI 不走这条:四门各自逐包显式跑。
  看到绿也要确认 scope 覆盖了你改的包。
- `pnpm typecheck` **不含 engine**。改 Python 要单独跑 pytest。
- `pnpm typecheck` 里挂着两道时效闸门:`docs:check`(文档)和 `sitemap:check`
  (sitemap 的 `<lastmod>`)。后者报错时别把所有日期一起刷新 —— `updatedAt` 是
  发给 Google 的,只有页面内容真变了才动;没变就只推进 `reviewedSources`（内容指纹,见 `sitemap:stamp`）。
  理由写在 `apps/web/src/lib/seo/freshness.ts` 顶部。
- Web 测试单跑:`cd apps/web && pnpm test`(或 `pnpm --filter @yujee/web test`)。
  **admin 集成测试不在其中**:它对全库用户集合敏感(并行必竞态),常规批整文件
  skip,独占跑用 `pnpm --filter @yujee/web test:admin`(CI web 门已挂)。
- Agent 测试从仓根跑:`PYTHONPATH=engine engine/.venv/bin/python -m pytest engine/tests`。
- 本地起全流程要**三个**服务:web 3000 / agent 8001 / design-agent 8787。
  漏了第三个,design-chat 直接 502。

## 动手规则

- 先读真实文件和 `git status`;不要按记忆或旧文档下结论。
- 不恢复用户删除的文件,除非用户明确要求。
- 新增顶层目录、依赖、数据库 schema、外部 API、跨服务协议前,先说明影响面。
- 临时脚本、验证产物、trace 文件用完即删。
- 长期说明放在仓根 README、对应 app README,或靠近模块的小 README。
- **所有改动一律走 PR 合并 main 上线**(2026-10-26 起,agent 侧改动同样遵守):
  merge 触发六门 CI + 自动部署(见 deploy/china/README「自动部署」);分支保护
  enforce admins,直推被拒。生产服务器上的跟踪文件不要 rsync 直改 —— 自动部署
  的 reset --hard 会覆盖;应急/回滚通道见 deploy README。
- 推送/PR/合并前先跑相应验证;没验证不要声称通过。

## 文档时效规则

带 `doc-scope` 尾块的文档,声明了自己描述哪些路径、校对到哪个提交。

**改动落在某份文档的 `paths` 覆盖范围内时,必须回头核对该文档,并把 `checked-at` 更新到
你这次的提交。** 文档内容确实无需改动时也要更新 `checked-at` —— 它记录的是「已核对」,
不是「已改写」。

`pnpm docs:check` 会校验这件事:覆盖路径自 `checked-at` 以来有新提交、而 `checked-at`
没跟上,就报错。它已挂进 `pnpm typecheck`。不要靠自觉,靠这个脚本。

机器改动的依赖清单不进 doc-scope:`pnpm-lock.yaml`(机器生成)、以及 dependabot
会直接编辑地板的 manifest(`engine/pyproject.toml`、`apps/web/package.json`)。
dependabot 不会推 `checked-at`,盖住它们会把对应生态的每个依赖 PR 永久卡死在
时效闸上(2026-10-26 两轮教训:npm 批 #21-#24、pip 批 #35-#37/#43)。manifest 的
**人工改动**(加脚本、换 extras)想留闸的话,靠 code review,不靠时效闸。

<!-- doc-scope
paths: engine/src/api/routes.py, apps/web/src/app/api/**, packages/design-agent/src/web/**, apps/web/src/lib/agent/**, package.json
checked-at: __SHA__
-->
