# Stage 3 — 编辑对话(有状态小型 agent loop)详细设计

- 日期:2026-06-26
- 状态:详设待 boss 确认(确认后开工)
- 归属:蓝图 §7 的展开。altitude=接口/会话 schema/loop 控制/提交协议,**不含 prompt/算法/token**。
- 边界声明:`gemini_layout` / `skeleton_v3` / `finalize_color` / 简易 id 映射 / Web 记录相册 / **agent-DB 约定(同实例独立 schema + Alembic)** 均归「共享板块」,本文档**只引用、不重设**(标★引用处)。

## 锁定决策(本设计遵循)
1. 合并成**一个**编辑 agent(现 `writing/handler` + `page_edit/handler` 二合一),新模块 `agents/editing/`。
2. **有状态 agent,有自己的库**:会话 / 对话 / 操作存 **agent 自己的表**,放在**与 Web 同一 Postgres 实例、独立 schema(`agent`)**;agent 用 **Alembic 自管迁移**,Web drizzle **不碰**这个 schema(★ agent-DB 约定见共享板块)。§8.3「Agent 无状态」不变式在本环节作废。
3. 单次请求内**多步 loop**(DeepSeek 决策 → 调工具 → 调 Gemini → 再决策);采用 function-calling(`ai_client` 已有 `tools`/`tool_choice`/`extract_tool_calls` infra),**分批设计:先锁信封,内部后置**。
4. **AI 决定 · Agent 提交 · Web 记录**,落法细化(见 §3):
   - **agent 写自己库**:会话 / 对话 / 操作(对话是 agent 的数据)。
   - **相册数据的改动**(layout patches、progress 决策)仍以 **CommitBundle 返回给 Web**,Web 单写 Web 库(相册数据 Web 单写)。
   - 两库各自单写、互不混。
5. **渐进加载**:初始上下文最小,T1/T2 读工具回 Web 取相册数据;**T-history 从 agent 自有库读**(不经 /internal/agent-data)。
6. 4 case(写章 / 页改写 / 换图 / 换版式),case4 复用 Stage2 `gemini_layout`(可加页)+ 4 工具。
7. AI 按需看历史(T-history 走 agent 库)。

## 1. 单轮 loop 生命周期(新端点 `POST /v3/edit-chat`,并掉 chapter-chat + page-edit)
```
Web(相册库事务):findOwned → POST /v3/edit-chat
     body={albumId, language, userMessage, focus{chapterId?,pageIndex?}}
     (★不再 inline 会话信封;会话归 agent 库)
Agent(一次请求,多步 loop,总预算 <58s):
  ── 载入会话(agent 库):SELECT … FOR UPDATE on agent.edit_session WHERE album_id=?
  ──            无则 seed(version=0,cursor 从 Web progress 投影派生 —— 见 §4)
  loop:
    DeepSeek(tools=[T1..T4], tool_choice=auto)
      有 tool_calls → 读工具(T1/T2 回 Web 取相册数据;T-history 读 agent 库)
                      / 写工具(T3/T4 产已校验 patch,暂存于 loop 内存)→ 续 loop
      无 tool_calls → 最终 JSON(reply + case1/2 文本内容 + progressDecision),break
    步数上限 N(~6)/ 58s 超时 → 安全降级 talk(沿用现有降级)
  ── 写 agent 库(同一事务):
       插 agent.edit_message(user + assistant 各一行)
       插 agent.edit_op[](本轮每个已提交动作一行)
       更新 agent.edit_session(cursor / 计数,version+1)
       提交 agent 库事务
  组装 CommitBundle{kind, assistantReply, patches[], pagesTexts?, progressDecision, usage}
  返回(★相册数据的改动只在 bundle 里,agent 不写 Web 库)
Web 记录(相册库事务):应用 patches→draft_json.pages;progressDecision→progress + stage
  (★Web 不再写会话/消息;那些已在 agent 库)
```
终止三闸:模型无 tool_calls / 步数上限 / 58s 超时(降级 talk)。
**两库各自的事务边界独立**:agent 先落自己库(对话/操作是它的真相),Web 收到 bundle 后落相册库。崩溃语义见 §3。

## 2. 会话对象 + agent 库表
**会话存 draft_json 里没有的「对话 / loop 状态」**(draft_json.pages/tree 仍是布局/文本唯一真相,T1/T2 取)。

