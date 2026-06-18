# Agent V3 实施计划

> **角色**:项目经理产出物。**依据** = `docs/agent/v3-requirements.md`(需求真相源,已评审)+ `docs/architecture.md §2 / §3 隐私 · 树边界 / §6.8 V3 架构拍板`。
>
> **本文是什么**:把 V3 需求拆成依赖有序、可直接施工的 work package(WP),给出 Phase 分解、依赖图、关键路径、风险登记、**施工级决策(§6,已全部定死,无开放项)**。
>
> **本文不是什么**:不是模块施工方案。各 WP owner 动手时仍按 CLAUDE.md「角色→文档」起手必读;框架级机制(failover 语义、按章调色粒度、`stage↔status` 映射等)已在 §6 拍定(含默认值),owner 只在不破语义/契约下微调数值,不得当未决问题。
>
> **架构层结论(§6.8 十条)不得推翻**;本文只据此拆活。施工时凡触及 schema / 协议 / 不变式,仍按 CLAUDE.md「必须先问架构师」登记核对。

---

## 1. 概览

### 1.1 现状盘点(已核实,作为「改/删/迁/新建」基线)

| 区域 | 现状(已核实) | V3 处置 |
|---|---|---|
| Agent 路由 | 仅 `apps/agent/src/routes/{health,v2_album}.py` | 新建 `routes/v3_album.py`(或拆多文件);v2_album 末期整删 |
| Agent schema | `schemas.py`(含 `quality`/`orientation`/`scene`)、`schemas_v2.py` | `schemas.py` 重镜像 TS 新契约;`schemas_v2.py` 末期删 |
| Agent 模板 loader | `templates.py` 仍是 `slot`/`scene`/`pairing` + 图片槽 `quality`/`orientation` | **迁** → `category`/`images`/`svgs`/`texts`/`items`/`variableDecor`;废 quality/orientation |
| Agent 引擎 | `skeleton.py`(`page_scene`/`_is_hero_slot`/`_QUALITY_RANK`)、`finalize.py`(双 `validate_v2`、page0-cover、bracket-path `items[i].title`)、`grouping.py`(union-find 残留)、`theme.py`、`chapter_chat.py`、`chat_edit_v2.py`、`writing_guides.py`(`ROLE_GUIDES`)、`vision.py`、`ai_client.py`、`callback.py`、`layout_rules.py` | 按环节迁/改/删,见各 WP |
| Contracts | `packages/contracts/src/{templates,layout,v2}.ts` + `templates.generated.ts`;模板 JSON `packages/contracts/templates/*.json` **已半迁**(有 `category`,但仍带 `quality`/`orientation`,用 `explain1/explain2` 而非 `items`,无 `svgs`/`variableDecor`) | 补成单一真相源;新增章节色/字体/`variableDecor`/`items`/新 layout 树字段 |
| Web 路由 | `app/api/v2/albums/*`(init/add-photos/draft/retry/theme/finalize/chapter-chat)+ `v2/internal/job-progress` | 新建 `app/api/v3/*`;v2 末期整删 |
| Web service | `services/{album,job,credit,generation,...}`;`job-service.handleInitCompleted` **已在 init 成功 settle**(§6.7) | 复用 settle 路径;album-service 加 `stage` 流转 |
| Web DB | `db/schema.ts`:`albums` 有 `status`/`draftJson`,**无 `stage`**;`agentJobs` 有自己的 `stage`(任务进度,非环节)。migrations 到 `0006` | 新增 `albums.stage` 迁移(`0007`) |
| Web lib | `lib/agent/agent-client.ts`(v2 方法)、`lib/agent/layout-schema.ts`、`lib/photo/compress.ts`(**无 EXIF/GPS**)、`lib/photo/store.ts` | agent-client 加 v3 方法;compress 加 Stage 0 读 `takenAt`(新;**不抽 GPS**,§3 隐私) |
| Web UI | `components/album/editor-v2/EditorPort.tsx`(单线程 theme→chapter)、`templates/` React 渲染 | 改造成五环节状态机 + 面包屑 + 封面单独成页 |
| 文档 | `contract.md` / `design.md` 仍是 v1/v2 | Phase 6 随 V3 重写 |


### 1.2 角色(用 CLAUDE.md 角色名)

`Web·DB` / `Web·API` / `Web·Service` / `Web·UI·编辑器` / `Agent·内部 pipeline` / `Agent·接入` / `Contracts` / `Infra`。

### 1.3 Phase 总览

| Phase | 名称 | 目标 | WP |
|---|---|---|---|
| **0** | 地基(硬约束·§6.8 第 5/6 条) | 契约重整 + 模板 loader 迁移 + schema 迁移,让 Agent 起得来、测试可收集 | WP0.1–0.4 |
| **1** | 分析环节 `/v3/analyze` | 异步分析 → 章节树 + 套模板 + 通用文案/色 → 预览 | WP1.1–1.5 |
| **2** | 章节故事 `/v3/chapter-chat` | 逐章引导 + 完成度闸门 + 文本/视觉双模型 | WP2.1–2.4 |
| **3** | 主题/章节色 `/v3/recommend` + `/v3/apply-theme` | 推荐 + 一键渲染(含 SVG)写 `layout.json` | WP3.1–3.3 |
| **4** | 书籍设计 `/v3/cover` | 封面/封尾可选,画板单独成页 | WP4.1–4.2 |
| **5** | 待导出 `/v3/finalize` + 导出失败处理 | 导出闸门 + flatten 定稿 + 重试 3 次 + 弹框/日志 | WP5.1–5.3 |
| **6** | 旧端点整删 + 文档同步 | 删 v1/v2 路由·service·schema·测试;重写 contract.md/design.md,更新 CLAUDE.md | WP6.1–6.2 |

