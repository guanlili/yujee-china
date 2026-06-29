# Agent 内部实际操作逻辑

日期: 2026-06-28

范围: 本文只整理当前工作区 `apps/agent/src` 的实际代码行为。它不是目标设计稿,也不是重构建议;它说明现在 Agent 收到请求后到底怎么走、调哪些模块、哪些地方会调用模型、哪些地方会写状态。

## 1. 总结

当前 Agent 不是一个单一大 Agent,而是四层拼在一起:

1. HTTP 入口层: `main.py` / `routes.py`。
2. 异步流程层: `flows/analyze.py` / `flows/select_layout.py`。
3. LLM 能力层: `agents/*/handler.py`。
4. 确定性引擎层: `engine/*`。

当前最容易让人感觉复杂和散的点有三个:

- 初始化被拆成两段: `/v3/analyze` 只产出章节树,`/v3/select-layout` 再产出版面页。
- 编辑同时存在三条入口: `/v3/edit-chat`、`/v3/chapter-chat`、`/v3/page-edit`。其中 `edit-chat` 是有状态主路径,另外两条是无状态能力面。
- prompt 资产现在分成 `agents/<cap>/*.md` 和 `skills/*.md`:前者应只写角色/输入/输出/硬格式,后者写人为规则、风格、约束和回复。

## 2. 文件职责

### 2.1 HTTP 与启动

- `apps/agent/src/main.py`
  - 创建 FastAPI app。
  - 读取 settings。
  - 校验启动配置。
  - 注册 request id 日志中间件。
  - 挂载 `routes.router`。

- `apps/agent/src/routes.py`
  - 定义所有 HTTP 路由。
  - 做鉴权、日志、同步端点错误映射。
  - 只负责把请求转发给 flow / agent / engine,不做核心业务逻辑。

- `apps/agent/src/errors.py`
  - 给同步端点统一映射错误形状:
    `{ ok:false, error:{ code, message } }`。

- `apps/agent/src/callback.py`
  - 给异步 job 回调 Web。
  - 使用 `AGENT_SHARED_SECRET` bearer。
  - 失败重试 2 次,退避 1s / 4s。

### 2.2 异步初始化流程

- `apps/agent/src/flows/analyze.py`
  - Stage1。
  - 输入照片和 base64。
  - 输出 `V3LayoutTree`。
  - 不产出 pages。

- `apps/agent/src/flows/select_layout.py`
  - Stage2。
  - 输入 Stage1 tree 的 chapters 和 200px refs。
  - 输出 `Page[]`。
  - Gemini 失败时局部 fallback 到确定性 skeleton。

### 2.3 Agent 能力

- `agents/image_grouping`
  - 纯代码分组。
  - 按 clusterId / EXIF 时间 / 数量限制切 chapter。

- `agents/image_understanding`
  - 视觉理解。
  - 描述章节和每张图的 sceneDescription。

- `agents/regroup_unplaced`
  - 纯代码处理未归组照片。
  - 按时间或输入位置归回最近章节。

- `agents/writing`
  - `/v3/chapter-chat` 的无状态章节写作/编辑能力。
  - DeepSeek 一次调用决定 `talk/write/edit`。

- `agents/editing`
  - `/v3/edit-chat` 的有状态主编辑路径。
  - 使用 Agent DB 串行化 turn,写 pending op,等 Web ack。

- `agents/page_edit`
  - `/v3/page-edit` 的无状态聚焦页编辑能力。
  - 两段式:意图路由 -> 执行动作。

- `agents/image_edit_intent`
  - 只在 `chapter-chat` 里处理图片编辑意图。
  - 模型只选 photoIds,实际换版由确定性引擎落地。

- `agents/theme_recommend`
  - `/v3/recommend`。
  - DeepSeek 推荐 3 组全书主题选项。

### 2.4 确定性引擎

- `engine/skeleton_v3.py`
  - 按模板 category 和图片数量选择模板。
  - 按顺序把照片塞入 image slots。
  - 可给正文页前后包默认 cover / ending 页。

