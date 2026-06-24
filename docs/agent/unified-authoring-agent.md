# 提案:统一创作 agent(自主 agent + vision 工具,分步落地)

> 状态:**v2,已过架构师评审**。结论 **GO-with-changes**:方向对、核心简化(选版式纯文字)
> 成立;但"复用 analyze 异步管道"被严重低估(会损坏 draft/积分),异步成本远超提案估计。
> 据评审改为**渐进落地:第一刀同步收编「改图」验证 agent 核心,异步作为独立第二刀**。

## 0. 已定的方向

- **真 agent**:模型自主决定动作顺序,harness 只给引导 + 工具 + loop 控制 + 终止/护栏,
  **不是死流程**。否则"用户不满意某页→选版式→写文案→再调"这类任务无法闭环。
- **vision 作为按需工具**(用户拍板 + 评审 B4):创作大脑默认纯文字跑,**判断自己信息不够时
  (典型:换入一张 analyze 没描述过的新照片)自己调 `describe_photo(vision)` 工具补描述**,
  其余全程不碰 vision。这既保住"单文本大脑"的简化,又补上"新图抓瞎"的硬洞。
- **异步:确认要,但分步**。60s 同步是单次大调用的约束;真 agent 多跳确实需要异步。但
  评审证明"复用 analyze 管道"不成立(见 §3.1),异步要自带一整套新 job kind/契约/callback。
  所以**先在同步端点把 agent 核心(自主多动作 loop + vision 工具)跑起来验证品味,异步作为
  紧接着的第二刀**——两者解耦,先做核心。

## 1. 现状根因:同一件事有两套实现

"给一页排版 + 写文案"在系统里是两条不相干的代码路径,这是"初次/再次差距大 + 难维护"的根:

| | 选版式 | 写文案 |
|---|---|---|
| **初排** [analyze.py](../../apps/agent/src/flows/analyze.py) | 识图模型 [select_template](../../apps/agent/src/agents/template_select/handler.py) 从 legal candidates 挑(有品味) | 不写正式文案,只 generic 占位,留给章节故事 |
| **章节故事 write** [writing/handler.py](../../apps/agent/src/agents/writing/handler.py) | 不动版式 | DeepSeek 写整章 |
| **改图** [image_edit_intent](../../apps/agent/src/agents/image_edit_intent/handler.py) | 确定性引擎 `pick_template_v3` 取该容量**第一个**(无品味) | 不写;文字编辑是另一条 `editTarget=text` 死分支 |

三个入口、三套逻辑,还被 `editTarget=text/image` 二分锁死。改图的版式是机械 fallback,所以
你第一次拿到的"挑过的"版式,一改就降级。

## 2. 目标

一个**统一的创作能力**,初排 / 章节 write / 改某页都复用它:
- 模型**自主**判断:这次要不要动版式、改多大范围、文案怎么写——不再有 `editTarget` 死二分。
- 改版式回归**模型品味**(从 legal candidates 选),不再机械 fallback。
- **一套代码**:初次和再次走同一条路,差距消失,维护面收敛。

## 3. 架构

### 3.1 异步管道——**不能直接复用 analyze**(评审 B1/B2/B3)

异步本身要,但 analyze 的 callback 落库端是给"整册 init"写死的,改图复用会**损坏数据**:
- `handleV3AnalyzeCompleted`([job-service.ts:96](../../apps/web/src/services/job/job-service.ts))做的是
  **整册覆盖 draftJson + status→COMPLETED + stage→story + 结算积分 hold**。给"改某页"用会把整本
  draft 用单页 patch 覆盖、把 stage 打回 story、错误 settle 一笔积分。
- `agent_jobs.kind` 枚举只有 `['init','finalize','add']`,且有 `每 album+kind 一个活跃 job` 唯一索引
  —— authoring job 会和真 init 撞锁。
- 契约 `V3JobKind=['analyze']`、`V3JobStage=['describe','group','template','preview']`、
  `V3AnalyzeCompleted.pages.min(1)+tree` 全是**整册封闭形状**,装不下"页级 patch + reply"。

