# Agent 重构设计:分层地基(Phase 1)+ 可重入加图 + planner 终态(Phase 2)

> 状态:设计稿(待评审执行)。日期:2026-06-21。
>
> 谁读这份:执行 `apps/agent/` 重构 / `apps/web/` 加图的人,以及 reviewer。
>
> 前置:`docs/agent/contract.md`(对外契约,**Phase 1 不改**)、`docs/agent/design.md`(内部 pipeline 现状)。

---

## 1. 背景:两个问题,一个地基

**当前 `apps/agent/src/` 的乱(扁平 `services/`,边界不可见):**

1. **两代"用户动作"并存,一代是死的。** live 是 `chapter_chat_v3.py`(DeepSeek 一次调用 STRICT-JSON 分诊 talk/写/改);`tools.py`(594 行 function-calling 注册表)**无任何 route/service 引用**,只被 `test_tools.py` 喂活。
2. **无状态服务里漏了状态。** `routes/v3_album.py` 的模块级全局 `_active_stage_by_request` 是全代码唯一一处违反无状态的地方。
3. **"环节地图"没有单一出处。** 每环节模式/IO/错误码都在 `v3_album.py` 手写,该文件 ~70% 是重复 try/except 样板。
4. **确定性引擎没有边界。** 套模板、slot 规则(`layout_rules.py` 936 行)、刷色、封面、finalize 等不调模型的代码,与模型调用、孤儿 `tools.py` 平铺混在一起。

**业务现实 + 终态愿景:**

- 业务是 **re-entrant** 的:用户会在任意阶段中途加图(识完图后 / 故事写完后 / 主题封面都选完后),加图 = 回到识图。**这不是单线管线。**
- 终态愿景是 **planner**:用户用自然语言随口提模糊目标("把这本做温馨点"),AI 自己拆多步、自己决定调哪些工具完成。

**为什么现状挡住这两件事:** 在缠成团 + 带孤儿 `tools.py` 的代码上,没有干净工具面供 planner 选取;re-entrant 的合并也无处安放。**先有地基,后有上层。**

## 2. 关键架构判断

- **Yujee 的 Agent 是"分层良好的 LLM 服务",不是"框架型 agent"。** 不追 LangGraph 式通用 planner/memory 机器。
- **无状态(调用之间)。** 书 + 记忆(章节树、每图 `sceneDescription`、stage、积分)全在 **Web 的 `draft_json` / Postgres**;Agent 每次被喂够上下文 → 返回 tree/pages/patch/layout,**调用之间不留东西**。本次只会**更**贴合此不变式(移除唯一泄漏)。
- **re-entrant 是编排层的事,归属 Web。** "中途加图"是 Web 持有 stage + draft_json、调无状态 analyze 分析新批次、再合并的过程,**不需要 Agent 侧记忆或自主循环**(详见 §7)。
- **planner 不破无状态。** planner 在"一条指令内"有状态(持 plan + 中间结果、循环执行),返回后什么都不留;相册记忆按需喂进来(RAG 形态)。planner **坐在分层之上**,不改地基(详见 §8)。

## 3. 目标 / 非目标(Phase 1 地基)

**目标**

- 把 Agent 内部拆成**三真层 `flows / agents / engine` + 平铺边**(routes/errors/callback/envelope/model/prompts/schemas 摊平到根)。
- 删孤儿(`tools.py` 等),消除唯一状态泄漏(`_active_stage_by_request`)。
- 每个 LLM 能力统一三件套 + **agents/engine 统一 `async run(input)->output` 接口** = **planner-ready 工具面**。

**非目标(明确不做)**

- **不建 planner / 工具注册表**(Phase 2)。
- **不改对外契约 / 不改 schema 字段**:`schemas.py` 只重组,继续逐字段镜像 `packages/contracts`,`extra='forbid'` 不变。
- **不改不变式 / 不跨请求状态 / 不改部署**(入口仍 `src/main.py:app`)。
- **本次不实现加图**:§7 是把 Web 可重入加图的设计**写清**,作为独立 workstream;Agent 侧 MVP 零改动。

> Phase 1 属 AI 工程师权限内的契约冻结型内部重组;若 reviewer 认为需架构师登记,以架构师为准。

## 4. 目标结构(三真层 + 平铺边)