- `engine/gemini_layout.py`
  - 给 Gemini 构造候选模板目录和图片输入。
  - 接收模型布局意图。
  - `legalize_layout` 负责把模型输出夹回合法页。

- `engine/generic_copy.py`
  - 只填通用装饰文案,例如 folio / date。
  - 不写正式正文,不写地点。

- `engine/apply_theme_v3.py`
  - 纯确定性应用主题。
  - 写 variableDecor SVG 的颜色、空 title 的 subject。

- `engine/cover_v3.py`
  - 封面/封尾设计。
  - 可跳过。
  - 可调用 DeepSeek 生成封面/封尾短文案和颜色建议。
  - 最终仍用确定性 page patch 落地。

- `engine/finalize_v3.py`
  - 纯确定性出货。
  - tree + pages -> `AlbumLayoutPlan`。
  - 烘焙章节主题到扁平页。
  - 执行唯一的 `validate_v3`。

## 3. 启动与请求外壳

启动入口是 `src.main:app`。

启动时的硬约束:

- `AGENT_ENV=production` 时必须 `AGENT_PIPELINE_MODE=real`。
- `AGENT_PIPELINE_MODE=real` 时必须有 `ARK_API_KEY` 和 `DEEPSEEK_API_KEY`。
- 业务端点都要求 `Authorization: Bearer <AGENT_SHARED_SECRET>`。
- `/health` 不需要 bearer。

请求处理外壳:

1. `main.py` 中间件绑定 request id。
2. `routes.py` 验证 bearer。
3. 同步端点直接 await handler / engine。
4. 异步端点创建 background task 后立刻返回 202。
5. 异步 task 通过 `callback.post` 把 progress / completed / failed 发回 Web。

Agent 不直接拥有 Web 的相册 draft / stage。正常情况下 Web 才是相册状态的持久化方。例外只有 `/v3/edit-chat` 的会话历史和 op 状态,它写 Agent 自己的 `agent.*` schema。

## 4. 路由全表

| 路由 | 类型 | 实际职责 |
|---|---|---|
| `GET /health` | sync | 健康检查 |
| `POST /v3/analyze` | async + callback | Stage1:照片分章和识图,输出 tree |
| `POST /v3/select-layout` | async + callback | Stage2:模板选择和预览页生成,输出 pages |
| `POST /v3/edit-chat` | sync + DB | 当前主编辑 turn,写 pending op |
| `POST /internal/agent-ack` | sync + DB | Web 确认 op 后提交 Agent pending 历史 |
| `POST /v3/chapter-chat` | sync | 无状态章节写作/编辑能力 |
| `POST /v3/page-edit` | sync | 无状态聚焦页编辑能力 |
| `POST /v3/recommend` | sync | 推荐 3 组主题选项 |
| `POST /v3/apply-theme` | sync deterministic | 应用用户确认的主题 |
| `POST /v3/cover` | sync awaited async | 封面/封尾设计或跳过 |
| `POST /v3/finalize` | sync deterministic | 出货成扁平 `AlbumLayoutPlan` |

## 5. Stage1: `/v3/analyze`

入口: `routes.submit_analyze`

实际执行: `flows/analyze.run_with_timeout`

详细步骤:

1. HTTP 收到请求后返回 202。
2. 后台 task 发 progress: `jobKind="analyze"`, `stage="group"`, `progress=0`。
3. `image_grouping.group_photos(req.photos)` 做纯代码分组:
   - 有 `clusterId` 时以 cluster 为原子单元。
   - 无 cluster 时单张照片是一个单元。
   - 按最早 takenAt 和输入顺序排序。
   - 超过 20 张或时间跨度超过 36 小时就切新 chapter。
   - 校验照片覆盖完整、不重复、cluster 不被拆散。
4. 发 group 100。
5. 发 describe 0。
6. `image_understanding.describe_chapters(...)` 调视觉模型:
   - 输入是图片和分组。
   - 输出 chapter description、photo sceneDescription、extractedColor 等。
   - 不选择模板、不生成 pages、不写封面。