会话载体(agent 内,持久到 `agent.edit_session.session_json`):
- `focus{chapterId,pageIndex?}` —— 本轮聚焦(请求带入,回写当前态)。
- `cursor{currentChapterId,doneChapterIds[]}` —— **工作 cursor**;**Web `draft_json.progress` 才是权威投影**(§4)。seed 时从 Web progress 派生。
- `accumulatedDecisions[]` —— 本会话已提交动作摘要(轻量,详单在 `agent.edit_op`)。
- `pendingClarification?`、step/telemetry 计数。
- **不存**:页布局/文本/图(draft_json,T1)、章节树/场景描述(T1/T2)、完整对话(在 `agent.edit_message`,T-history 读)。

### agent schema 表(★ 骨架,字段细化与索引归共享 agent-DB 约定;此处只定形状)
```
-- 会话:1 album 1 行
agent.edit_session
  id            pk
  album_id      text  unique            -- 与 Web albums.id 同值(逻辑外键,跨 schema 不设 FK 约束)
  version       int                      -- 乐观锁 / checkpoint 计数
  session_json  jsonb                    -- 上面的会话载体
  created_at / updated_at

-- 对话:每轮 user / assistant 各一行(T-history 的真相源)
agent.edit_message
  id            pk
  album_id      text                     -- 索引(album_id, chapter_id, created_at)
  chapter_id    text  null               -- focus 章;null=非章作用域
  role          text                     -- 'user' | 'assistant'
  content       text
  usage_json    jsonb null               -- assistant 行的 token/耗时
  created_at

-- 操作:每个已提交动作一行(审计 / 可回放,不是相册真相)
agent.edit_op
  id            pk
  album_id      text                     -- 索引(album_id, created_at)
  session_id    fk → agent.edit_session
  case_kind     text                     -- 'write_chapter'|'edit_text'|'swap_image'|'swap_layout'
  tool          text  null               -- 'T3'|'T4'|null(case1/2 无工具)
  summary_json  jsonb                    -- 提交的 patch 摘要 + progressDecision(审计快照)
  created_at
```
- **加载**:agent 开事务行锁(`FOR UPDATE`)载入 `edit_session`;无则 seed(version=0,cursor 从请求随带的 Web progress 投影派生 —— 见 §6 契约)。
- **checkpoint**:与插 message/op **同一 agent 事务**写回 `session_json`、version+1(原子;崩了什么都不留→重试即可)。
- **并发**:同 album 两请求用 agent 库行锁串行,version 乐观兜底(仿 Web `transitionStatus` CAS)。

## 3. 提交协议(AI 决定 · Agent 提交 · Web 记录)— 两库各写什么
| 角色 | 拥有 | 写哪个库 | 边界 |
|---|---|---|---|
| AI | 决定动作 + 章/页是否完成(`progressDecision`) | — | 出意图 + 最终内容,不碰任何 DB |
| Agent(loop) | 提交=产出**已定稿、已校验**的 CommitBundle | **agent 库**:会话 / 对话 / 操作 | 写自己库;相册数据的改动**只放进 bundle**,不直写 Web 库 |
| Web | 记录=持久化相册数据的改动 | **Web 库**:draft_json.pages / progress / stage | 相册数据唯一写入者;管归属 / 积分 / 锁 |

**两库各自单写,互不混**:
- 对话 / 会话 / 操作日志是 **agent 的数据** → agent 单写 agent schema。
- 相册数据(布局 patch、章节完成进度)是 **Web 的数据** → Web 单写 Web 库,agent 只经 bundle 投递。

**崩溃语义(两阶段、无分布式事务)**:agent 库事务先于返回提交。若 Web 记录相册失败 / 浏览器没收到:agent 库会多出一条「已提交但相册未落」的 op,但**相册数据未被污染**(Web 没写)。下次同 album 请求载入会话时,Web 随带的 progress 投影是相册真相 —— cursor 据它对齐,漂移自愈;assistant 多记的一轮对话是无害冗余(T-history 容忍)。**相册数据永远以 Web 库为准**,会话/对话以 agent 库为准。

