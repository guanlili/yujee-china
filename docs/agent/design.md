# Agent 内部设计(三真层 + 平铺边)

> **前置阅读**:`CLAUDE.md` → `docs/architecture.md` → [`docs/agent/contract.md`](./contract.md)(对外 req/res、错误码、状态机 —— 本文不复述)。
>
> **谁读这份**:写 / 评审 `apps/agent/src/` 的人(transport、flows、agents、engine、prompts、model 适配、logging)。
>
> 本文只讲 **Agent 内部如何实现五环节(V3)**:层结构、analyze pipeline、同步端点、模型 failover、prompt 分层、validation、redact。Web ↔ Agent 协议看 `contract.md`;系统切分与不变式看 `architecture.md §1·§3`。

Agent 是「分层良好的无状态 LLM 服务」,不是框架型 agent。书 + 记忆(章节树、每图 `sceneDescription`、stage、积分)全在 Web 的 `draft_json` / Postgres;Agent 每次被喂够上下文 → 返回 tree/pages/patch/layout,**调用之间不留任何东西**(§3 数据归属)。

---

## 1. 结构:三真层 + 平铺边

```
apps/agent/src/
├── main.py · settings.py · auth.py · logging_config.py   # 基建(根,入口 main:app 不动)
├── routes.py · errors.py · callback.py                   # transport(HTTP 边)
├── ai_client.py · vision_provider.py                     # model 适配(平铺)
├── schemas.py                                            # 契约镜像(单文件)
├── flows/        analyze.py                              # 真层① 编排
├── agents/<cap>/ handler.py + *.md [+ schema.py]         # 真层② LLM 能力
└── engine/       templates / skeleton_v3 / generic_copy / apply_theme_v3 / cover_v3 / finalize_v3
                                                          # 真层③ 确定性引擎
prompts/  common/(红线)+ rules/(可调规则)+ __init__.py(loader)
```

**三真层(各一句职责):**

- **flows** —— 唯一的真多步编排。当前只有 `flows/analyze.py`(describe→group→template→preview + 回调)。无状态,输入全由请求带入。
- **agents/`<cap>`** —— LLM 能力,「问模型」。每个 = `handler.py`(组 prompt → 调 model → 校验/clamp → 返回;不发进度、不映射 HTTP)+ 共置 prompt `.md`(+ 需要时 `schema.py`)。5 个能力:`image_understanding`(识图分章)、`writing`(章节文案/对话分诊)、`theme_recommend`(主题/章节色)、`template_select`(挑模板)、`image_edit_intent`(改图意图)。
- **engine** —— 确定性变换,**不调模型**,纯函数可单测:`templates`(模板注册表)、`skeleton_v3`(候选/挑模板/排图)、`generic_copy`(通用文案/色填充)、`apply_theme_v3`、`cover_v3`、`finalize_v3`(拍平 + 单一 `validate_v3`)。

**平铺边:**

- **transport** —— `routes.py`(health + 6 个 `/v3/*` 端点,瘦:解析 → 调 flow/agent/engine → 套信封 + log beat)、`errors.py`(同步端点统一错误映射)、`callback.py`(异步 analyze 回推 Web)。
- **model** —— `ai_client.py`(OpenAI 兼容 `/chat/completions` HTTP/JSON/usage,一次网络重试)+ `vision_provider.py`(provider slot 解析/failover/超时/per-provider 怪癖)。
- **schemas.py** —— 契约镜像(§6)。

> 没有 `services/`、没有 `skills/`、没有 `tools.py`/`layout_rules.py`(2026-06 重构删尽)。agents+engine 都暴露统一可调用接口,是未来 planner 要选取的工具面(第二期,见 `architecture.md §7.9`)。

---

## 2. analyze pipeline（`flows/analyze.py`,唯一异步端点）

`POST /v3/analyze` 是系统里唯一接收 base64 的端点。`routes.py` 接单即 `202`,把 `analyze.run_with_timeout(req)` 丢进 FastAPI background task。

**回调序列**(每步经 `callback.post` 回推 Web `progress`,见 §3 共通):