7. 发 describe 100。
8. 再发 group 0。
9. `regroup_unplaced.group_unplaced(...)` 处理未归组照片:
   - 无模型。
   - 按 cluster 或单张归到最近章节。
   - 优先时间距离,否则输入位置。
10. `_assemble_stage1_tree(...)` 组装 tree:
    - 每张输入照片必须且只能出现一次。
    - 每张图带 width/height/orientation/takenAt/sceneDescription。
    - 每章带 description、photos、extractedColor。
    - `accentColor` 和 `artFont` 在此阶段保持 null。
11. 发 group 100。
12. callback completed:
    - `event="completed"`
    - `jobKind="analyze"`
    - body 里有 `tree` 和 `usage`
    - 不带 `pages`

失败映射:

- grouping / regroup / assemble 失败: `AGENT_OUTPUT_VALIDATION`
- vision describe 失败: `AGENT_VISION_FAILED`
- 超时: `AGENT_TIMEOUT`
- 未捕获异常: `AGENT_INTERNAL_ERROR`

## 6. Stage2: `/v3/select-layout`

入口: `routes.submit_select_layout`

实际执行: `flows/select_layout.run_with_timeout`

详细步骤:

1. HTTP 收到请求后返回 202。
2. 后台 task 发 progress: `jobKind="select-layout"`, `stage="layout"`, `progress=0`。
3. `_layout_units` 按 `select_layout_max_images_per_batch` 把章节拆成 layout units。
4. `_chapter_batches` 再按总图片数切 batch。
5. 每个 batch 进入 `_select_batch`:
   - 调 `gemini_layout.gemini_layout(..., mode="select", allowAddPages=True)`。
   - Prompt 中包含候选模板目录、照片 200px refs、模板 preview bucket images。
   - 模型只给布局意图:chapterId、templateId、slots。
6. `gemini_layout.legalize_layout(...)` 合法化模型输出:
   - templateId 必须是 interior。
   - 模板容量必须能容纳该页照片。
   - slots 必须来自模板声明。
   - slots 必须刚好覆盖该页照片,不重复。
   - 分页必须按原章节照片顺序完整覆盖。
7. 如果 Gemini 调用失败或某章输出非法,对应 batch / chapter fallback:
   - `skeleton_v3.build_skeleton_v3(...)`
   - 按图片数量选择能装下的模板。
   - 按顺序塞图。
8. 所有 batch 聚合后重排 pageIndex。
9. `skeleton_v3.wrap_with_cover_ending(...)` 给预览包默认 cover / ending:
   - cover 使用默认 cover 模板和整本第一张照片。
   - ending 使用默认 ending 模板和整本最后一张照片。
   - 没有模板或没有照片时跳过。
10. `generic_copy.fill_generic_copy(...)` 填通用装饰:
    - `folio` 写页码。
    - `date/dateNum` 从该页最早 takenAt 推出。
    - 正式 title/body/explain 不写。
    - location 不写。
11. callback completed:
    - `event="completed"`
    - `jobKind="select-layout"`
    - body 里有 `pages` 和 `usage`

失败映射:

- 单批 Gemini 失败不是整单失败,会 fallback。
- 整体超时: `AGENT_TIMEOUT`
- 未捕获异常: `AGENT_OUTPUT_VALIDATION`

## 7. 主编辑路径: `/v3/edit-chat`

入口: `routes.submit_edit_chat`

实际执行: `agents/editing/handler.py`

这是当前最像“产品主 Agent”的路径。它有状态,并且依赖 Web 内部数据接口。

详细步骤:

1. 路由收到 `V3EditChatRequest`。
2. handler 调 `agent_edit_repo.begin_serialized_turn(...)`:
   - upsert `agent.edit_sessions`。
   - 对当前 album session `for update` 加锁。
   - 如果已有 `inFlight` 且未超过 5 分钟,最多轮询等待 30 秒。
   - 读取当前 album/chapter 最近 committed messages。
   - 写入新的 `inFlight.turnId`。