**合计 6 Phase / 23 WP。**

---

## 2. 依赖图(拓扑序)

```
Phase 0  地基(全部 /v3 端点的前置)
  WP0.1 契约重整(TS/zod 单一真相源)─┬─► WP0.2 模板 JSON 完成迁移(quality/orientation/explain1→items/svgs/variableDecor)
                                     └─► WP0.3 Python schemas.py 镜像
  WP0.2 ─► WP0.4 Python 模板 loader 迁移(templates/skeleton/finalize)

Phase 1  分析
  (0.1–0.4) ─► WP1.1 /v3/analyze 接入骨架(异步 202 + callback)
  (0.1–0.4) ─► WP1.2 确定性属性补全(width/height/orientation/takenAt;不抽 GPS)
  WP1.1+1.2 ─► WP1.3 describe-content(识图模型分章树)
  WP1.3     ─► WP1.4 select-template 套模板 + 兜底
  WP1.4     ─► WP1.5 通用文案/色 + 预览 + Web 建相册 0.5s 跳转 + settle 复用

Phase 2  章节故事        (依赖 1.5 的 draft 树就绪)
  WP2.1 chapter-chat 端点 + turn 状态机
  WP2.1 ─► WP2.2 写作 Skill + page_slot_specs 透传 hint
  WP2.1 ─► WP2.3 改页图文分流(DeepSeek / 识图模型升级)
  WP2.1 ─► WP2.4 Web 完成度闸门(每章 done → 解锁导出)

Phase 3  主题/章节色      (依赖 0.1 variableDecor 落点;1.5 树就绪)
  WP3.1 /v3/recommend(2 skill)  ─► WP3.2 /v3/apply-theme 一键渲染(含 SVG)
  WP3.3 取色工具(base64 采样主色)[被 3.1/3.2 用]

Phase 4  书籍设计        (依赖 0.4 删 page0-cover;3 之后或并行)
  WP4.1 /v3/cover 端点(可选/可跳过)
  WP4.2 Web 画板封面/封尾单独成页

Phase 5  待导出
  WP5.1 /v3/finalize(flatten + 单一 validate)  (依赖 0.4 校验合并)
  WP5.2 Web 导出闸门(章节全 done 才出按钮)     (依赖 2.4)
  WP5.3 导出失败重试3次 + 弹框 + 日志(飞书后置)

Phase 6  整删 + 文档      (依赖全部 /v3 调通)
  WP6.1 删 v1/v2 路由·service·schema·测试 + 去重 union-find 清残留
  WP6.2 重写 contract.md/design.md + 更新 CLAUDE.md/architecture 引用
```

### 2.1 关键路径(决定总工期)

```
WP0.1 → WP0.2 → WP0.4 → WP1.1 → WP1.3 → WP1.4 → WP1.5 → WP2.1 → WP2.4 → WP5.2 → WP6.1 → WP6.2
```

理由:契约+模板 loader 不迁完,Agent 起不来、测试 0 收集(§6.8 第 5/6 条),一切 `/v3` 阻塞;分析环节产出 draft 树是章节故事/主题/导出的共同前提;章节完成度闸门(2.4)直接决定导出解锁(5.2);旧端点整删(6.1)必须等全链路调通。

### 2.2 可并行项

- **Phase 0 内**:WP0.2(模板 JSON)依赖 0.1;WP0.3(schemas.py 镜像)依赖 0.1 完成;WP0.4 依赖 0.2。
- **Phase 1 内**:WP1.2(确定性属性,纯代码)可与 WP1.1(接入骨架)并行。
- **跨 Phase**:Phase 3 与 Phase 4 可并行(都依赖 Phase 1 树,互不依赖);WP3.3 取色工具可提前独立做。
- **Web·UI vs Agent**:UI 改造(面包屑/五环节/封面成页,WP1.5·4.2)可在对应 Agent 端点 contract 冻结后并行推进。

---

## 3. Phase 分解 · WP 表

> 每个开发 WP 一律走 CLAUDE.md 铁律:**建分支 → 改 → 派 review engineer 评审 + 测试过 → 推 GitHub 开 PR**。下表「PR 策略」标注独立 PR 还是必须捆绑。

### Phase 0 — 地基(硬约束)