所以异步落地 = **新增 `kind='authoring'` + 一套 `V3AuthoringCompleted` 契约(payload=页级
layoutPatch[] + assistantReply + 聚合 usage)+ 独立 callback handler(只 merge 页级、不动
status/stage/credit)+ 处理乱序 callback**。这是一整套新东西,不是"参照 analyze"。**故异步列为
第二刀**(§7)。

### 3.2 单文本大脑 + vision 按需工具

创作 loop 的"大脑"= **单一文本决策模型**(DeepSeek 主 / OpenAI failover),默认基于**文字**:
- 选版式本就是文字判断 —— 已核实 [select_template](../../apps/agent/src/agents/template_select/handler.py)
  的输入只有 photoId + sceneDescription + 候选 id,**不看像素**(VisionSlot 只是复用 provider 配置槽)。
- 写文案是文字;存量照片的 sceneDescription 在 analyze 阶段已由 vision 产出(已 §3 redact)。

**例外(评审 B4 / 用户拍板):换入一张 analyze 没描述过的新照片时,大脑没有它的 sceneDescription
会抓瞎。** 解法:把 vision 做成一个**按需工具** `describe_photo(photoId)`,大脑判断"这张图我没描述、
选不了版式/写不了图注"时**自己调它**补一句场景描述(走 describe 的 §3 redact),其余全程纯文字。
这就是"vision 是工具、模型不够时自取",而非每次都调。

### 3.3 harness 驱动的 loop(不依赖原生 function calling)

harness(**用户来写引导部分**)提供:系统引导("怎么做好这件事")+ 一组工具 + loop 控制。
每轮:harness 喂【当前状态 + 可选动作】→ 模型出 `{action, args}` 的 JSON → harness 执行、
把结果喂回 → 循环,直到模型 `finish` 或触达步数/预算上限。

> **为什么 JSON-action 而非 provider 原生 FC**:上次架构师把 DeepSeek function calling 标为
> 未经生产验证的前置。harness 驱动的 JSON-action loop **绕开**这个依赖——它只需模型稳定吐
> JSON(现有路径已在用 `parse_json_loose` + json_object),不需要原生 tool_calls。这是更稳、
> 更可控、也更契合"我写 harness"的形态。

工具(确定性 + 一个 vision,均带护栏):
- `pick_layout(pageId, templateId)` — 模型从该页 **legal candidates** 里选(引擎暴露,
  防幻觉:选了非法 id 直接驳回重选)。复用 `skeleton_v3.legal_candidates`。
- `set_photos(pageId, [photoId...])` — 调整照片;引擎 `assign_images_v3` + `max_capacity` 保合法,
  超容量/幻觉 id 被钳。
- `write_texts(pageId, {slot: text})` — 写/改文案;按 maxChars + 槽位规格钳(复用 `_clean_texts`)。
- `describe_photo(photoId)` — **唯一的 vision 工具**:仅当大脑遇到无 sceneDescription 的(新换入)
  照片时自取,补一句场景描述(走 §3 redact)。默认不调。
- `finish(reply)` — 收尾,给用户一句回复。

> 护栏接缝**全是现成的**(评审 N2):legal_candidates / assign_images_v3 / max_capacity /
> `_clean_texts` / `page_slot_specs` 已存在且就是确定性校验。但 `_clean_texts` / `page_slot_specs`
> 现是 writing handler 私有,要**抽成共享工具模块**,否则三入口又各 import writing 造新耦合。

模型"自主"体现在:它决定调哪些工具、什么顺序、调几次(不满意自己再 `pick_layout`+`write_texts`),
harness 不写死。护栏体现在:每个工具的产出都过确定性校验,模型无法注入非法版式/槽位/越界文案。

### 3.4 统一三入口

- **初排**:对每页跑创作 agent(或轻量版:仅 pick_layout,文案留空)——取代 analyze 里
  select_template 那段。
- **章节 write**:对整章每页跑创作 agent(选版式确认 + 写文案)。
- **改某页**:对聚焦页跑创作 agent,模型自己判断改版式 / 改文案 / 换图 / 全改。
  **删掉** image_edit_intent 的机械 `pick_template_v3` 路径与 `editTarget` 二分。