```
apps/agent/src/
├── main.py · settings.py · auth.py · logging_config.py   # 基建(根,入口不动)
├── routes.py · errors.py · callback.py · envelope.py     # HTTP 边(平铺):解析→调 flow→套信封;errors 统一错误映射
├── model.py               # provider 适配(原 ai_client + vision_provider;收掉三处重复;若 410 行嫌大可留两文件在根)
├── schemas.py             # 契约镜像(单文件;拆 contracts/ = 长大了再说)
├── prompts/               # 共享 prompt 资产 + 简单 loader(版本化 = YAGNI,不做);common/(memoir 语气/输出格式/隐私红线)
│
├── flows/                 # 真层① 编排:每环节一个控制器(动作分发在此落位)
│   ├── analyze.py(真多步:describe→group→template→preview)
│   ├── chapter_chat.py(talk/写/改 分发)
│   ├── recommend.py · apply_theme.py · cover.py · finalize.py(瘦)
│   └── (Phase 2) plan.py(planner 自主循环)
│
├── agents/                # 真层② LLM 能力,每个 = prompt.md + schema.py + handler.py,统一 run()
│   ├── image_understanding/ · writing/ · theme_recommend/ · template_select/ · image_edit_intent/
│
└── engine/                # 真层③ 确定性引擎(不调模型;统一可调用接口)
    ├── templates.py · skeleton.py · layout_rules.py
    ├── generic_copy.py · apply_theme.py · cover.py · finalize.py · template_candidates.py
```

**三个真层:** flows 只懂"这一环怎么编排"(无状态,输入全由请求带入);agents 只懂"问模型"(prompt+schema+handler);engine 只懂"确定性变换"(纯函数可单测)。**平铺边:** routes/errors/callback/envelope = HTTP 边(errors 收掉 70% 样板);model.py = provider 适配(收掉三处重复)。

> 尺寸说明:真正不可省的只有一刀——**agents(LLM)vs engine(确定性)分家**,治"分不清工具/引擎"。其余(routes/model/prompts)是几个已有文件的薄分组,平铺到根。比 GPT 那套少了通用 workflow-runner,补上了它漏掉的 engine;`transport/`、`model/` 不建目录。

## 5. agents 三件套 + 统一工具接口

每个 `agents/<capability>/`:`prompt.md`(经 `prompts/`+`common/` 组合)+ `schema.py`(对外契约部分镜像 contracts)+ `handler.py`(统一 `async def run(input)->output`:组 prompt → 调 `model.py` → 校验/clamp → 返回;**不发进度、不映射 HTTP**)。

`engine/` 算子同样暴露统一接口。**`agents`+`engine` 的统一接口 = Phase 2 注册表/planner 要选取的工具面** —— 这正是 `tools.py` 当年想做、却因"没有 planner 去调"而烂成孤儿的东西,这次按正确时机复活。

`flows/chapter_chat.py` 是"用户动作管理"的清晰落点:`writing.run` 拿 `kind` → talk 回复 / write 走 `engine.clamp_pages` / edit-image 走 `image_edit_intent.run`+`engine.skeleton.execute_intent` / edit-text 走 `engine.clamp_page`。

## 6. flows 编排示例

```python
# flows/analyze.py
async def run(req, emit):
    await emit("describe", 0)
    described = await image_understanding.run(req.photos, ...)    # agents
    await emit("describe", 100); await emit("group", 100)
    candidates = engine.skeleton.legal_candidates(described.tree)  # engine
    picks      = await template_select.run(candidates)             # agents
    pages      = engine.generic_copy.fill(picks, described.tree)   # engine
    return described.tree, pages
```

## 7. 可重入加图(Web 状态机 · 派生闸 · 独立 workstream)

> **Web 侧净新功能,与 Agent 重构正交。** Agent 仍无状态、analyze 仍只分析一批。

**今天 main 上零支持加图**:只有 `retry`(重传全部照片);重跑 analyze 的回调 `job-service.ts:116-125` **全覆盖 draft_json + 强退 stage 到 story**,毁掉已写故事/已选主题/`doneChapterIds`。所以这是要新建的能力。

**形态:事件驱动的可重入状态机**(不是单线管线,也不是 agent 循环)。核心:**把全局 stage 与"每章完成度"解耦**;加图是从任意阶段都能触发的事件。