#### WP0.1 契约重整:TS/zod 单一真相源
- **目标**:把 `packages/contracts` 补成 V3 单一真相源,新增章节色/字体/`variableDecor`/`items`/`svgs`/新 layout 树字段。
- **owner**:Contracts
- **前置**:无(最前)
- **关键文件**:`packages/contracts/src/templates.ts`(去 `quality`/`orientation` slot 字段、加 `svgs`/`items`/`variableDecor`/`hint`)、`packages/contracts/src/layout.ts`(章节树:`chapters[].{description,accentColor,artFont}`、`photos[].{sceneDescription,width,height,orientation,takenAt}`——**无 `location`/`place`**,§3 隐私)、新增/扩 `src/v3.ts`(各 `/v3/*` req/res 形状)、`src/enums.ts`(`stage` 枚举、字体包枚举、`category` 合法集)、`src/index.ts` 导出。
- **验收**:`pnpm --filter contracts test` 通过;TS 编译无 `any`;`templates.generated.ts` 重新生成与新 schema 一致;新字段有 zod 边界(maxChars/合法集)。
- **触及不变式 / 找架构师**:**改对外契约 + 改协议**(CLAUDE.md「必须先问架构师」)。§3 校验(写库前 zod 校验)依赖此真相源;§3 树边界(authoring 树边界、`variableDecor` 在树内、渲染契约不新增树形字段)必须核对——`variableDecor` 只在 authoring 树,扁平渲染契约不得新增树形字段。
- **风险/开放项**:章节色/字体「按章控制」= 章级粒度,**已定**(§6 第 1 条);字体包枚举具体成员待模板维护方给。
- **PR 策略**:独立 PR,但与 WP0.3(Python 镜像)语义强耦合 → 二者**逻辑上捆绑评审**(契约改了 Python 不跟会漂移),可分两 PR 但同一窗口连续合。

#### WP0.2 模板 JSON 完成迁移
- **目标**:把 `packages/contracts/templates/*.json` 从半迁状态收尾到目标契约。
- **owner**:Contracts(模板由用户单独维护,本 WP 只做结构迁移 + 校验,不改美术)
- **前置**:WP0.1
- **关键文件**:`packages/contracts/templates/*.json`(去图片槽 `quality`/`orientation`;`explain1/explain2` 等重复槽 → `items` 组;加 `svgs[].variableDecor`;给点缀/章节色落点的 text/svg 槽标 `variableDecor:true`;补 `texts[].hint`)、`templates/README.md`。
- **验收**:全部模板过新 zod schema;`templates.generated.ts` 重生成;每个 `category` 池非空;至少一个含 `items` 组、一个含 `svgs` 的模板有 fixture 覆盖。
- **触及不变式 / 找架构师**:模板是单一真相源(§6.6 第 5 条);结构字段属契约,改动登记。
- **风险/开放项**:哪些槽该标 `variableDecor` 需与模板维护方对齐(章节色/花字落点)。
- **PR 策略**:可与 WP0.1 同 PR 或紧随;独立可评审。

#### WP0.3 Python `schemas.py` 镜像 TS 契约
- **目标**:Agent schema 重新对齐 TS 真相源,去 `quality`/`orientation`/`scene`,加新字段。
- **owner**:Agent·内部 pipeline + Contracts
- **前置**:WP0.1
- **关键文件**:`apps/agent/src/schemas.py`(改)、`apps/agent/src/schemas_v2.py`(末期删,Phase 6)、`apps/agent/tests/test_schemas.py`(改)。
- **验收**:`pytest apps/agent/tests/test_schemas.py` 通过;同一 fixture(取自 contracts)TS 与 Python 解析一致(契约一致性测试)。
- **触及不变式 / 找架构师**:改 schema(登记);§3 校验。
- **PR 策略**:与 WP0.1 捆绑评审(跨 Contracts↔Agent,防单边改半)。

#### WP0.4 Python 模板 loader + 引擎迁移(BLOCKER)
- **目标**:`templates.py`/`skeleton.py`/`finalize.py` 从旧 `slot/scene/quality/hero` 迁到 `category/pairing/images/svgs/texts/items/variableDecor`;废 `quality`/`orientation`/`can_place`/`_is_hero_slot`/hero-cap/`page_scene`。
- **owner**:Agent·内部 pipeline
- **前置**:WP0.2(模板 JSON 目标形状就位)
- **关键文件**:`apps/agent/src/templates.py`(loader:`TemplateSlot`/`TemplateScene`/`PhotoQuality` 删,改 `category` 等)、`apps/agent/src/services/skeleton.py`(删 `_QUALITY_RANK`/`_is_hero_slot`/`page_scene`,改按 `category` + 图片槽数挑模板)、`apps/agent/src/services/finalize.py`(删 page0-must-cover、bracket-path `items[i].title` → `items` 组、双 `validate_v2` → 单一 validate 见 WP5.1)、`apps/agent/src/services/layout_rules.py`(校验认新字段)、相关 `tests/test_template_loader.py`/`test_skeleton_partition.py`/`test_pick_template.py`/`test_finalize_flatten.py`(改)。
- **验收**:**`pytest apps/agent/tests/` 可收集且全绿(测试 0 收集 = 失败)**;纯代码兜底路径有 fixture:「N 张图 → 挑能容纳 N 的模板顺序塞」(§9 兜底);无任何 `quality`/`hero` 引用残留(`grep` 断言)。
- **触及不变式 / 找架构师**:改协议/校验逻辑(§6.8 第 6/7 条已拍,施工登记);§3 树边界(finalize flatten 边界)。
- **风险/开放项**:`pairing`(跨页配对)**已定本期不启用**(§6 第 4 条)——loader 保留字段结构,确定性引擎不消费(默认 null)。
- **PR 策略**:可独立 PR,但**必须在 WP0.2 合入后**;是 Agent 起死回生的关键,优先级最高。

