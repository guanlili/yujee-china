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
  ── 载入会话(agent 库):SELECT … FOR UPDATE on agent.edit_sessions WHERE album_id=?
  ──            无则 seed(version=0,cursor 从 Web progress 投影派生 —— 见 §4)
  loop:
    DeepSeek(tools=[T1..T4], tool_choice=auto)
      有 tool_calls → 读工具(T1/T2 回 Web 取相册数据;T-history 读 agent 库)
                      / 写工具(T3/T4 产已校验 patch,暂存于 loop 内存)→ 续 loop
      无 tool_calls → 最终 JSON(reply + case1/2 文本内容 + progressDecision),break
    步数上限 N(~6)/ 58s 超时 → 安全降级 talk(沿用现有降级)
  ── 写 agent 库(同一事务):
       插 agent.edit_messages(user + assistant 各一行,status='pending')
       插 agent.edit_ops[](本轮每个动作一行,opId 生成,status='pending')
       更新 agent.edit_sessions(cursor / 计数,version+1)
       提交 agent 库事务
  组装 CommitBundle{kind, assistantReply, patches[], pagesTexts?, progressDecision, opId, usage}
  返回(★相册数据的改动只在 bundle 里,agent 不写 Web 库)
Web 记录(相册库事务):应用 patches + pagesTexts→draft_json.pages;progressDecision→progress + stage
  → 落库成功后 POST /internal/agent-ack {opId}(★agent 把该 op + 关联 message 转 status='committed')
  (★Web 不再写会话/消息;那些已在 agent 库)
```
终止三闸:模型无 tool_calls / 步数上限 / 58s 超时(降级 talk)。
**两库各自的事务边界独立**:agent 先落自己库(对话/操作是它的真相),Web 收到 bundle 后落相册库。崩溃语义见 §3。

## 2. 会话对象 + agent 库表
**会话存 draft_json 里没有的「对话 / loop 状态」**(draft_json.pages/tree 仍是布局/文本唯一真相,T1/T2 取)。

会话载体(agent 内,持久到 `agent.edit_sessions.session_json`):
- `focus{chapterId,pageIndex?}` —— 本轮聚焦(请求带入,回写当前态)。
- `cursor{currentChapterId,doneChapterIds[]}` —— **工作 cursor**;**Web `draft_json.progress` 才是权威投影**(§4)。seed 时从 Web progress 派生。
- `accumulatedDecisions[]` —— 本会话已提交动作摘要(轻量,详单在 `agent.edit_ops`)。
- `pendingClarification?`、step/telemetry 计数。
- **不存**:页布局/文本/图(draft_json,T1)、章节树/场景描述(T1/T2)、完整对话(在 `agent.edit_messages`,T-history 读)。

### agent schema 表(★ 骨架,字段细化与索引归共享 agent-DB 约定;此处只定形状)
```
-- 会话:1 album 1 行
agent.edit_sessions
  id            pk
  album_id      text  unique            -- 与 Web albums.id 同值(逻辑外键,跨 schema 不设 FK 约束)
  version       int                      -- 乐观锁 / checkpoint 计数
  session_json  jsonb                    -- 上面的会话载体
  created_at / updated_at

-- 对话:每轮 user / assistant 各一行(T-history 的真相源)
agent.edit_messages
  id            pk
  op_id         text  null               -- ★关联本轮 edit_ops.op_id(纯 talk 轮可空);用于 ack 时连同转 committed
  album_id      text                     -- 索引(album_id, chapter_id, status, created_at)
  chapter_id    text  null               -- focus 章;null=非章作用域
  role          text                     -- 'user' | 'assistant'
  content       text
  status        text  not null           -- ★'pending'|'committed';T-history 只读 committed(见 §3/§5)
  usage_json    jsonb null               -- assistant 行的 token/耗时
  created_at

-- 操作:每个已提交动作一行(审计 / 可回放,不是相册真相)
agent.edit_ops
  id            pk
  op_id         text  unique not null     -- ★稳定 opId(agent 生成,放进 bundle;Web ack 据此回销)
  album_id      text                     -- 索引(album_id, status, created_at)
  session_id    fk → agent.edit_sessions
  case_kind     text                     -- 'write_chapter'|'edit_text'|'swap_image'|'swap_layout'
  tool          text  null               -- 'T3'|'T4'|null(case1/2 无工具)
  status        text  not null           -- ★'pending'|'committed';agent 落库时 'pending',Web ack 后转 'committed'
  summary_json  jsonb                    -- 提交的 patch 摘要 + progressDecision(审计快照)
  created_at