- **`markChapterDone` 删除**(不再是用户按钮):逻辑并入 `editChatTurn`。章/页完成=AI 决定(`progressDecision`,用现有 `page_filled`/`chapter_completion` 当判据喂模型确认)。
- **Web 仍写 stage**:`progressDecision.advanceTo` 触发 `story→theme` + 解锁导出(原 `markChapterDone` 逻辑,改由 bundle 触发);`storyProgressFrom`/`assertStoryExportUnlocked`/finalize 不变(progress 作 Web 持久投影,导出/finalize 不动 —— §4 #4=A)。

## 4. 进度真相(#4 = 方案 A)
- `draft_json.progress`(Web 库)= **权威投影**,导出 / finalize 链路只认它(`storyProgressFrom`/`assertStoryExportUnlocked` 不变)。
- agent 会话里有**工作 cursor**(`session_json.cursor`),仅供 loop 内决策用,**不是真相**。
- 流向:AI 决定 `progressDecision{pageDone?,chapterDone?,advanceTo?}` → 进 bundle → **Web 记录进 `draft_json.progress` + `albums.stage`**;agent 同时把 cursor checkpoint 进会话(下轮自洽)。
- seed 对齐:agent 载入会话(或 seed)时以 Web 随带的 progress 投影校 cursor —— Web 永远赢。

## 5. 工具(信封锁定,内部分批)— 经 `ai_client` tools/tool_choice 声明
读工具回 Web 取相册数据(T1/T2)或读 agent 库(T-history);写工具产校验过的 patch。
- **T1 页面信息(读)** `args{scope:page|chapter,chapterId,pageIndex?}` → 页/章布局 + 文本 + 场景 + completion(替代现在 inline 推 pages/sceneBackground);所有 case 先用。**回 Web 取**(`/internal/agent-data?type=page-info`)。
- **T2 分章检索(读)** `args{query,limit?}` → `{matches:[{chapterId,pageIndexes,label,score}]}`;定位模糊目标。**回 Web 取**(`type=chapter-search`)。
- **T3 版内换图(写)** `args{pageIndex,photoIds[]}` → `{ok,patch{pageIndex,templateId,images,texts}}`;复用 `image_edit_intent` + `skeleton_v3`(★)。case3。
- **T4 换版式(写,可加页)** `args{chapterId,scope,pageIndex?,hint?,allowAddPages}` → `{ok,patch[](可含新页)}`;复用 Stage2 `gemini_layout(mode:"case4-swap",allowAddPages)` + `skeleton_v3` 兜底(★)。case4。
- **T-history(读,可选)** `args{chapterId?,limit?}` → 近 N 轮。**读 agent 库**(`agent.edit_message`,不走 /internal/agent-data —— 对话是 agent 的数据)。
- **case1/2 不是工具**:写章(`pagesTexts`)/ 页改写(`texts`)是模型**最终消息内容**(复用 `_coerce_pages_texts`/`_clean_texts` 钳裁),无需回调/引擎,做工具反而多一跳。

## 6. case ↔ 工具
| case | 工具 | 最终内容 | 引擎 | 落点 |
|---|---|---|---|---|
| 写章故事 | T1,T2,T-history | pagesTexts | 文本钳裁 | bundle.pagesTexts → Web |
| 页改写 | T1 | 单页 texts | 文本钳裁 | bundle.patches → Web |
| 换图 | T1,**T3** | reply | image_edit_intent + skeleton_v3(★) | bundle.patches → Web |
| 换版式 | T1,**T4** | reply | **gemini_layout**(★) + skeleton_v3(★) | bundle.patches(可含新页)→ Web |

case4 复用蓝图 §5 的 `gemini_layout` 签名(加 `mode/allowAddPages`,★ 由 gemini 板块定);**加页**:gemini 返回的 `Page[]` 可超输入页数 → bundle 多 entry patch → **扩展 `applyLayoutPatchToDraftPages` 支持 append 新尾页**(守页序稳定,既有 index 不动)。

## 7. 契约变更
- 新 `POST /v3/edit-chat` 取代 `/v3/chapter-chat` + `/v3/page-edit`;新模块 `agents/editing/`。
- `V3EditChatRequest{albumId, language, userMessage, focus{chapterId?,pageIndex?}, progress}`
  - ★**不再 inline** chapter / pages / history / 会话信封:相册数据工具取,会话归 agent 库,history 读 agent 库。
  - `progress`:Web 把权威 progress 投影随请求带入,供 agent seed/对齐 cursor(只读,Web 仍是真相)。
- `V3EditChatResponse(CommitBundle){kind, assistantReply, patches:V3LayoutPatchEntry[], pagesTexts?, progressDecision{pageDone?,chapterDone?,advanceTo?}, usage}`
  - ★**不含** sessionDelta:会话由 agent 自己库 checkpoint,不回传 Web。
- 废:`V3ChapterChat*` / `V3PageEdit*` / `advanceIntent`;留用 `V3LayoutPatchEntry` / `V3PageTextsPatch`。`V3ChatTurn` 仍用于 T-history 内部形状。
- **Agent→Web 读回调** `GET /internal/agent-data?type=page-info|chapter-search`(同一 shared bearer;Web 服务端从 draft_json 重切,复用 `sliceChapterForChat` 等;树不经浏览器)。**注意:`type=history` 取消** —— 历史改读 agent 自有库。
- **agent 库**:新 schema `agent` + `edit_session`/`edit_message`/`edit_op` 三表 + **Alembic 迁移(agent 自管)**(★ 约定见共享 agent-DB 板块)。Web drizzle / migration **零改动**。`draft_json.progress` 作 Web 投影保留;`markChapterDone` 删,逻辑并入 `editChatTurn`。

## 8. 迁移(二合一 + 落 agent 库,不丢行为)
- `writing` 的 talk/write/edit-text + image-edit(→T3)全保留;`page_edit` 的 intent 路由删(由 `tool_choice` 取代),`edit_text` 并入页改写,`change_layout` 并入 T4(其确定性 pick 作 T4 无模型兜底),`advance`→`progressDecision`。
- `page_filled`/`chapter_completion` 留作完成判据;两模块塌缩进 `agents/editing/`;`image_edit_intent` + `gemini_layout`(template_select)作引擎依赖挂成 T3/T4。
- **新增 agent DB 层**:agent 进程接 Postgres(同实例,`search_path=agent` 或 schema 限定)、Alembic init + 三表首迁移、`edit_session`/`edit_message`/`edit_op` repo(★ 连接/迁移/repo 骨架归共享 agent-DB 板块;本环节只消费)。
- **Web 侧**:`chapterChatTurn`/`pageEdit` 路由二合一为 `editChatTurn`(只做 findOwned → 取 progress 投影 → 调 `/v3/edit-chat` → 收 bundle → 应用 patches + progress/stage);**删** `markChapterDone` 及其路由;**删** Web 持久化对话/会话的代码路径(`albumMessageRepo.create` 在 edit-chat 路径上移除,对话改由 agent 库存)。

## 9. 待 boss 确认(架构师推荐已给)
1. agent 库连接:**复用 Web 的 Postgres 实例 + 独立 `agent` schema + Alembic**(★ 共享板块拍)。✅?
2. 会话并发:**agent 库行锁串行 + version 乐观兜底**(同 album 第二请求阻塞等第一提交)。✅?或 409 拒第二?
3. 两库崩溃语义:**agent 先落、Web 后落,相册以 Web 为准、对话以 agent 为准,cursor 自愈**(§3)。✅?
4. 历史窗口:T-history 默认 limit=20/章?会话存不存「旧轮滚动摘要」?
5. case4 加页:扩 `applyLayoutPatchToDraftPages` 支持 append;每轮加页上限?
6. loop 步数上限 ~6 + 58s 预算拆分(算法层,后定)。
7. 端点切换:硬替换 vs 旧路由留薄 shim 过渡?

## 边界点(★ 引用共享板块,本环节不重设)
- **消费 `gemini_layout`(`mode:"case4-swap"`/`allowAddPages`)+ `skeleton_v3`**:case4/case3 引擎,由 gemini 排版板块定义。
- **agent-DB 约定**(同 Postgres 实例 + `agent` schema + Alembic 自管迁移 + 连接/repo 骨架):由共享板块定义,本环节只建 `edit_session`/`edit_message`/`edit_op` 三表并消费连接层。
- **Web 记录相册**(draft_json.pages / progress / stage 的单写、归属 / 积分 / 锁):由 Web 分层(album-service)拥有。
- `finalize_color` / 简易 id 映射:共享板块,本环节不触及。

## 关键文件
`agents/writing/handler.py` · `agents/page_edit/handler.py` · `agents/image_edit_intent/handler.py` · `web album-service.ts`(`editChatTurn` 二合一、删 `markChapterDone`、删对话持久化)· `packages/contracts/v3.ts`(+ `ai_client.py`(tools/tool_choice/extract_tool_calls)· `skeleton_v3` · `gemini_layout` · `internal/agent-data` callback · `agent-client.ts` · **新 agent DB 层 + Alembic + edit_session/message/op repo**)