> **WP0.5(GPS/place 反查)已删除(2026-06-18)**:V3 不接入 location/GPS(架构 §3 隐私 / §6.8 第 3 条)。Stage 0 只读 `takenAt`——并入 WP1.2 的确定性属性补全 + Web 端 compress 读图,不再单列工作包。`compress.ts` 只读 `takenAt`;`logging_config.py` 的 `lat/lng/...` redact 作防御红线**保留不动**(无需本期改动)。

---

### Phase 1 — 分析环节 `/v3/analyze`

#### WP1.1 `/v3/analyze` 接入骨架(异步 202 + callback)
- **目标**:新建异步分析端点,接单即 202,后台跑,回推 job-progress。
- **owner**:Agent·接入 + Web·API
- **前置**:WP0.1/0.3/0.4
- **关键文件**:**新建** `apps/agent/src/routes/v3_album.py`、`apps/agent/src/main.py`(挂 v3 路由)、`apps/agent/src/services/callback.py`(复用回调);Web 侧 **新建** `apps/web/src/app/api/v3/albums/route.ts`(建相册+起 analyze,≤40 行)、`apps/web/src/app/api/v3/internal/job-progress/route.ts`+`handler.ts`(复用 v2 模式)、`apps/web/src/lib/agent/agent-client.ts`(加 `submitAnalyzeV3`)。
- **验收**:接单 5s 内 202;`completed`/`failed`/`progress` 回调写库;失败可重试不污染 stage;鉴权走 `AGENT_SHARED_SECRET`。
- **触及不变式 / 找架构师**:改 Web↔Agent 协议(§6.8 第 1 条已拍,登记);§3 隐私(base64 不落盘)、§3 数据归属(Agent 无状态)、§3 secret(secret 不进 client bundle)。
- **PR 策略**:跨 Web↔Agent,**捆绑评审**(契约 req/res 两端一致)。

#### WP1.2 确定性属性批量补全
- **目标**:`width/height/orientation`(算)、`takenAt`(EXIF)由代码批量填,不经 LLM;时间作为分章信号。**不抽 GPS、无地点信号**(§3 隐私);Web 端 `compress.ts` 读 `takenAt` 随 base64 发出(原 WP0.5 并入此处)。
- **owner**:Agent·内部 pipeline + Web·UI·编辑器(compress 读 `takenAt`)
- **前置**:WP0.1(定字段);可与 1.1 并行
- **关键文件**:`apps/web/src/lib/photo/compress.ts`(**新增** 读 `takenAt`;当前无任何 EXIF 逻辑,**不读 GPS**)、`apps/agent/src/services/grouping.py`(改:消费 `takenAt` 信号,删 union-find 残留——并入 WP6.1 或此处先清)、新建确定性属性填充逻辑(可在 skeleton 或新模块)、`apps/agent/tests/test_grouping.py`(改)。
- **验收**:每图确定性字段全由代码覆盖;LLM 不写这些字段;有「时间参与分章」的 fixture;**无任何 GPS/坐标/`place` 字段产出**。
- **触及不变式 / 找架构师**:§3 隐私(只读 `takenAt`,不抽 GPS)。
- **PR 策略**:独立 PR。

#### WP1.3 describe-content(识图模型分章树)
- **目标**:识图模型一次调用 → 章节树(分章 + 每章 `description` + 每图 `sceneDescription`),LLM 只写这 3 处。
- **owner**:Agent·内部 pipeline + Agent·接入(模型通道)
- **前置**:WP1.1 + WP1.2
- **关键文件**:`apps/agent/src/services/vision.py`(改:输出章节树而非 V2 逐图 tags/quality/mood)、`apps/agent/src/services/ai_client.py`(识图模型走 `OPENAI_*` 主、`ARK_*` failover)、`apps/agent/src/settings.py`(已预留 OPENAI/ARK 槽,确认 GPT-5.5 Mini model 名)、新建 `describe-content` skill(prompt 资产,集中存放)、`apps/agent/tests/test_vision_groups.py`(改)。
- **验收**:产出符合 §4.1 章节树结构;一图一章不跨章;LLM 字段只 3 处;火山 failover 路径有测试(mock)。
- **触及不变式 / 找架构师**:改模型选型(§6.8 第 2 条已拍);§3 数据归属。
- **风险/开放项**:failover 语义 + 默认阈值**已定**(§6 第 2 条,数值可微调);skill 目录**已登记** `apps/agent/src/skills/`(§6 第 5 条)。
- **PR 策略**:独立 PR。