**已决策:派生闸 · 按章补完** —— 不硬退 stage;新章未完成 → 导出闸自动重关 → UI 引导只补新章 → 补完重新解锁;已完成内容全程不动。

```
add_photos(albumId, 新批次):
  1. 只把新批次发给无状态 /v3/analyze(Agent 不变)
  2. 回调走【合并】分支(不是覆盖):
       - 新页 pageIndex 重基 = max+1…(防撞);新章 chapterId 不与旧章撞
       - 追加新章(accentColor/artFont=null、不进 doneChapterIds)+ 追加新页(插封尾前)
       - 旧章 故事/主题/done/texts 原样保留
  3. 重算闸:storyProgressFrom() 见新章不在 doneChapterIds → allDone=false → exportUnlocked=false
```

| 场景 | 旧内容 | 结果 |
|---|---|---|
| ① 识完图再加 | 无故事可毁 | 全 story-pending ✓ |
| ② 故事写完再加 | 故事/done 保留 | 闸重关,只补新章 ✓ |
| ③ 主题/封面都完再加 | 故事/色/封面保留 | 新页插封尾前,新章补故事+主题 ✓ |

**三个必须不出错的硬边:**

1. **覆盖→合并**:`handleV3AnalyzeCompleted` 按"已有 draft + 加图 job"分流,merge 而非 replace(今天最大的坑)。
2. **pageIndex 既是 key 又是渲染序**(`album-service.ts:163-167` 不可重排):新页 `max+1` 与"插封尾前"的渲染序需解耦(gap 编号或显式渲染序字段)。
3. **封面/封尾位置**:新 interior 页落在封面后、封尾前,不能追加到封尾后。

**地基已具备**:每章 done(`progress.doneChapterIds` + `storyProgressFrom()`)、稳定 chapterId/pageIndex 都已存在。未来"analyze 感知已有章节以更好归位"= 契约新增字段 → 架构师 → 可选增强(非 MVP)。

## 8. 端态:planner(Phase 2,占位设计)

用户随口提需求 → planner 在一条指令内自主循环;返回后无状态:

```
Web 调 POST /v3/plan { command, 相册上下文=draft_json树+sceneDescription, pages }
  → flows/plan.py: 1.规划(命令+相册摘要+工具注册表→plan) 2.循环执行调 agents/engine 工具收集 patch
                   3.返回 patches + "我做了什么"(预览,用户确认后 Web 才落库)
  护栏:max steps、每步 schema 校验、失败降级、绝不瞎编
```

自主循环 ✓、调用间无状态 ✓、记忆在 Web ✓、建在 §5 工具面上 ✓。planner 最不确定、最难测,产物是付费实物 → 必须有界步数 + 先预览后落库 + 每步确定性校验 → **第二期才做**。

## 9. 文件 → 落点映射(全量)

| 现位置 | 落点 | 备注 |
|---|---|---|
| `routes/v3_album.py` | `routes.py` + `errors.py` + `flows/*` | `_run_analyze` 系列 → `flows/analyze.py`;**删 `_active_stage_by_request`**(顺参数传 stage) |
| `routes/health.py` | `routes.py` | 并入 |
| `services/callback.py` | `callback.py`(根)| 仅移动 |
| `services/vision.py`(1065) | `agents/image_understanding/` + `model.py` | describe/cluster并发/merge → handler;provider/slot → model;prompt → prompt.md |
| `services/chapter_chat_v3.py`(619) | `flows/chapter_chat.py` + `agents/writing/` | |
| `services/writing_guides.py` | `agents/writing/` | slot-spec 工具并入 |
| `services/recommend_v3.py` | `agents/theme_recommend/` | |
| `services/select_template.py` | `agents/template_select/`(模型挑)+ `engine/template_candidates.py`(候选+兜底)| 模型/确定性分家 |
| `services/chat_edit_v3.py` | `agents/image_edit_intent/`(意图)+ `engine/skeleton.py`(执行)| 模型/确定性分家 |
| `services/skeleton_v3.py` | `engine/skeleton.py` | |
| `services/layout_rules.py`(936) | `engine/layout_rules.py` | 内部再拆(slot/clamp/校验) |
| `services/{generic_copy,apply_theme_v3,cover_v3,finalize_v3}.py` | `engine/{generic_copy,apply_theme,cover,finalize}.py` | |
| `templates.py` | `engine/templates.py` | 12 处引用改 import |
| `services/ai_client.py` · `vision_provider.py` | `model.py`(根;或保留两文件)| 收掉三处重复 provider 策略 |
| `skills/*.md` | `agents/<cap>/prompt.md` + `prompts/common/*` | 专属就近;通用抽 common |
| `skills/__init__.py`(`load_skill`)| `prompts/`(简单 loader)| 不做版本化 |
| `schemas.py`(670) | `schemas.py`(根,单文件)| 字段不动 |
| **`services/tools.py`(594)** | **删除** | 确认孤儿;概念在 Phase 2 注册表正确复活 |
| `color_sampling.py` · `deterministic_attrs.py` · `vision_mock.py` · `grounding.py` | **P0 审计:live 则进 engine/model,死则删** | 依赖图显示 ~0 live importer + 有测试 = 疑似孤儿 |