```
- **★opId + status(B4 弱一致收敛)**:agent 落 `edit_ops` 时 `status='pending'` 并把 `op_id` 放进 `CommitBundle`;Web 单事务落相册成功后回调 `POST /internal/agent-ack {opId}`(§7 / 共享板块 §4),agent 据 `op_id` 把该行转 `status='committed'`。**T-history / 喂模型上下文只读 `status='committed'` 的对话/操作**,`pending`(相册未确认落库)不入模型上下文 → 杜绝"AI 看见自己声称做过、但相册其实没落"的历史污染。
- **加载**:agent 开事务行锁(`FOR UPDATE`)载入 `edit_sessions`;无则 seed(version=0,cursor 从请求随带的 Web progress 投影派生 —— 见 §6 契约)。
- **checkpoint**:与插 message/op **同一 agent 事务**写回 `session_json`、version+1(原子;崩了什么都不留→重试即可)。
- **并发**:同 album 两请求用 agent 库行锁串行,version 乐观兜底(仿 Web `transitionStatus` CAS)。

## 3. 提交协议(AI 决定 · Agent 提交 · Web 记录)— 两库各写什么
| 角色 | 拥有 | 写哪个库 | 边界 |
|---|---|---|---|
| AI | 决定动作 + 章/页是否完成(`progressDecision`) | — | 出意图 + 最终内容,不碰任何 DB |
| Agent(loop) | 提交=产出**已定稿、已校验**的 CommitBundle | **agent 库**:会话 / 对话 / 操作 | 写自己库;相册数据的改动**只放进 bundle**,不直写 Web 库 |
| Web | 记录=持久化相册数据的改动(**patches + pagesTexts** → draft_json.pages) | **Web 库**:draft_json.pages / progress / stage | 相册数据唯一写入者;管归属 / 积分 / 锁 |

**两库各自单写,互不混**:
- 对话 / 会话 / 操作日志是 **agent 的数据** → agent 单写 agent schema。
- 相册数据(布局 patch、章节完成进度)是 **Web 的数据** → Web 单写 Web 库,agent 只经 bundle 投递。

**崩溃语义(两阶段、无分布式事务,★opId+status+ack 收敛)**:agent 库事务先于返回提交,落库时 op + message 均 `status='pending'`。Web 单事务落相册成功后回调 `POST /internal/agent-ack {opId}`,agent 据 `opId` 把该 op + 关联 message 转 `committed`。
- 若 Web 记录相册失败 / 浏览器没收到 / ack 没回:agent 库那条 op + message **停留在 `pending`**,**相册数据未被污染**(Web 没写)。
- **T-history / 喂模型上下文只读 `committed`**:`pending` 的对话/操作**不进模型上下文**,故 AI 永远不会"看见自己声称做过、但相册其实没落"的轮次 —— 杜绝弱一致下的历史污染(原"无害冗余"口径升级为"committed-gate 硬隔离")。
- 下次同 album 请求载入会话时,Web 随带的 progress 投影是相册真相,cursor 据它对齐,漂移自愈;遗留 `pending` 行可按 TTL / 下次 ack 清理(实现期定)。
**相册数据永远以 Web 库为准**,会话/对话以 agent 库**已 committed** 部分为准。

- **`markChapterDone` 删除**(不再是用户按钮):逻辑并入 `editChatTurn`。章/页完成=AI 决定(`progressDecision`,用现有 `page_filled`/`chapter_completion` 当判据喂模型确认)。
- **Web 仍写 stage**:`progressDecision.advanceTo` 触发 `story→theme` + 解锁导出(原 `markChapterDone` 逻辑,改由 bundle 触发);`storyProgressFrom`/`assertStoryExportUnlocked`/finalize 不变(progress 作 Web 持久投影,导出/finalize 不动 —— §4 #4=A)。

## 4. 进度真相(#4 = 方案 A)
- `draft_json.progress`(Web 库)= **权威投影**,导出 / finalize 链路只认它(`storyProgressFrom`/`assertStoryExportUnlocked` 不变)。
- agent 会话里有**工作 cursor**(`session_json.cursor`),仅供 loop 内决策用,**不是真相**。
- 流向:AI 决定 `progressDecision` → 进 bundle → **Web 记录进 `draft_json.progress` + `albums.stage`**;agent 同时把 cursor checkpoint 进会话(下轮自洽)。
- seed 对齐:agent 载入会话(或 seed)时以 Web 随带的 progress 投影校 cursor —— Web 永远赢。

### 4.1 `progressDecision` schema(★锁定,对齐 `V3StoryProgress`)
```
progressDecision {
  pageDone?:    bool                     # 当前 focus 页是否写满/完成(用 page_filled 判据,模型确认)
  chapterDone?: bool                     # 当前 focus 章是否完成(用 chapter_completion 判据,模型确认)
  advanceTo?:   'theme' | null           # 仅 'theme' 或缺省/null;非 null 表示请求推进到 theme 环节
}
```
**映射(Web 记录步骤据此写库)** —— `V3StoryProgress = {currentChapterId, doneChapterIds[]}`(`packages/contracts/src/v3.ts`,无 `pageDone`/`stage` 字段):
- `pageDone`:**不进 `V3StoryProgress`**(后者无页级字段)。仅作 loop 内 cursor / 解锁判据的输入,Web 不持久化页级 done;若需页级完成态,落 `draft_json.pages[].completion`(既有页级判据),不动 `progress`。
- `chapterDone=true`:Web 把当前 `focus.chapterId` **并入 `progress.doneChapterIds`**,并按章序把 `progress.currentChapterId` 推到下一未完成章(全完成 → `null`),沿用现 `markChapterDone` 的 `storyProgressFrom` 推进逻辑。
- `advanceTo='theme'`:Web 把 `albums.stage` 由 `story` 推进到 `theme` + 解锁导出(原 `markChapterDone` 的 stage 推进路径);`advanceTo` 缺省/`null` 时不动 stage。`stage ⟂ V3StoryProgress`(stage 是列、progress 是 draft 旁挂投影),两者分别写。
- 非法/缺省:三字段皆可缺省(纯 talk 轮 = 全缺省,progress/stage 零改动)。

## 5. 工具(信封锁定,内部分批)— 经 `ai_client` tools/tool_choice 声明
读工具回 Web 取相册数据(T1/T2)或读 agent 库(T-history);写工具产校验过的 patch。
- **T1 页面信息(读)** `args{scope:page|chapter,chapterId,pageIndex?}` → 页/章布局 + 文本 + 场景 + completion(替代现在 inline 推 pages/sceneBackground);所有 case 先用。**回 Web 取**(`/internal/agent-data?type=page-info`)。
- **T2 分章检索(读)** `args{query,limit?}` → `{matches:[{chapterId,pageIndexes,label,score}]}`;定位模糊目标。**回 Web 取**(`type=chapter-search`)。
- **T3 版内换图(写)** `args{pageIndex,photoIds[]}` → `{ok,patch{pageIndex,templateId,images,texts}}`;复用 `image_edit_intent` + `skeleton_v3`(★)。case3。
- **T4 换版式(写,可加页)** `args{chapterId,scope,pageIndex?,hint?,allowAddPages}` → `{ok,patch[](可含新页)}`;复用 Stage2 `gemini_layout(mode:"case4-swap",allowAddPages)` + `skeleton_v3` 兜底(★)。case4。★**200px 来源**:T4 触发时 agent 经 `GET /internal/agent-data?type=page-photos`(共享板块 §4.3)读回该章 200px 喂 `gemini_layout`(edit-chat 请求体本身不带 base64;协议定死,B2 收敛)。
- **T-history(读,可选)** `args{chapterId?,limit?}` → 近 N 轮。**读 agent 库**(`agent.edit_messages`,不走 /internal/agent-data —— 对话是 agent 的数据)。★**只读 `status='committed'`**(pending 轮不入模型上下文,见 §3/§4.1 B4 收敛)。
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
- `V3EditChatResponse(CommitBundle){kind, assistantReply, patches:V3LayoutPatchEntry[], pagesTexts?, progressDecision{pageDone?:bool, chapterDone?:bool, advanceTo?:'theme'|null}, opId, usage}`(schema + 到 `V3StoryProgress`/`albums.stage` 的映射见 §4.1;`opId` 用于 Web 落库后 ack)
  - ★**新增 `opId`**:agent 生成的本轮稳定操作 id,Web 落相册成功后据它 ack(见下)。
- **★Web→Agent ack 回调** `POST /internal/agent-ack {opId}`(同一 shared bearer):Web 单事务落相册成功后调用,agent 据 `opId` 把 `edit_ops` + 关联 `edit_messages` 从 `pending` 转 `committed`(B4 弱一致收敛;T-history 只读 committed)。端点信封归共享板块(detail-shared §4)。
  - ★**不含** sessionDelta:会话由 agent 自己库 checkpoint,不回传 Web。
- 废:`V3ChapterChat*` / `V3PageEdit*` / `advanceIntent`;留用 `V3LayoutPatchEntry` / `V3PageTextsPatch`。`V3ChatTurn` 仍用于 T-history 内部形状。
- **Agent→Web 读回调** `GET /internal/agent-data?type=page-info|chapter-search|page-photos`(同一 shared bearer;Web 服务端从 draft_json 重切,复用 `sliceChapterForChat` 等;树不经浏览器)。★`page-photos` = case4 取该章 200px 喂 gemini_layout(B2,见共享板块 §4.3)。**注意:`type=history` 取消** —— 历史改读 agent 自有库。
- **agent 库**:新 schema `agent` + `edit_sessions`/`edit_messages`/`edit_ops` 三表 + **Alembic 迁移(agent 自管)**(★ 约定见共享 agent-DB 板块)。Web drizzle / migration **零改动**。`draft_json.progress` 作 Web 投影保留;`markChapterDone` 删,逻辑并入 `editChatTurn`。

## 8. 迁移(二合一 + 落 agent 库,不丢行为)
- `writing` 的 talk/write/edit-text + image-edit(→T3)全保留;`page_edit` 的 intent 路由删(由 `tool_choice` 取代),`edit_text` 并入页改写,`change_layout` 并入 T4(其确定性 pick 作 T4 无模型兜底),`advance`→`progressDecision`。
- `page_filled`/`chapter_completion` 留作完成判据;两模块塌缩进 `agents/editing/`;`image_edit_intent` + `gemini_layout`(template_select)作引擎依赖挂成 T3/T4。
- **新增 agent DB 层**:agent 进程接 Postgres(同实例,`search_path=agent` 或 schema 限定)、Alembic init + 三表首迁移、`edit_sessions`/`edit_messages`/`edit_ops` repo(★ 连接/迁移/repo 骨架归共享 agent-DB 板块;本环节只消费)。
- **Web 侧**:`chapterChatTurn`/`pageEdit` 路由二合一为 `editChatTurn`(只做 findOwned → 取 progress 投影 → 调 `/v3/edit-chat` → 收 bundle → 应用 **patches + pagesTexts** + progress/stage);**删** `markChapterDone` 及其路由;**删** Web 持久化对话/会话的代码路径(`albumMessageRepo.create` 在 edit-chat 路径上移除,对话改由 agent 库存)。

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
- **agent-DB 约定**(同 Postgres 实例 + `agent` schema + Alembic 自管迁移 + 连接/repo 骨架):由共享板块定义,本环节只建 `edit_sessions`/`edit_messages`/`edit_ops` 三表并消费连接层。
- **Web 记录相册**(draft_json.pages / progress / stage 的单写、归属 / 积分 / 锁):由 Web 分层(album-service)拥有。
- `finalize_color` / 简易 id 映射:共享板块,本环节不触及。

## 关键文件
`agents/writing/handler.py` · `agents/page_edit/handler.py` · `agents/image_edit_intent/handler.py` · `web album-service.ts`(`editChatTurn` 二合一、删 `markChapterDone`、删对话持久化)· `packages/contracts/v3.ts`(+ `ai_client.py`(tools/tool_choice/extract_tool_calls)· `skeleton_v3` · `gemini_layout` · `internal/agent-data` callback · `agent-client.ts` · **新 agent DB 层 + Alembic + edit_sessions/edit_messages/edit_ops repo**)