#### WP1.4 select-template 套模板 + 纯代码兜底
- **目标**:识图模型在合法候选里选 templateId;LLM 失败走纯代码兜底(按图片数挑能容纳的模板顺序塞)。
- **owner**:Agent·内部 pipeline
- **前置**:WP1.3 + WP0.4
- **关键文件**:`apps/agent/src/services/skeleton.py`(改:`select-template` 意图 + 合法候选集 = `category` 匹配 + 图片槽数能容纳;兜底纯代码)、新建 `select-template` skill、`apps/agent/tests/test_skeleton_partition.py`/`test_pick_template.py`(改)。
- **验收**:模型只在合法候选里挑(不凭空造 id);**兜底 fixture**:LLM 失败 → 按 N 张挑模板顺序塞、无 quality/hero 匹配;横竖比错配交 center-cover 渲染(不报错)。
- **触及不变式 / 找架构师**:§6.8 第 6 条(quality/hero 废弃)已拍。
- **PR 策略**:独立 PR。

#### WP1.5 通用文案/色 + 预览 + Web 建相册 0.5s 跳转 + settle 复用
- **目标**:填模板自带通用文案/通用色 + 占位 accentColor/artFont → 出预览态 layout 树(落 `draft_json`);Web 点「下一个」≤0.5s 进编辑器、后台跑分析;init 回调复用 settle。
- **owner**:Agent·内部 pipeline + Web·Service + Web·UI·编辑器
- **前置**:WP1.4
- **关键文件**:`apps/agent/src/services/skeleton.py`/新填充逻辑(通用文案/色)、Web `apps/web/src/services/album/album-service.ts`(建相册 + `stage=analysing`)、`apps/web/src/services/job/job-service.ts`(`handleInitCompleted` 复用 settle、置 `stage=story`——**已在 init settle,只需复用**)、`apps/web/src/components/album/editor-v2/EditorPort.tsx`(加载动画「正在分析照片」)、`apps/web/src/db/schema.ts`(`albums.stage`,见 §schema 迁移 WP0.x 注)、新迁移 `0007_albums_stage.sql`。
- **验收**:**全链路 fixture:分析→章节树→套模板→通用文案/色→预览**;点「下一个」≤0.5s 跳转(分析未完不阻塞);init 成功按张 `⌈张数/10⌉` 实扣、失败 release(不改 creditService);`stage` 正确流转。
- **触及不变式 / 找架构师**:**加 `albums.stage` = 改 schema**(§6.8 第 4 条已拍并给出 `0007` 迁移 + 正交映射,照办即可);§3 积分(积分变更与 album 状态同事务)。
- **风险/开放项**:`albums.stage` ↔ `status` 正交映射 + `0007` 迁移**已定**(`architecture.md §6.8 第 4 条` / §6 第 3 条),Web·DB 照办无自由度。
- **PR 策略**:跨 Web↔Agent + DB 迁移,**捆绑评审**;DB 迁移可拆独立小 PR 先合。

---

### Phase 2 — 章节故事 `/v3/chapter-chat`

#### WP2.1 chapter-chat 端点 + turn 状态机
- **目标**:同步端点;章节内三动作(引导/写/改)自由交错,按 turn 推进、Agent 按用户意图分派(非 pipeline)。
- **owner**:Agent·接入 + Agent·内部 pipeline + Web·API
- **前置**:WP1.5
- **关键文件**:`apps/agent/src/routes/v3_album.py`(加 `/v3/chapter-chat`)、`apps/agent/src/services/chapter_chat.py`(改:turn 分派)、Web `apps/web/src/app/api/v3/albums/[uuid]/chapter-chat/route.ts`、`agent-client.ts`(加方法)、`apps/agent/tests/test_chapter_chat.py`(改)。
- **验收**:单章切片+history+userMessage 入,assistantReply+补丁出;引导/写/改可任意顺序;同步 60s。
- **触及不变式 / 找架构师**:改协议(登记);§3 数据归属。
- **PR 策略**:跨端捆绑评审。

#### WP2.2 写作 Skill + page_slot_specs 透传 hint
- **目标**:创作风格移出代码进写作 Skill;`page_slot_specs` 把模板逐槽 `hint` 透传给写作 LM;一次写满全章 `pagesTexts`。
- **owner**:Agent·内部 pipeline
- **前置**:WP2.1
- **关键文件**:`apps/agent/src/services/writing_guides.py`(删 `ROLE_GUIDES` 创作话术,只留确定性约束:role 归属/decoration 自动填/maxChars clamp)、新建「引导 Skill」+「写作 Skill」(prompt 资产)、page_slot_specs 透传 `hint`(现缺)、`apps/agent/tests/`(新增写作链路 fixture)。
- **验收**:写作输入装配含 §4.2(4) 全部项(用户信息+写作Skill+逐槽hint+画面背景+页面结构);旧 `ROLE_GUIDES` 无残留兜底;`hint` 确实透传。
- **触及不变式 / 找架构师**:skill 目录登记。
- **PR 策略**:独立 PR。