3. 根据用户输入分支。

分支 A:确认章节

- 条件:用户消息等于 `[confirm-chapter]`,且 focus 有 chapterId。
- 不调模型。
- 返回 `progressDecision.chapterDone=true, advanceTo="theme"`。

分支 B:换版

- 条件:命中 layout swap 正则。
- 通过 `WebAgentDataClient` 调 Web 内部 `/api/v3/internal/agent-data`:
  - `get_page_info`
  - `get_page_photos`
- 调 `gemini_layout.gemini_layout(..., mode="case4-swap")`。
- 再走 `legalize_layout`。
- 转成当前 focus 页的 `layoutPatch`。

分支 C:普通章节聊天/写作/编辑

- 条件:有 focus chapterId,但不是确认或换版。
- 通过 Web 内部 agent-data 拉 chapter/page/photos。
- 构造 `V3ChapterChatRequest`。
- 调无状态的 `agents/writing.handler.run(...)`。
- 接收 assistantReply、pagesTexts、layoutPatch、usage。

分支 D:兜底聊天

- 没有可编辑 focus 时,只返回普通回复。

最后统一落库:

1. `_op_kind` 把动作归类:
   - `swap_layout`
   - `swap_image`
   - `write_chapter`
   - `edit_text`
   - `advance`
2. 组装 payload:
   - kind
   - patches
   - pagesTexts
   - progressDecision
   - history
3. `turn.create_pending_turn(...)`:
   - 检查当前 lease 仍然有效。
   - 插入 `agent.edit_ops(status='pending')`。
   - 插入 pending user message。
   - 插入 pending assistant message。
   - payload 带 `_turnId`。
4. 返回 `V3EditChatResponse(opId=...)`。

异常处理:

- handler 内任何异常都会尝试 `turn.cancel()`。
- cancel 只会清理匹配当前 turnId 的 `inFlight`。

## 8. Ack 路径: `/internal/agent-ack`

入口: `routes.ack_agent_op`

实际执行: `agent_edit_repo.acknowledge_op(opId)`

这是 Web 和 Agent 的提交边界。

详细步骤:

1. Web 在自己那边合并 layoutPatch / pagesTexts / progressDecision 后调用 ack。
2. Agent 找到对应 `agent.edit_ops`。
3. 如果 op 是 pending 或 committed,把 op 标成 committed。
4. 把同 opId 下 pending messages 标成 committed。
5. 如果 payload 里有 `_turnId`,且 session 当前 `inFlight.turnId` 匹配:
   - 清掉 `inFlight`。
6. 返回 `{ ok:true, acknowledged:true/false }`。

语义:

- 已 committed 的 op 再 ack 仍返回 true。
- 未知 opId 返回 false。
- 没有 `DATABASE_URL` 或缺 psycopg 时返回 DB unavailable。

## 9. 无状态章节能力: `/v3/chapter-chat`

入口: `routes.submit_chapter_chat`

实际执行: `agents/writing/handler.py`

这个端点不读 DB,也不调用 Web agent-data。请求必须直接带完整 chapter/pages/history/focus。

Prompt 组成:

1. `agents/writing/chapter_chat.md`
2. skill: `chapter_chat_turns`
3. skill: `writing_style` + `grounding`
4. skill: `guidance_style`

模型:

- DeepSeek planning slot。
- 一次 chat completion。
- 期望 JSON。

详细步骤:

1. `build_messages(req)` 组装 system 和 user payload。
2. user payload 包括:
   - language
   - chapter description
   - 每张图 sceneDescription
   - pageSlots
   - pageOutputExamples
   - pageImages
   - history
   - userMessage
   - focusedPageIndex
3. DeepSeek 返回 JSON。
4. `_coerce_response` 夹紧输出。

输出分支:

- `kind="talk"`
  - 只返回 assistantReply。