| stage | 做什么 | 调谁 |
|---|---|---|
| `describe` | 识图模型一次(或并发多次)调用 → 章节树:分章 + 每章 `description` + 每图 `sceneDescription`;width/height/orientation/takenAt 由代码填充 | `agents/image_understanding.describe_content` |
| `group` | **纯进度 beat**,无独立模型调用 —— 分章已并进 describe 那次调用,代码归一化 | — |
| `template` | 每页从「合法候选集」里挑 templateId,LLM 失败逐页降级纯代码 | `agents/template_select` + `engine/skeleton_v3` |
| `preview` | 在选好的页上叠加通用文案/色(folio、date/dateNum),章节 `accentColor`/`artFont` 留 null 占位 | `engine/generic_copy.fill_generic_copy` |

完成回调 `V3AnalyzeCompleted` 回一棵 `V3LayoutTree` + 预览 `Page[]` + usage。

**失败 / 超时:** 每个 stage 包在 guard 里,失败前先把该 stage 进度条重置为 0 再发 `failed` 回调(重试不留半填进度)。describe 失败 → `AGENT_VISION_FAILED`;template/preview 失败 → `AGENT_OUTPUT_VALIDATION`;整个 background task 超过 `background_task_timeout_seconds`(600s)→ `AGENT_TIMEOUT`;其它未捕获异常 → `AGENT_INTERNAL_ERROR`。

**无模块全局(消状态泄漏):** 每个 analyze 作业持自己的 `_Job` holder,`active_stage` 记在 holder 上;超时/未捕获错误路径从 holder 读「当时跑到哪个 stage」一并报告。**绝无跨请求共享的模块级 stage 变量**(旧 `_active_stage_by_request` 已删,§3 不变式)。

---

## 3. 同步端点（5 个,秒级,前端转圈）

`routes.py` 五个同步端点都瘦——log accepted → 调 agent/engine → log completed → 套 `{ok, data}` 信封。错误统一走 `errors.py` 的 `sync_endpoint_errors(...)` 上下文管理器(§9)。

| 端点 | 调谁 | 模型 | 输出 |
|---|---|---|---|
| `POST /v3/chapter-chat` | `agents/writing.handler.run` | DeepSeek(改图时升级识图模型) | 本轮分诊 `talk`/`write`/`edit` + patch |
| `POST /v3/recommend` | `agents/theme_recommend.handler.run` | 识图模型 | 每章一组 `{subject, accentColor, artFont}` |
| `POST /v3/apply-theme` | `engine/apply_theme_v3.apply_theme` | 无(确定性) | 页级 `layoutPatch`(subject→title + accent→svg) |
| `POST /v3/cover` | `engine/cover_v3.build_cover` | 无(确定性) | 封面/封尾 `layoutPatch`,两个 id 都缺 → 空 patch 不报错 |
| `POST /v3/finalize` | `engine/finalize_v3.finalize_v3` | 无(确定性) | 扁平 `AlbumLayoutPlan` + usage |

**chapter-chat 一轮一调:** `writing.handler` 一次 DeepSeek 调用同时完成分诊(返回 `kind`)和本轮内容,避免 60s 预算内二次往返。

- `talk` —— 引导,只回 `assistantReply`,**未经要求绝不撰写**(红线);无 patch。
- `write` —— 一次性填满本章每页 `pagesTexts`,按模板槽规格 clamp 到 `maxChars`,丢非法槽。
- `edit` —— 仅当聚焦页在本轮切片内才采纳。DeepSeek 判 `editTarget`:`text`(默认)= DeepSeek 重写那页文字(**纯文字编辑绝不碰识图模型**,图文分流);`image` = 升级 `agents/image_edit_intent` 让识图模型出一个有序 `photoId` 意图(绝不出 templateId/pageIndex),再由 `engine/skeleton_v3`(`pick_template_v3`/`assign_images_v3`)确定性执行成整页 patch。模型/引擎摆不下 → 降级一句 talk(绝不杜撰版式)。