#### WP2.3 改页图文分流
- **目标**:焦点页重写:纯文字→DeepSeek;涉及图片→升级识图模型出意图→确定性 `pick_template`/`assign_images` 执行(模型不直接编 templateId)。
- **owner**:Agent·内部 pipeline
- **前置**:WP2.1
- **关键文件**:`apps/agent/src/services/chat_edit_v2.py`(改/迁:复用 V2 retemplate 工具链;焦点页机制 `focusedPageIndex`)、`apps/agent/tests/test_chat_edit_v2.py`(改)。
- **验收**:纯文字 turn 不触识图模型;换图/挪图 turn 升级识图模型;模型出意图、确定性引擎执行;触发权在用户。
- **触及不变式 / 找架构师**:§8.3(已拍)。
- **PR 策略**:独立 PR。

#### WP2.4 Web 完成度闸门
- **目标**:Web 持 `stage`+当前章+各章 `done`;所有章 done → `stage=theme` + 解锁导出。
- **owner**:Web·Service + Web·UI·编辑器
- **前置**:WP2.1
- **关键文件**:`apps/web/src/services/album/album-service.ts`(章节 done 标记 + stage 推进)、`EditorPort.tsx`(逐章推进 UI + 面包屑高亮)。
- **验收**:一章一确定;全部确定才进下一环 + 解锁导出(主题/封面不卡)。
- **触及不变式 / 找架构师**:stage 推进权在 Web(§8.3)。
- **PR 策略**:Web 独立 PR(与 WP5.2 导出闸门联动,可同窗口)。

---

### Phase 3 — 主题/章节色

#### WP3.1 `/v3/recommend`(2 skill)
- **目标**:识图模型按 `recommend-theme` + `recommend-chapter-colors` 出主题候选 + 每章色 + 字体建议。
- **owner**:Agent·接入 + Agent·内部 pipeline
- **前置**:WP0.1(variableDecor/字体枚举);WP1.5(树就绪);WP3.3(取色工具)
- **关键文件**:`routes/v3_album.py`(加 `/v3/recommend`)、`apps/agent/src/services/theme.py`(改:扩主题+章节色+字体)、新建两 skill、Web `app/api/v3/albums/[uuid]/recommend/route.ts`、`apps/agent/tests/test_theme.py`(改)。
- **验收**:出主题候选+每章 accentColor+artFont(字体包内选一);章节概览+分析摘要为输入。
- **触及不变式 / 找架构师**:改协议。
- **PR 策略**:跨端捆绑评审。

#### WP3.2 `/v3/apply-theme` 一键渲染(含 SVG)
- **目标**:用户选定主题/色/字体后,脚本一键批量填充**文字 + 点缀 + SVG 图层**(按 `variableDecor` 标记),写入 layout 树。
- **owner**:Agent·内部 pipeline
- **前置**:WP3.1
- **关键文件**:`routes/v3_album.py`(加 `/v3/apply-theme`,确定性)、`apps/agent/src/services/theme.py`(apply 逻辑:刷所有 `variableDecor:true` 槽)、Web `app/api/v3/albums/[uuid]/apply-theme/route.ts`(置 `stage=cover`)。
- **验收**:只刷 `variableDecor` 槽,普通正文不碰;含 SVG 图层填充;章节色/字体写 layout 树(`finalize` 时烘焙进扁平,§3 树边界)。
- **触及不变式 / 找架构师**:§3 树边界(树内 variableDecor → finalize 烘焙,渲染契约不新增树形字段)。
- **风险/开放项**:章节色/字体「按章控制」= **章级粒度,已定**(§6 第 1 条:每章一色一字刷全章 variableDecor 槽,不做逐槽自定义);owner ③ 只细化取色算法 / 推荐 prompt。
- **PR 策略**:独立 PR。

#### WP3.3 取色工具(base64 采样主色)
- **目标**:Agent 端从每章代表图 base64 采样主色,供 `recommend-chapter-colors`。
- **owner**:Agent·内部 pipeline
- **前置**:无强前置(被 3.1/3.2 用,可提前)
- **关键文件**:新建取色工具(Agent 端);`apps/agent/tests/`(采样单测)。
- **验收**:给定 base64 出主色值;无状态、不落盘。
- **PR 策略**:独立 PR,可提前并行。

---

### Phase 4 — 书籍设计 `/v3/cover`

#### WP4.1 `/v3/cover` 端点(可选/可跳过)
- **目标**:选封面/封尾系统模板 → 自动填充成稿;可跳过(空)。
- **owner**:Agent·接入 + Agent·内部 pipeline
- **前置**:WP0.4(删 page0-cover);Phase 1 树
- **关键文件**:`routes/v3_album.py`(加 `/v3/cover`,确定性 / 识图模型辅助选)、`apps/agent/src/services/skeleton.py`/`finalize.py`(封面/封尾构造,删 page0-must-cover)、Web `app/api/v3/albums/[uuid]/cover/route.ts`(置 `stage=ready`)。
- **验收**:封面可跳过(page0 不再保证是 cover);选模板后自动填充;跳过=空补丁不报错。
- **触及不变式 / 找架构师**:删 page0-cover 校验(§6.8 第 7 条已拍)。
- **PR 策略**:跨端捆绑评审。

#### WP4.2 Web 画板封面/封尾单独成页
- **目标**:画板把封面/封尾单列成页,不混进明细跨页。
- **owner**:Web·UI·编辑器
- **前置**:WP4.1
- **关键文件**:`EditorPort.tsx` + `components/album/editor-v2/`、`components/album/templates/`(渲染区分封面/封尾)。
- **验收**:用户可见画板封面/封尾单独成页展示。
- **PR 策略**:Web 独立 PR。