- `kind="write"`
  - 给本章每页生成 `V3PageTextsPatch`。
  - 只允许写模板声明的 authored text slots。
  - 按 maxChars 截断。
  - 缺必填内容时降级 talk。

- `kind="edit"`
  - 必须有 focusedPageIndex。
  - `editTarget="text"` 时,只改 focus 页 texts。
  - `editTarget="image"` 时,转到 `image_edit_intent.run_image_edit(...)`。

## 10. 图片编辑意图: `image_edit_intent`

入口:只由 `/v3/chapter-chat` 的 edit image 分支调用。

它不是独立 HTTP 端点。

详细步骤:

1. 构造文本 manifest:
   - chapter description
   - 所有 chapter photoId 和 sceneDescription
   - 当前页照片
   - 当前模板容量
   - 用户消息
2. 调视觉 slot:
   - OpenAI 可用则 OpenAI。
   - 否则 Ark。
   - prompt = `edit_image_intent.md` + skill `image_edit_selection`。
3. 模型只输出 photoIds。
4. `_ground_intent`:
   - 只保留本章 photoIds。
   - 去重。
   - 截到 interior 模板最大容量。
5. `_execute_intent`:
   - 按选中照片数量找合法 interior 模板。
   - 按顺序 assign images。
   - 尽量保留新模板也存在的 texts。
6. 失败、超时或无合法结果时返回 None。
7. 上游 `chapter-chat` 收到 None 后降级 talk。

## 11. 聚焦页能力: `/v3/page-edit`

入口: `routes.submit_page_edit`

实际执行: `agents/page_edit/handler.py`

这个端点也是无状态能力面。它的特点是失败安全,多数失败都会变成 talk。

详细步骤:

1. `_run_guarded` 加总超时。
2. 先计算:
   - `page_filled`
   - `chapter_completion`
3. 第一段模型调用 `_route_intent`:
   - prompt = `intent_router.md` + skill `page_intent_routing`
   - DeepSeek max_tokens 400
   - 输出 intent
   - intent 被夹到 `edit_text/change_layout/advance/talk`
4. 按 intent 分支。

分支 `edit_text`:

- 第二段模型调用:
  - prompt = `edit_text.md` + skill `page_text_editing` + `writing_style` + `grounding`
  - 输入 current texts、focused page、photos、userMessage。
- 输出 texts。
- 只保留合法 slot。
- 返回该页 `layoutPatch`。

分支 `change_layout`:

- 不调模型。
- 只对 interior 页生效。
- 找同照片数量但 templateId 不同的合法候选。
- 按当前页照片顺序重新 assign images。
- 没有候选则返回 talk。

分支 `advance`:

- 不改页。
- 返回 `advanceIntent=true`。

分支 `talk`:

- 只返回 assistantReply。

失败行为:

- 缺 DeepSeek key、模型失败、JSON 解析失败、内部异常、超时,都会返回 talk fallback。

## 12. 主题推荐: `/v3/recommend`

入口: `routes.submit_recommend`

实际执行: `agents/theme_recommend/handler.py`

Prompt 组成:

1. `agents/theme_recommend/recommend_theme.md`
2. skill: `book_theme_options`
3. skill: `theme_colors` + `grounding`

详细步骤:

1. 构造章节 overview:
   - chapterId
   - description
   - 每张图 sceneDescription
2. DeepSeek 一次调用。
3. 解析 JSON。
4. `_coerce_book_theme_options` 强制输出恰好 3 组 option。

硬规则:

- optionId 唯一,缺失时 fallback 为 `opt-1` 等。
- artFont 必须在闭集内,非法时 fallback。
- 每组 option 必须覆盖请求中的每个 chapter。
- 每章 subject 会被 trim / clamp。
- accentColor 通过 `finalize_color` 归一为合法 hex。

推荐只产出候选。真正写进页是 `/v3/apply-theme`。

## 13. 应用主题: `/v3/apply-theme`

入口: `routes.submit_apply_theme`