**apply-theme(#236):** 接收用户确认的每章 `{subject, accentColor, artFont}`,确定性刷每个 `variableDecor:true` 槽(文字点缀/装饰/SVG),并把 `subject` 写进该章 `title` 槽(clamp maxChars)。不调模型;与 §2 analyze 阶段「LLM 只写 3 处」不变式无关(这是 theme 阶段用户确认的确定性写入)。Web 把 accent/font 写进树、合并 patch、推进 stage。

**finalize(唯一收全树):** 读 `tree` + 完整 `pages` → 把每章 `accentColor`/`artFont`(此前只活在树里)bake 进 `pages[].texts`(含 svg 接缝)→ 建 `AlbumLayoutPlan` → 跑**单一 `validate_v3`** → 返回 `{layout, usage}`。无模型调用、无 base64、不推进 stage、不动积分、**绝不让任何树形字段泄进扁平契约**(§3 树边界)。

**stage 推进权在 Web:** Agent 无状态;同步端点失败走 HTTP 错误码,前端可重试不污染 stage;Web 只在校验通过的成功后才合并 patch、推进 stage、控导出闸门。

---

## 4. 模型 failover（`vision_provider.py` + `ai_client.py`）

**两类模型 / 两个识图槽互为 failover:**

- **识图模型 = 版面主控**(describe / recommend / select-template / image-edit-intent 都用它):两个 OpenAI 兼容槽——`openai`(`OPENAI_*`,默认 `gpt-5.5-mini`)与 `ark`(火山 doubao,`ARK_*`,默认 `doubao-seed-1-6-vision`)。`settings.vision_provider` 选主槽(默认 `ark`):
  - `vision_provider="openai"`(生产) → 主 = OpenAI(`describe_openai_timeout_seconds=30s` 紧预算),failover = 火山 ark。
  - `vision_provider="ark"`(本地/被墙) → 主 = 火山 ark,不走打不通的 OpenAI。
  - per-provider 怪癖集中在 `vision_provider.py`:doubao 的 `thinking:{type:disabled}` extra_body **只**加在 ark 槽(OpenAI 收到会 400);OpenAI 可用 `response_format=json_object`,doubao 文本模型 400 → 只靠 thinking-disabled + prompt「STRICT JSON」。
- **文案模型**:DeepSeek 槽(`DEEPSEEK_*`,默认 `deepseek-chat`)—— 只管 chapter-chat 的文案 + talk/write/edit 分诊。

**超时 / 重试:**

- `ai_client.chat_completion` 对单次调用:transport 错误 / 5xx **重试 1 次**;4xx 立即抛(配置/请求错误,failover 无益);只有 5xx/timeout/transport 算 `failover_eligible`。
- describe:主槽用 `describe_openai_timeout_seconds=30s`/次;整批受 `describe_batch_deadline_seconds=90s` deadline 约束——慢但不报错的主 provider 也会触发 failover。两槽都失败/没配 → `VisionError` → `AGENT_VISION_FAILED`。
- describe 批量并发(#232):浏览器盖 `clusterId` 时,按**张数**(非语义)决定并发宽度(≤20→1 路,>20→2 路,>40→3 路,`describe_max_concurrency=3` 封顶);整簇装箱进路由(**簇不跨路** = 章节下界),`asyncio.gather` 并发跑,再按全局 cluster/时间顺序合并各局部树、重编号 `ch_1..N`。failover 对整批在另一槽跑**一次**,绝不逐路由放大扇出。全 `clusterId=null` → 退化为单批「模型自由分组」,向后兼容。
- 小模型漏图/重复/错认 photoId 是非确定性失误:带「必须覆盖全部 N 张」纠正提示在同一槽内升温重抽,最多 `MAX_DESCRIBE_ATTEMPTS=3` 次;结构性畸形(缺 `chapters[]`)不重试直接抛。
- 同步端点 Web 侧 60s 预算;analyze background task 600s。callback 短超时重试(10s,退避 1/4s,三次,giveup 只记日志)。

---

## 5. prompt 分层系统（`prompts/`)

按**稳定性**切分 prompt 归属,`load_prompt(path, *, common=(...), **slots)` 分层组装:

- **`agents/<cap>/*.md`(固定结构)** —— 任务定义 + 输出 JSON 形状 + 字段契约,跟用它的能力共置,handler 按显式路径加载。例:`describe_content.md`、`recommend_theme.md`、`select_template.md`、`edit_image_intent.md`。
- **`prompts/common/`(跨能力红线)** —— 写一次复用:`json_only`(只出严格 JSON)、`grounding`(绝不杜撰人/地/日期/事件)、`privacy`(绝不输出坐标/经纬度/GPS/地址/地点字段)、`persona`(Yujee 小水母语气,只影响面向用户的回复文字,不改 JSON 结构)。handler 用 `common=(...)` **声明**自己要哪几个,loader 把对应片段拼到 body 之后。
- **`prompts/rules/`(按能力可调规则)** —— 经 `RULES_DIR / "<name>.md"` 加载:`chapter_grouping`(分章启发式)、`cluster_grouping`(#232 cluster 边界)、`describe_retry`(漏图纠正语)、`writing_style` / `guidance_style`(写作 / 引导文风)、`theme_colors`(章节配色 + ArtFont 合法集)。

`{KEY}` 占位符用 `str.replace`(**不是** `str.format`,所以 prompt 里 JSON 示例的 `{ }` 不会被动到)。`{LANGUAGE}` 等 slot 通过 `**slots` 注入。加载文本按路径 `lru_cache`。

---

## 6. validation（`schemas.py` 镜像契约)

- TS zod(`packages/contracts`)是单一真相源;`schemas.py` 逐字段镜像,全部 `_V3Strict`(`extra='forbid'`,多数 `strict=True`)—— 上游模型 / 自身组装吐出的任何未知键都被拒。
- 每个 agent 在 handler 内对模型输出过 strict schema + **clamp 到模板槽**:漂移的模型既无法注入不存在的槽 id(保留集 = 模板创作槽),也无法撑爆 `maxChars`,recommend 的 artFont 收回 4 成员 ArtFontPack、accentColor 归一化为 `#RRGGBB`,image-edit 意图按本章真实 photoId 过滤 + 钳容量。
- **finalize 是唯一 layout 校验路径**:`engine/finalize_v3.validate_v3` 单一 validate,认 `svgs`/`items`/`variableDecor`/章节色/字体;无「page0 必须 cover」规则(封面可选)。
- 同步端点输出校验失败 → HTTP 422 + `AGENT_OUTPUT_VALIDATION`;analyze 输出校验失败 → callback `failed` + `AGENT_OUTPUT_VALIDATION`。Web 把 `AGENT_OUTPUT_VALIDATION` 映射成 Web 侧 `AGENT_INVALID_OUTPUT` 再对外/落库。

---

## 7. redact / 隐私（`logging_config.py`）

隐私边界对齐 `architecture.md §3`:base64 与原图**只在 analyze 请求内存链路**过——读出来构建照片列表后即丢本地引用,**绝不记录、绝不回传**。Stage0 只读 `takenAt`(可作标量值);**不抽 GPS、无地点/坐标维度**;分章只用时间 + 不透明 `clusterId` + 画面整体性。`clusterId` 是 same-place/same-time 的**不透明标签,不是坐标**,因此**不**是 redact 目标。

`logging_config` 的 redact processor 作为防御红线拦坐标键(即便契约 `.strict()` 已会拒绝):

- **精确匹配键**(短名歧义大,避免误伤 `latency`/`translate`):`lat`/`lng`/`latitude`/`longitude`/`gps`/`coordinates`/`place`,以及 prompt/userMessage/systemPrompt/`history.content`/`content` 等原文键。
- **子串匹配键**:`base64`、`raw_response`/`raw_content`、`api_key`、`secret`、`authorization`、`bearer`、`email`、`user_id`、`exif`(整块 EXIF 可能裹 GPS,防御性整体 redact)。
- **字符串值内清洗**:即使键名无嫌疑,值里的 data URL(`data:image/…;base64,…`)和 `Bearer …` token 也被擦掉。

`AGENT_SHARED_SECRET` 不进任何 client bundle;Agent 不写库 / 不落 R2 / 不持会话。

---

## 8. 错误映射

| 情形 | Agent code |
|---|---|
| 请求体非法 | `AGENT_INVALID_INPUT`(契约校验)|
| Bearer 无效 | `AGENT_UNAUTHORIZED` |
| 识图模型 / 解析失败 | `AGENT_VISION_FAILED` |
| 文案 / 规划模型失败 | `AGENT_PLANNING_FAILED` |
| Agent 产出的 patch/layout 非法 | `AGENT_OUTPUT_VALIDATION` |
| background task 超时 | `AGENT_TIMEOUT` |
| 未知异常 | `AGENT_INTERNAL_ERROR` |

- **异步**(analyze)终态失败走 callback `event="failed"`(带当时 stage)。
- **同步**端点走 HTTP 错误信封:`sync_endpoint_errors(log, name, KnownError, known_status, known_code)` 收掉了 5 个端点重复的 try/except——已知服务错误 → `log.warning` + `HTTPException(known_status, {ok:false, error:{code, message[:300]}})`;其它异常 → `log.exception` + 500 `AGENT_INTERNAL_ERROR`。chapter-chat/recommend 的已知错误映射 502 `AGENT_PLANNING_FAILED`;apply-theme/cover/finalize 映射 422 `AGENT_OUTPUT_VALIDATION`。
- 失败的同步端点**不**改 Web stage;Web 只在校验通过的成功后才推进。