---

### Phase 5 — 待导出

#### WP5.1 `/v3/finalize`(flatten + 单一 validate)
- **目标**:全树 flatten 成扁平 `AlbumLayoutPlan`;双 `validate_v2` 合并成单一 validate(认 svgs/items/variableDecor/章节色/字体)。
- **owner**:Agent·内部 pipeline
- **前置**:WP0.4
- **关键文件**:`routes/v3_album.py`(加 `/v3/finalize`,确定性同步)、`apps/agent/src/services/finalize.py`(改:单一 validate、章节色/字体/SVG 烘焙进扁平 `pages[].texts/images`、`items` 组)、`apps/agent/src/services/layout_rules.py`、Web `app/api/v3/albums/[uuid]/finalize/route.ts`、`apps/agent/tests/test_finalize_flatten.py`/`test_v2_finalize_edit.py`(改)。
- **验收**:flatten 后扁平契约恒为 `magazine+photos+pages[]`,**无树形字段**(§3 树边界);单一 validate 通过;`variableDecor`(章节色/字体/SVG)正确烘焙进扁平页。
- **触及不变式 / 找架构师**:§3 树边界;§6.8 第 7 条(校验单一真相源)。
- **PR 策略**:独立 PR。

#### WP5.2 Web 导出闸门
- **目标**:仅当章节故事全章完成才出/可用 PDF 导出按钮(主题/封面不卡);提示「太棒了…」。
- **owner**:Web·UI·编辑器 + Web·Service
- **前置**:WP2.4
- **关键文件**:`EditorPort.tsx`(导出按钮闸门 + 面包屑 `待导出`)、`apps/web/src/app/api/v1/albums/[uuid]/pdf-upload-url/route.ts`(R2 presigned,沿用)。
- **验收**:章节未全 done 时按钮不可用;全 done 出按钮 + 文案;主题/封面跳过不影响导出。
- **PR 策略**:Web 独立 PR。

#### WP5.3 导出失败重试 + 弹框 + 日志
- **目标**:出 PDF / R2 上传失败自动重试 ≤3 次;连续 3 次 → 弹安抚框 + 错误日志;不碰积分;飞书推送**后置**(只记录方案,不实现)。
- **owner**:Web·UI·PDF + Web·Service
- **前置**:WP5.1/5.2
- **关键文件**:`EditorPort.tsx` / PDF 导出组件(`@react-pdf/renderer` 出 PDF + 重试计数在前端)、错误日志落点。**不**新建飞书 route/lib(后置;方案见需求 §4.5d 备用)。
- **验收**:失败重试 3 次;连续失败弹框 + 日志;导出成功/失败均不动积分。
- **触及不变式 / 找架构师**:无新协议(飞书后置)。
- **风险/开放项**:飞书服务台推送后置,上线后视失败率再加(需求 §4.5d 已留完整方案)。
- **PR 策略**:Web 独立 PR。

---

### Phase 6 — 整删 + 文档同步

#### WP6.1 删 v1/v2 + 清去重残留
- **目标**:V3 全链路调通后,整删 `/v1`、`/v2` 路由+service+旧 schema+旧测试;清 union-find 去重残留。
- **owner**:Agent·内部 pipeline + Web·API + Web·Service
- **前置**:Phase 1–5 全部调通
- **关键文件**:删 `apps/agent/src/routes/v2_album.py`、`schemas_v2.py`、相关 `tests/test_v2_*.py`/`test_schemas_v2.py`;删 Web `app/api/v1/*`(保留仍用的:`pdf-upload-url`/`fonts/subset`/`credit`/`billing`/`auth` 等——**逐个核实再删,不误删导出/支付/字体链路**)、`app/api/v2/*`;清 `grouping.py` union-find/jaccard 残留。
- **验收**:`grep` 无 `/v1`/`/v2` 业务端点残留(保留项白名单核实);全测试套件绿;无悬空 import。
- **触及不变式 / 找架构师**:删对外端点(§6.8 第 1 条已拍);**白名单核实哪些 v1 端点仍需保留**(导出/支付/字体/auth)。
- **风险/开放项**:误删仍在用的 v1 端点(PDF 上传/字体 subset/支付)→ 删前必须逐个核实引用方。
- **PR 策略**:独立大 PR,review 重点核「保留白名单」。

#### WP6.2 文档同步
- **目标**:`contract.md`/`design.md` 仍是 v1/v2,随 V3 重写;`CLAUDE.md` 技术栈/识图模型表述更新;架构引用点核对。
- **owner**:架构师 / 各 owner 协作(PM 牵头)
- **前置**:WP6.1
- **关键文件**:`docs/agent/contract.md`(重写为 v3 req/res/错误码/状态机)、`docs/agent/design.md`(重写 pipeline + §9 redact 与 §3 隐私 对齐)、`CLAUDE.md`(技术栈表识图=GPT-5.5 Mini、火山 failover;角色映射如有新 skill 目录)、`docs/architecture.md`(若新增 skill 目录则登记)。
- **验收**:contract.md/design.md 无 v1/v2 残留表述;§3 隐私(GPS)引用点(redact、Stage0、grouping、design §9)四处一致。
- **PR 策略**:文档 PR,与 WP6.1 同窗口。