实际执行: `engine/apply_theme_v3.py`

这是纯确定性端点,不调模型、不读 DB、不访问 Web。

详细步骤:

1. 校验请求没有多章歧义:
   - 如果 `chapters` 多于 1 且传了 pages,直接拒绝。
   - 原因是 `Page` 不带 chapterId。
2. 对每个 page 读模板。
3. 找 `variableDecor` SVG:
   - `texts[svgId] = accentColor`
4. 找 `variableDecor` text slot:
   - role 是 `title` 且当前为空时写入 subject。
   - role 是 `title` 但已有值时保留。
   - role 是用户正文时不碰。
   - decoration 文本值不写成颜色。
5. 返回 `layoutPatch`。

成功要求:

- 至少有一页可主题化。
- 否则抛 `ApplyThemeV3Error`,路由映射为 `AGENT_OUTPUT_VALIDATION`。

## 14. 封面/封尾: `/v3/cover`

入口: `routes.submit_cover`

实际执行: `engine/cover_v3.py`

这是同步 HTTP 端点,内部 await 一个 async 编排。

详细步骤:

1. 如果 `coverTemplateId` 和 `endingTemplateId` 都缺失:
   - 合法跳过。
   - 返回空 `layoutPatch`。
2. 校验模板:
   - cover 模板必须 category=cover。
   - ending 模板必须 category=ending。
3. 校验落地页:
   - 选了模板就必须传 pages。
   - 同时选 cover 和 ending 时需要不同 landing pages。
4. 构造 copy payload:
   - 不带 base64。
   - 包含模板 slot specs、coverPhotoDesc、hint、history、userMessage。
5. 运行 copy seam:
   - 默认 DeepSeek。
   - 输出 needsUserInput、assistantReply、coverTexts、endingTexts。
   - 最多允许 2 轮 clarification。
   - copy 失败时尽量转成 needsUserInput 或空文案。
6. 提取颜色:
   - `coverPhoto` / `endingPhoto` 只给本地 `accent_from_photo` 用。
   - 不是 prompt payload。
7. 运行 color seam:
   - 默认 DeepSeek。
   - 输出 accentColor。
   - 失败时 fallback 到提取色或中性色。
8. 设计页面:
   - cover 落到传入 pages 第一页。
   - ending 落到传入 pages 最后一页。
   - 不凭空造页。
   - 照片按模板容量截断并按顺序 assign。
   - authored_texts 经过 writing cleaner。
   - location/place/gps slot 不写。
   - 主题 carrier 写入 page texts。
9. 返回 `layoutPatch` 和 usage。

## 15. 出货: `/v3/finalize`

入口: `routes.submit_finalize`

实际执行: `engine/finalize_v3.py`

这是纯确定性端点,不调模型、不读 DB、不访问 Web。

详细步骤:

1. `_collect_photos` 从 tree 收集唯一照片:
   - description 来自 sceneDescription。
   - orientation 透传。
   - tags 为空。
   - quality 合成 `"detail"`。
2. `_flatten_pages` 把传入 pages 从 0 开始重排 pageIndex。
3. `_bake_variable_decor` 把章节主题烘进扁平页:
   - 通过 photoId 判断 page 属于哪个 chapter。
   - chapter 没有 accentColor 时不烘。
   - SVG variableDecor: `texts[svgId] = accentColor`。
   - TEXT variableDecor:写 sibling carrier:
     - `slotId#accentColor`
     - `slotId#artFont`
   - 可见正文值不覆盖。
4. `_magazine` 生成 magazine header:
   - title 优先取第一章 description。
   - 没有则用默认标题。
5. 组装 `AlbumLayoutPlan`。
6. `validate_v3(layout)` 做唯一硬校验。

`validate_v3` 主要校验:

- pages 数量 1..48。
- pageIndex 顺序连续。
- templateId 必须已知。
- image/text slot 必须属于模板。
- repeat-group bracket path 合法。
- theme carrier 只能挂在 text variableDecor slot 上。
- page 引用的 photoId 必须存在于 photos[]。
- 同一页不能重复用同一张照片。
- 正文页同一照片全册最多复用 2 次。
- 所有 tree 照片必须至少被某页使用。

V3 不强制 page0 是 cover。cover/ending 是可选页。

## 16. Prompt / skills 当前装配方式

实现位置: `apps/agent/src/skills/__init__.py`

当前规则:

- `SKILLS_DIR = apps/agent/src/skills`
- `load_prompt(path, *, skills=(...), **slots)`:
  1. 先读传入 path 的 agent contract md。
  2. 再按 `skills` 参数追加 `SKILLS_DIR/<name>.md`。
  3. 最后做简单 `{KEY}` 字符串替换。
- `load_replies(path)`:
  - 解析 `key: value` 或 `key：value`。
  - 忽略空行和注释。
  - 后出现的 key 覆盖前面。

现在的边界应该这样理解:

- `agents/<cap>/*.md`
  - 角色。
  - 输入范围。
  - 输出 JSON schema。
  - 硬格式要求。
  - 不应该放人为风格和业务规则。

- `skills/*.md`
  - 人为可调规则。
  - 风格。
  - 红线。
  - 选择偏好。
  - 重试纠正语。

- `skills/replies/*.md`
  - talk fallback。
  - 默认回复。

已经不存在的独立文件:

- `json_only.md`
- `persona.md`
- `privacy.md`

对应职责现在分别是:

- 严格 JSON:写在各 agent contract md 的硬输出格式里。
- persona:不再作为全局注入。
- privacy:主要由 schema strict、日志 redact、prompt payload 构造边界保证。

## 17. 模型调用点

| 模块 | Provider | 用途 | 失败行为 |
|---|---|---|---|
| `image_understanding` | vision slot, Ark/OpenAI | 章节/图片描述 | analyze failed |
| `gemini_layout` | select-layout slot | Stage2 模板/slots 意图 | 局部 fallback skeleton |
| `editing` layout swap | select-layout slot | case4-swap 换版意图 | route error |
| `writing` | DeepSeek | chapter-chat talk/write/edit | route error |
| `page_edit` intent | DeepSeek | 聚焦页意图路由 | safe talk |
| `page_edit` edit_text | DeepSeek | 聚焦页文字改写 | safe talk |
| `image_edit_intent` | vision slot | 图片编辑 photoIds 选择 | None -> talk |
| `theme_recommend` | DeepSeek | 3 组主题选项 | route error |
| `cover_v3` copy | DeepSeek | 封面/封尾短文案 | clarification/empty fallback |
| `cover_v3` color | DeepSeek | 封面强调色 | extracted/neutral fallback |

纯确定性、不调模型:

- `image_grouping`
- `regroup_unplaced`
- `skeleton_v3`
- `generic_copy`
- `apply_theme_v3`
- `finalize_v3`

## 18. 状态和数据归属

Web 拥有:

- album draft。
- stage。
- 页面合并。
- 最终持久化。
- 浏览器侧照片引用。

Agent 通常只算结果并返回 patch。

Agent 自己持久化的只有:

- `agent.edit_sessions`
- `agent.edit_ops`
- `agent.edit_messages`

这些表只服务 `/v3/edit-chat` 与 `/internal/agent-ack`:

1. `edit-chat` 开始 turn 时写 `inFlight`。
2. `edit-chat` 结束时写 pending op/messages。
3. Web ack 后 Agent 把 op/messages committed。
4. ack 清掉匹配 turnId 的 `inFlight`。
5. turn 卡死超过 5 分钟后视为 stale,允许新 turn 抢占。

## 19. 现在复杂和分散的具体原因

这不是用户原始设计天然需要这么复杂,而是当前代码里确实存在多套能力面并存。

### 19.1 编辑入口重叠

当前有三条都能“编辑故事/页面”的入口:

- `/v3/edit-chat`
  - 有 albumId。
  - 有 Agent DB。
  - 会去 Web 拉上下文。
  - 返回 opId。
  - 需要 ack。

- `/v3/chapter-chat`
  - 无状态。
  - 请求里必须带完整上下文。
  - 一次 DeepSeek 同时做 talk/write/edit。

- `/v3/page-edit`
  - 无状态。
  - 只处理 focused page。
  - 两段模型调用。
  - 失败安全 talk。

它们的能力有交集,但调用契约、失败行为、状态边界不同。这是当前最主要的散点。

### 19.2 Layout 能力分布在多处

layout 相关逻辑分散在:

- `flows/select_layout.py`:初始化排版。
- `engine/gemini_layout.py`:模型布局意图和合法化。
- `engine/skeleton_v3.py`:确定性 fallback 和图片分配。
- `agents/editing/handler.py`:edit-chat 的 layout swap。
- `agents/page_edit/handler.py`:page-edit 的 deterministic change_layout。
- `agents/image_edit_intent/handler.py`:图片编辑后的重新选模板。

这些都在改 template/images/page patch,但入口和意图来源不同。

### 19.3 文案能力也分两层

文案相关逻辑分散在:

- `generic_copy`:初始化预览的 code-filled decoration。
- `writing`:章节正式文案。
- `page_edit`:聚焦页文字改写。
- `cover_v3`:封面/封尾短文案。
- `apply_theme_v3`:空 title 写 subject。

它们都写 `Page.texts`,但每一类 text 的所有权不同。

### 19.4 Prompt 资产刚从 prompts 改到 skills

现在已经没有 `src/prompts` 顶层目录,但代码和文档仍能看到迁移痕迹:

- handler 注释里还在解释旧 prompt / skill 边界。
- 测试里有结构保护。
- agent md 和 skill md 的职责还需要继续收窄,否则容易再次把规则写回 agents。

## 20. 当前实际运行图

```text
Browser/Web
  |
  | POST /v3/analyze
  v
Agent analyze flow
  -> image_grouping          (code)
  -> image_understanding     (vision model)
  -> regroup_unplaced        (code)
  -> callback tree

Browser/Web
  |
  | POST /v3/select-layout
  v
Agent select-layout flow
  -> gemini_layout           (layout model)
  -> legalize_layout         (code)
  -> skeleton fallback       (code)
  -> wrap cover/ending       (code)
  -> generic copy            (code)
  -> callback pages

Browser/Web
  |
  | POST /v3/edit-chat
  v
Agent edit-chat
  -> begin serialized turn   (agent DB)
  -> Web agent-data          (internal HTTP)
  -> confirm / layout swap / chapter_chat
  -> create pending op       (agent DB)
  -> return opId
  |
  | POST /internal/agent-ack
  v
Agent ack
  -> commit op/messages      (agent DB)
  -> clear inFlight

Browser/Web
  |
  | POST /v3/recommend
  v
DeepSeek -> 3 bookThemeOptions

Browser/Web
  |
  | POST /v3/apply-theme
  v
deterministic theme patch

Browser/Web
  |
  | POST /v3/cover
  v
optional cover/ending copy/color + deterministic patch

Browser/Web
  |
  | POST /v3/finalize
  v
deterministic AlbumLayoutPlan + validate_v3
```

## 21. 如果按更简单设计收口,需要先确认的边界

本文不直接改代码,但从当前实际逻辑看,后续如果要把 Agent 收回到更简单的结构,最先需要确认:

1. 三条编辑入口是否都保留。
2. 如果只保留一条主入口,是保留 `edit-chat` 这种有状态 op/ack 模式,还是保留无状态 request/patch 模式。
3. layout swap、page change_layout、image edit 重新排版是否合并到同一个 layout service。
4. cover 文案/颜色是否应该继续作为 Agent LLM seam,还是变成纯确定性/用户输入。
5. `agents/*.md` 是否要继续清理到只剩输入输出契约,把剩余人为规则全部迁到 `skills/*.md`。