**测试(`tests/` 24 个)** 随对应代码同阶段迁移、每阶段全绿;`test_tools.py` 随删。

## 10. 迁移计划

**Phase 1 — Agent 地基(分阶段绞杀,每阶段全绿 + 独立 PR)**
- **P0 止血** — 建 `flows/agents/engine/prompts` 骨架;删 `tools.py`+`test_tools.py`;跑孤儿审计。零行为变更。
- **P1 model + HTTP 边** — 抽 `model.py`(收 provider 重复);瘦 `routes.py` + `errors.py` 统一映射 + callback/envelope 平铺。
- **P2 engine** — 确定性整体迁入 `engine/`;`layout_rules` 内部拆分可顺延。
- **P3 agents** — 逐能力三件套 + 统一 `run()`;prompt 迁入 `prompts/` 抽 `common/`。
- **P4 flows 收口** — 六个瘦控制器;删空旧 `services/`。

**独立 workstream — 可重入加图(Web)**:§7 的合并分支 + 派生闸 + pageIndex/封尾位置。可与 Phase 1 并行或之后,主要在 `apps/web`。

**Phase 2 — planner**:工具注册表 → `flows/plan.py` → `POST /v3/plan` + Web 代理 + 预览/确认/落库(新契约字段 → 需架构师)。

## 11. 决策记录

| 决策 | 结论 | 理由 |
|---|---|---|
| 有状态 vs 无状态 | **调用之间无状态**(planner 仅"一条指令内"有状态)| §3 隐私/数据归属;Web 持真相;re-entrant 由 Web 编排 |
| 落地形态 | **Python · `apps/agent/src/`** | 改动最小,部署/隐私边界不变 |
| 层数 | **三真层(flows/agents/engine)+ 平铺边** | 唯一必要的一刀=agents(LLM)vs engine(确定性);transport/model 摊平到根,不建目录 |
| 与 GPT 设计的关系 | **留骨架(agents/prompts)+ 砍过度设计(workflow-runner)+ 补漏(engine)** | GPT 那套没地方放你 80% 的确定性代码 |
| 终态愿景 | **planner(NL → 自主规划)** | 用户选定;坐在分层之上,不改地基 |
| 排期 | **地基先行,planner 第二期** | 不在最差地基上建最难的东西;地基做成 planner-ready |
| 加图后状态 | **派生闸 · 按章补完** | 不硬退 stage;贴合已有 per-chapter done;已完成内容不动 |
| 迁移策略 | **分阶段绞杀,P0→P4 做全** | 每阶段全绿、独立 PR、可回滚 |

## 12. 风险与开放问题

**风险/缓解:** 大范围移动文件 → 每阶段限定一类、契约+测试当门禁、独立小 PR;`vision.py`/`layout_rules.py` 体量大 → 先整体搬+改 import 再同分支拆分;误删活代码 → 孤儿审计三证齐全才删;prompt 抽 common → 拼接后文本保持等价。

**开放问题(执行期定):** ① 孤儿审计结论(4 个疑似模块);② `layout_rules` 内部拆法;③ §7 加图的 pageIndex/渲染序解耦具体方案;④ Phase 2 planner 工具注册表粒度 + 护栏。