---

## 4. PR 捆绑速查

| 类型 | WP | 理由 |
|---|---|---|
| **必须捆绑评审**(跨 Web↔Agent,防单边改半,照 §6.5 CT-1 教训) | WP0.1+0.3、WP1.1、WP1.5(含 DB 迁移)、WP2.1、WP3.1、WP4.1 | 契约/协议两端形状必须一致 |
| **独立 PR** | WP0.2、WP0.4、WP1.2、WP1.3、WP1.4、WP2.2、WP2.3、WP2.4、WP3.2、WP3.3、WP4.2、WP5.1、WP5.2、WP5.3 | 单端可独立验收 |
| **独立大 PR(重点 review)** | WP6.1(整删)、WP6.2(文档) | 删除面大,核保留白名单 |

> DB 迁移(`albums.stage`,`0007`)可从 WP1.5 拆成独立先合的小 PR,降低耦合。

---

## 5. 风险登记

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R1 | **模板 loader 迁移(WP0.4)不到位 → Agent 起不来、测试 0 收集** | 阻塞全部 /v3 | 列为关键路径最高优先;验收硬卡「pytest 可收集且全绿 + 无 quality/hero 残留」 |
| R2 | **TS↔Python 契约漂移**(历史 `design.md §14` 已有漂移) | schema 不一致、写库 zod 失败 | WP0.1 TS 先行 + WP0.3 Python 镜像捆绑评审;加跨端 fixture 一致性测试 |
| R3 | **WP6.1 整删误伤仍在用的 v1 端点**(PDF 上传/字体 subset/支付/auth) | 导出/支付/字体链路断 | 删前逐个核实引用方、定保留白名单;放最后、全链路调通后做 |
| R4 | `albums.stage` 与 `status` 正交映射不清 → 导出闸门/积分错乱 | 状态机紊乱 | WP1.5 先在施工文档定映射;§3 积分 守积分事务原子 |
| R5 | 识图模型 GPT-5.5 Mini failover 默认阈值(§6 第 2 条)实测偏差 → 批量分析卡死或乱切火山 | 分析体验/成本 | 语义已定(先 GPT 自动降级火山);WP1.3 先实现 failover 通路 + mock 测试,`90s` 等数值按实测微调 |

---

## 6. 施工级决策(已定 — 不留开放项)

> 原「开放项 / 待架构师确认」逐条定死:框架层能拍的已拍;纯数值/算法类给出**默认 + owner**,owner 只能在不破契约/语义下微调,**不得当未决问题挂着**。

1. **章节色/字体「按章控制」粒度(WP3.2)— 已定:章级**。每章一个 `accentColor` + 一个 `artFont`,一键刷到该章所有 `variableDecor` 槽(§4.1/§4.3)。用户可调粒度 = **章级**(换色/换字重刷整章);**逐槽自定义本期不做**。owner ③ 只细化取色算法 / 推荐 prompt,**不得改这个章级契约**。
2. **识图模型 failover 触发(WP1.3)— 已定语义,数值可微调**。识图默认走 `OPENAI_*`(GPT-5.5 Mini);**降级火山 `ARK_*` 条件 = OpenAI 按 §8/`architecture §2.3`(30s 超时 + 重试 1 次)仍 5xx/超时,或单批分析 > 90s 未完成**。通路与「先 GPT、自动降级火山」的语义按此定死;`90s` 等数值 owner 可按实测微调,**不改降级语义**。
3. **`albums.stage` ↔ `status` + 迁移 — 已定,见 `architecture.md §6.8 第 4 条`**。`0007` 迁移加 `album_stage` enum(`analysing|story|theme|cover|ready`)+ 列(`default 'analysing'`,现有行回填规则见架构);两列正交、互不派生(`status` 管 init 任务 + 积分,`stage` 管环节 + 导出闸门)。owner Web·DB 照架构落迁移,**无自由度**。
4. **`pairing`(跨页配对)— 已定:本期不启用**。WP0.4 loader 迁移**保留 `pairing` 字段结构**(契约里有),但确定性引擎**不消费**(默认 `null`,`interior` 语义留将来)。不再在施工文档里决策启用与否。
5. **Skill 集中存放目录 — 已定:`apps/agent/src/skills/`**。已在 `architecture.md §4` 登记(§6.8 第 2 条);WP1.3/2.2/3.1 直接往该目录放 prompt 资产,**无需再找架构师登记**。

> **原 §6.1「需回头找架构师确认」三条已全部消化**:① Skill 目录已登记(本节第 5 条);② 层视图 `v3-index.md`/`v3-1…v3-5` 引用已从 `v3-requirements.md` / `docs/README.md` / 本文删除(文件本不存在);③ `/v1` 保留白名单已在 `architecture.md §6.8 第 1 条`定死(只删生成链路 v1/v2,基建端点保留)。**本文不再留任何开放项。**