## 4. 护栏与边界(不能因为"自主"就放掉)

- **版式合法**:只能从 legal candidates 选 + 引擎 assign,模型无法造非法版式(保留现有红线)。
- **隐私**:loop 输入只有文字(场景描述已 redact),无 base64 / GPS(§3 不变式不变)。
- **预算 + 终止**:loop 步数硬上限 + 后台 timeout;超限返回已得终态(已选版式/已写文案),
  绝不空手或杜撰。
- **state**:异步期间 / 完成时,把 patch 写回 draft_json —— 复用[第一步](chapter-chat-agent-loop.md)
  的回写 + 行级锁,适配 callback 落库。

## 5. 影响面

| 层 | 改动 |
|---|---|
| Agent flows | 新增 `flows/authoring.py`(创作 loop,复用 analyze 的 callback/timeout 骨架) |
| Agent agents | 新增创作 agent(大脑 + 工具);**收编** template_select / image_edit_intent / writing 的 write 逻辑;改图二分删除 |
| Agent harness | 系统引导 + 工具语义 + loop 策略(**用户负责**) |
| 契约 v3.ts | 章节创作从同步 → 异步:新增 accepted/callback 形状(参照 analyze);改图并入 |
| Web 状态机 | chapter 创作改异步:接 callback / 轮询 + draft_json 回写(扩第一步) |
| Web EditorPort | "生成中"态(已有 building 态可复用) |

## 6. 分工

- **用户**:写 harness 的引导 —— 系统 prompt("怎么做好一页/一章")、各工具的语义说明、
  loop 策略(何时该停、自检标准)。
- **我**:搭骨架 —— 异步管道、工具实现 + 确定性护栏、loop 控制/预算/终止、state 回写、
  契约 + Web 接入、收编旧三路径。

## 7. 落地顺序(渐进,据评审最终建议)

不做大爆炸替换。三刀,各自独立可发布:

**第一刀 — 同步收编「改图」(先做,验证 agent 核心)。**
把 image_edit_intent 的机械 `pick_template_v3` 升级成"模型从 legal candidates 选版式 + set_photos
+ write_texts + 按需 describe_photo"的**多动作小 loop**,跑在**现有 60s 同步端点**里(1–2 跳,评审
测算安全)。**完全不碰 agent_jobs / 契约 / callback / 积分**。这一刀就让"改图版式回归品味 + 文图统一
不再 editTarget 二分",收益最大、风险趋零、可独立发布。agent 的大脑/工具/自主 loop 形态在这里成型。

**第二刀 — 异步(仅当第一刀实测嫌慢才做)。**
吃 §3.1 的全部成本:`kind='authoring'` + `V3AuthoringCompleted` 契约 + 独立 callback handler(页级
merge、不动 status/stage/credit、防乱序)+ 把[第一步 state 回写](chapter-chat-agent-loop.md)从同步
事务**迁到 callback**(行级锁 re-read + 老 job 不覆盖新 job)+ 前端新建**页/章级 pending 态**(评审
纠正:现 `building` 态绑整册 `AGENT_RUNNING`,无单页粒度,**不能直接复用**)。多跳时多轮 loop 才真正
铺开。

**第三刀 — 收编初排(最后)。**
analyze 的 select_template 段已经是"模型从 candidates 选"的好形态,收编纯为"一套代码",边际收益
最低、动主管道风险最高,放最后。

## 8. 仍需落实的开放点(评审 N1/N3)

- **终止与收敛**:loop 步数硬上限 + authoring 单独的紧预算(非 init 的 600s);记录 pick_layout
  历史,在 N 个版式间打转就强制 finish(防不收敛)。
- **JSON-action 稳定性**:生产 provider(doubao)不支持 json_object,只有 prompt + `parse_json_loose`
  兜底 → 每个工具 args 极简(pick_layout 只回一个 templateId),非法即驳回重选,别让单轮吐复杂嵌套。
- **usage 聚合 + 错误码**:多跳累加 token/duration(现 `_usage_from_response` 是单跳);"部分成功"
  (已选版式/已写文案但后续跳失败)要定义返回形状(`V3FailedEvent` 没有携带部分成果的字段)。
