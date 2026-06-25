# 共享组件与边界 — 详细设计

- 日期:2026-06-26
- 状态:详设(待总架构师审耦合点)
- 归属:蓝图(`2026-06-25-agent-system-blueprint.md`)§0/§4/§5 + Stage3 设计(`2026-06-26-stage3-edit-agent-design.md`)的共享件展开。
- 高度:**只锁接口/契约/边界**。每个共享件给:签名 + 调用约定 + 被谁消费 + 失败兜底。**不深入各板块内部算法/prompt/token**。
- 用法:其它 5 个板块架构师**只引用本文签名,不重设**。颜色算法、loop 算法等黑盒由 boss/各板块内部决定,本文只锁其输入/输出契约。

> 已接地的现有代码均给绝对路径,签名以现状为准。"NEW/EXTEND/REUSE" 标注是否新建。

---

## 0. 六个共享件总览(签名速查)

```
1. finalize_color(generic: GenericColor) -> "#RRGGBB"                          # NEW(agent 端;★服务颜色设计——章节色 Stage4 + 封面色 Stage5,同一套)
1b. accent_of_group(photoIds, photos_by_id) -> "#RRGGBB"                        # NEW(代码识别/提取;Stage1 1d 提取色,喂 AI 设计,非最终色)
    accent_from_photo(...) -> "#RRGGBB"                                         # NEW(单图代码识别/提取;Stage5 封面色用它从封面照片出提取色,喂 AI 设计)
2. gemini_layout({units, structureDesc, mode, allowAddPages}) -> {pages:[...]}  # EXTEND(现 template_select)
3. to_simple(realIds) -> (simpleIds, map);  from_simple(payload, map) -> payload # NEW helper(抽现有逻辑)
4. GET /internal/agent-data?type=page-info|chapter-search  -> 信封              # NEW(Web 端,Agent 读回调)
5. agent 自有库:同一 Postgres 实例 + 独立 schema `agent` + Alembic           # NEW(决策已定)
6. skeleton_v3.*(legal_candidates/pick_template_v3/assign_images_v3/validate_grouping/coverage) # REUSE(签名不变)
```

被谁消费(锁死消费方,板块架构师按此引用):

| 共享件 | Stage1 | Stage2 | Stage3 | Stage4 | Stage5 |
|---|---|---|---|---|---|
| 1 finalize_color | | | | ✅ 章节色(AI 设计→hex) | ✅ 封面色(AI 设计→hex,同章节色一套) |
| 1b accent_color 识别/提取 | ✅ 1d 提取色(依据) | | | | ✅ 封面色提取色(`accent_from_photo`,依据) |
| 2 gemini_layout | | ✅ select | ✅ case4-swap | | |
| 3 to/from_simple | ✅ 识图+余量归组 | ✅ 排版喂图 | ✅ 工具喂图 | | ✅ 封面色喂图 |
| 4 /internal/agent-data | | | ✅ T1/T2 读工具 | | |
| 5 agent 自有库 | | | ✅ edit 会话/消息/操作日志 | | |
| 6 skeleton_v3 | | ✅ 兜底 | ✅ case3/case4 兜底 | | |

> ★颜色分工:**颜色识别 = 代码**(`accent_of_group`,Stage1 1d 出**提取色**,真相源 = `detail-stage1.md` §1d,是依据非最终色);**颜色设计 = AI**(Stage4「颜色设计」skill,吃提取色作依据出最终色);**finalize_color 归一化**(AI 设计出的色 → 最终 hex,章节色 + 封面色都用)。

---

## 1. `finalize_color()` — 设计色→最终 hex(★服务颜色设计:章节色 Stage4 + 封面色 Stage5)

> ★角色:AI 颜色设计(Stage4 章节色、Stage5 封面色)出的颜色经本函数归一化为最终合法 hex。章节色 = Stage4 AI 用 Stage1 1d 提取色作依据设计 → finalize_color;封面色 = Stage5 AI 用 `accent_from_photo` 出的封面照片提取色作依据设计 → finalize_color(与章节色同一套模型)。这是唯一出最终色口。

### 1.1 推荐落点:**Agent 端**(`apps/agent/src/engine/finalize_color.py`,NEW)
理由:
- 现有最终色逻辑在 agent(`theme_recommend/handler.py::_coerce_accent`、`engine/apply_theme_v3.py`、`engine/finalize_v3.py::_bake_*`),Web 从不算色、只存 hex。把"设计色→hex"留在 agent,Web 仍只持久化结果,符合不变式「Web 只管相册数据」。(注:`_coerce_accent` 保留 —— 它就是 Stage4 把 AI 出色归一化的落点,见 §7 风险 5。)
- Stage5 封面色由代码 `accent_from_photo` 出提取色 + AI「颜色设计」skill 设计,均在 agent 内,finalize_color 就近转换零跨网。
- 渲染契约冻结:`AccentColor`(`#RGB|#RRGGBB` 正则,`packages/contracts` 与 agent schemas 双侧已有)是唯一出口类型,本函数输出必须满足它。

### 1.2 签名(锁定)
```python
# apps/agent/src/engine/finalize_color.py
GenericColor = str  # 通用色输入(黑盒格式,boss 待给:可能是 token 名 / hsl / 自然语言色)

def finalize_color(generic: GenericColor) -> str:
    """通用色 → 最终 '#RRGGBB'(大写)。唯一出最终色口。
    内部算法=黑盒(boss 待给)。本文只锁契约+兜底。"""
```

### 1.3 契约
- **输入**:`generic`(设计色,黑盒;Stage4 来自 AI「颜色设计」skill 出的章节色、Stage5 来自 AI「颜色设计」skill 吃封面照片提取色设计的封面色 —— 同一套)。
- **输出**:`"#RRGGBB"` 大写六位,**保证**匹配 `AccentColor` 正则;3 位 hex 一律展开为 6 位。
- **纯函数**:无 IO、无网络、确定性。
- **失败兜底**:输入无法解析/越界/抛错 → 返回常量 `FALLBACK_ACCENT = "#4A5568"`(沿用现 `theme_recommend._FALLBACK_ACCENT`),**绝不抛**给上层。失败计 telemetry,不阻断管线。

### 1.4 调用约定
- Stage4:★**调用**(章节色 = AI「颜色设计」skill 用 Stage1 1d 提取色作依据出色 → `finalize_color` 归一化 → `V3Chapter.accentColor`)。
- Stage5:封面/封尾色 —— ★**调用**(与章节色同一套):代码 `accent_from_photo` 出封面照片提取色 → AI「颜色设计」skill 设计封面色 → `finalize_color(设计色)` 归一化 → 经 cover 落地落封面封尾页。
- 章节色经本函数:`V3Chapter.accentColor` 由 Stage4 AI 设计经 `finalize_color` 写定合法 hex;`apply_theme_v3` 接收的 `accentColor` 是 Stage4 产物(Stage1 留 null,只产 `extractedColor` 作依据)。

---

## 1A. `accent_color` 识别/提取 — 颜色识别确定性组件(★NEW,归 Stage1/共享)

> ★定位:**「颜色识别 / 提取」** —— 产 `extractedColor`(提取色)**喂 AI 设计**,**不是产最终色**。最终色由 AI 颜色设计(Stage4)+ finalize_color 出。

### 1A.1 落点:`apps/agent/src/engine/accent_color.py`(NEW,纯代码,无模型无网络)
颜色识别 = 纯代码确定性提取真实主色(提取色),作 AI 颜色设计的依据(解决凭文字瞎猜 / 豆包取色发灰发丑)。算法本体参考 `accent_color.py`:逐像素 HSV → 丢天空/白墙(v>V_HI 且 s<S_HI)、近黑(v<V_LO)、近灰(s<S_LO)→ 剩余有彩像素按饱和度加权统计 24 桶色相、取主色相 → **丢照片自身 S/V、用设计固定 L/S 重建** → 全灰兜底中性色。整章聚合出一个提取色。详口径见真相源 `detail-stage1.md` §1d(本文只引用,不重设数值)。

### 1A.2 签名(锁定)
```python
def accent_of_group(photo_ids: Sequence[str], photos_by_id: Mapping[str, V3AnalyzePhoto]) -> str:
    """整章图片组 → 一个提取色 "#RRGGBB"(确定性,合法 hex)。是 AI 设计依据,非最终 accentColor。"""

def accent_from_photo(...) -> str:
    """单张图 → "#RRGGBB"(确定性提取色)。Stage5 封面色用它从封面照片出提取色,喂 AI 颜色设计(非最终色)。"""
```

### 1A.3 契约 / 边界
- **纯函数**:无 IO、无网络、确定性;输出 `"#RRGGBB"` 合法 hex(作依据写进 tree `extractedColor`)。
- **失败兜底**:全灰/无有彩像素 → 中性色常量(如 `"#8A8174"`);绝不抛。固定 L/S 与阈值是可调设计常量,最终值 boss 定。
- **被谁消费**:Stage1 1d(`accent_of_group`,在 1b 之后、章成员最终定时执行,产提取色喂 Stage4 AI 设计);Stage5 封面色用 `accent_from_photo` 从封面照片出提取色喂 AI「颜色设计」skill。

---

## 2. `gemini_layout` — Stage2/Stage3 共用排版模块

### 2.1 落点:**Agent 端**,抽为可复用模块 `apps/agent/src/engine/gemini_layout.py`(EXTEND 现 `apps/agent/src/agents/template_select/handler.py`)
现状:`template_select/handler.py` 有 `plan_pages()`(切页+挂 `legal_candidates`)与 `fallback_pages()`(纯代码兜底)。本设计把"组装候选 → 调 Gemini 出意图 → skeleton_v3 兜底"封成单一入口,Stage2 与 Stage3 case4 共用,**不各写一份**。

### 2.2 签名(锁定)
```python
def gemini_layout(
    units: list[Unit],            # 每个 unit = 一章(或一簇);绝不把同 chapter 切到不同 unit
    structure_desc: str,          # 结构描述(章节叙事/排版意图,文本)
    mode: Literal["select", "case4-swap"],
    allow_add_pages: bool,
) -> LayoutResult:
    ...

# Unit(输入数据契约)
Unit = {
  "chapterId": str,
  "photos":    [{"photoId": str, "ref200px": str, "orientation": str, "takenAt": str}],  # 200px 真图;takenAt 供调用方 wrap+generic 的 date 装饰(本模块不用)
  # ★candidates 不由调用方传 —— 本模块内部用 legal_candidates 算 + 加载模板预览图组装(§2.3),
  #   下面 candidates[] 是组装后形状,仅作内部说明:
  # "candidates":[{"templateId": str, "previewImage": str, "spec": V3TemplateCandidate}],  # 候选+模板预览图(模块内部产)
}

# LayoutResult(输出契约,★只意图、无色)
LayoutResult = {
  "pages": [{"chapterId": str, "templateId": str, "slots": {slotId: photoId}}]
}
```

### 2.3 模块边界(谁组装、谁兜底,锁死避免重复)
- **谁组装候选(`candidates`)**:本模块内部调 `skeleton_v3.legal_candidates(category="interior", N)`,N=该 unit 图数(多章取章内最大),再贴模板预览图。Stage2/Stage3 **都不自己拼候选**。
- **输入数据从哪来**:
  - 200px 真图:Stage2 由 Web `SelectLayoutRequest` 带入;Stage3 case4 由 T4 触发时 agent 经 **`GET /internal/agent-data?type=page-photos`** 读回该章 200px(★B2 收敛:协议定死走读回调,不靠模糊"Web 重发";base64 来源/隐私见 §4.3)。
  - 模板预览图:agent 侧静态资源(模板预览图资源是新增依赖,见 §7 耦合点)。
  - 结构描述:Stage2 来自 tree 切片;Stage3 来自会话 focus + T1 读到的章节描述。
- **谁跑兜底**:本模块出口**强制**过 `skeleton_v3`:Gemini 出的 `LayoutResult` 逐 unit 喂 `validate_grouping` + 槽位合法性钳;非法 unit 局部降级 = 用 `pick_template_v3` + `assign_images_v3` 只重算失败的 unit(不整批重跑)。**意图非法 → 代码保合法**是 §6 不变式的落点,本模块不绕过。
- **`mode` 语义**:
  - `select`:Stage2 全章首排,输出页可等于 `plan_pages` 的切页数。
  - `case4-swap`:Stage3 换版式;`allow_add_pages=true` 时 `pages` 可超输入页数(加页),由 Stage3 的 `applyLayoutPatchToDraftPages` append 落地(守 pageIndex 稳定,见 Stage3 设计 §5)。
- **★无色铁律**:`gemini_layout` 永不出色;色全程走 §1。

### 2.4 被谁消费
- Stage2「选版式」板块:`mode="select"`。
- Stage3 编辑板块 T4「换版式」:`mode="case4-swap"`。
两者**只调本签名**,不重写候选组装/兜底。

---

## 3. 简易 id ↔ 真实 id 映射 helper

### 3.1 落点:**Agent 端**,抽为 `apps/agent/src/engine/simple_id.py`(NEW,收编现散落逻辑)
现状:`image_understanding/handler.py` 内联了 `simple_photos = [...]` 构造 + `real_by_simple` 字典 + `_remap_describe_photo_ids`。本设计抽成通用 helper,**所有"喂数据给 LLM"处复用**:识图、余量图归组、排版喂图、Stage3 工具喂图、Stage5 封面色喂图。

### 3.2 签名(锁定)
```python
def to_simple(real_ids: Sequence[str]) -> tuple[list[str], dict[str, str]]:
    """real_ids -> (["1","2",...], {"1": realId, ...})。简易 id 从 "1" 起。"""

def from_simple(payload: Any, mapping: dict[str, str]) -> Any:
    """把 payload 里的简易 id 递归换回真实 id;未命中保留原值(容错)。
    payload 可为 list[str] / dict(键或值是 id) / 嵌套结构。"""
```

### 3.3 用法约定
- 凡向 LLM(识图/余量归组/排版意图/Stage3 工具/封面色)发送 photoId/chapterId 的请求,**先 `to_simple`**,把 map 留在调用方;模型回包后**用同一 map `from_simple`** 还原。
- 简易 id **不出 agent 边界**:Web/浏览器永远收真实 id。
- 容错:`from_simple` 未命中的 id 原样保留(模型偶发幻觉 id 不致 KeyError)。
- chapterId 同理可用(余量图归组的 `simpleId→chapterSimpleId` 走同一对函数)。

### 3.4 被谁消费
Stage1(识图 + 余量归组)、Stage2(排版喂 200px)、Stage3(T3/T4 工具喂图)、Stage5(封面色喂图)。

---

## 4. Agent→Web 读回调 `GET /internal/agent-data`

### 4.1 用途与边界
Stage3 渐进加载读工具(T1 页面信息 / T2 分章检索 / **case4 取 200px 真图**)回 Web 取数据。**Web 是 draft_json 唯一真相**,agent 不持有相册布局,按需来取。
- **本端点服务 page-info / chapter-search / `page-photos`**。
- **★`page-photos`(B2 收敛)**:Stage3 **case4 换版式**(T4)需要该章 200px 真图喂 `gemini_layout`。蓝图 §4「case4 重发 200px」原表述含糊(edit-chat 请求体**不带任何 base64**,见 Stage3 §1/§7);本文**定死协议** = case4 触发时 agent 经本回调 `GET /internal/agent-data?type=page-photos` 读回该章 200px,**不靠浏览器重发**(与 T1/T2「agent 按需拉」同构,不破"树不经浏览器"不变式)。
- **history 不走这里**:对话历史属 agent 自有库(§5),T-history 读 agent 自己的表,不回 Web。(注:这是对 Stage3 设计 §6「type=...|history」的收敛——history 既已迁入 agent 库,就不再经此回调。见 §7 耦合点。)

### 4.2 落点:Web 端,与现有 `/api/v3/internal/job-progress` 同目录族
- 现有内部回调:`apps/web/src/app/api/v3/internal/job-progress/route.ts`(Agent→Web,`requireAgentSecret`)。
- 新增:`apps/web/src/app/api/v3/internal/agent-data/route.ts`(NEW)。

### 4.3 信封(锁定)
请求(GET,query string;鉴权头同 shared bearer):
```
GET /api/v3/internal/agent-data?type=page-info&albumId=...&scope=page|chapter&chapterId=...&pageIndex=...
GET /api/v3/internal/agent-data?type=chapter-search&albumId=...&query=...&limit=...
GET /api/v3/internal/agent-data?type=page-photos&albumId=...&chapterId=...   # ★case4 取该章 200px
Header: Authorization: Bearer ${AGENT_SHARED_SECRET}
```
响应(JSON 信封,200):
```ts
// type=page-info
{ type: "page-info",
  data: {
    chapter: V3Chapter,          // 章节描述/场景
    pages: V3Page[],             // 该 scope 的布局+文本+completion
  }}
// type=chapter-search
{ type: "chapter-search",
  data: { matches: [{ chapterId: string, pageIndexes: number[], label: string, score: number }] }}
// ★type=page-photos(B2:case4 喂 gemini_layout)
{ type: "page-photos",
  data: { photos: [{ photoId: string, ref200px: string, orientation: string, takenAt: string }] } }
//   ref200px=200px base64。★base64 来源:浏览器是唯一有原图处(Web base64 不落盘),故 case4 这一轮
//   edit-chat 由浏览器随请求带上该 focus 章的 200px;Web 服务端**仅本轮 transient 持有**,经本 page-photos
//   回调转发给 agent(orientation/takenAt 从 draft_json.tree 该章补)。隐私:transient,进 body 后丢引用、
//   不记录、不入 draft(同 §3 隐私红线);喂 gemini_layout 后即弃。
```
错误:复用 Web 错误码族(`apps/web/src/lib/api/error-codes.ts`),`401` 鉴权失败、`404` album 不存在、`422` 参数非法。

### 4.4 鉴权
**复用 shared bearer**:同 `AGENT_SHARED_SECRET`(Web `apps/web/src/lib/env.ts`、agent `settings.agent_shared_secret`)。`route.ts` 走现有 `requireAgentSecret(req)`。**不新增密钥**。

### 4.5 Web 端复用
- `type=page-info`:服务端从 `draft_json` 重切,**复用 `sliceChapterForChat`**(`apps/web/src/services/album/album-service.ts:169`,返回 `{chapter, pages}`);`scope=page` 时再按 `pageIndex` 过滤。completion 判据(`page_filled`/`chapter_completion`)由 Web 拼入或 agent 侧算(本文不锁内部)。
- `type=chapter-search`:服务端在 `draft_json.tree.chapters` 上做匹配(关键词→章/页),复用 `buildRecommendOverviews` 风格的文本切片;**无 base64**(隐私 by construction)。
- **树不经浏览器**(不变式 12):本回调是 agent↔Web 服务端直连,浏览器只发 chapterId/userMessage。

### 4.6 `POST /internal/agent-ack` — Web→Agent 提交确认(★B4 弱一致收敛)
方向**与 §4 相反**(Web→Agent;§4 是 Agent→Web)。落点 = **Agent 端**新路由 `POST /internal/agent-ack`。
- **用途**:Stage3 edit loop 提交协议里,agent 落 `agent.edit_ops`/`agent.edit_messages` 时记 `status='pending'` 并把 `opId` 放进 `CommitBundle`;Web 单事务落相册成功后调用本端点,agent 据 `opId` 把该 op + 关联 message 转 `status='committed'`。**T-history / 喂模型上下文只读 committed**,杜绝"AI 看见自己声称做过、相册却没落"的历史污染(Stage3 §3/§4.1)。
- **信封**:
```
POST /internal/agent-ack
Header: Authorization: Bearer ${AGENT_SHARED_SECRET}   # 同 shared bearer,不新增密钥
Body:   { "opId": string }
200:    { "ok": true }       # 幂等:重复 ack 同 opId 安全;未知 opId → 200 {ok:false}(不抛)
```
- **鉴权**:复用 shared bearer(同 §4.4)。
- **崩溃语义**:ack 没回 → op/message 停留 `pending`,相册以 Web 为准、对话以 committed 为准,遗留 pending 按 TTL 清理(Stage3 §3)。

---

## 5. Agent 自有库(关键决策已定)

### 5.1 决策(锁定)
- agent **有状态**;会话 / 对话消息 / 操作日志存 **agent 自己的表**。
- 表放在 **与 Web 同一个 Postgres 实例、独立 schema `agent`**。
- agent 用 **Alembic** 管自己的迁移;**Web 的 Drizzle 不碰 `agent` schema**,agent **不碰 Web 的 `public` 相册表**。
- **两库各自单写**:agent 写 `agent.*`,Web 写相册表(`public.albums` 等)。无交叉写。

### 5.2 连接方式
- agent 拿 **同一 `DATABASE_URL`**(已是 Web 的 Neon Postgres 连接串),通过 Python 驱动(`asyncpg` / SQLAlchemy async)连接,**search_path / schema 锁定 `agent`**(建议连接级 `options=-csearch_path=agent` 或模型 `__table_args__ = {"schema": "agent"}`)。
- 新增 agent 依赖:`sqlalchemy[asyncio]` + `asyncpg` + `alembic`(加依赖需架构师登记——见 §7 耦合点)。
- agent 现状确认:今天 **完全无 DB**(grep `DATABASE_URL/asyncpg/sqlalchemy/alembic/psycopg` 在 `apps/agent/src` 零命中)。这是从无状态到有状态的真改动,落点收敛在 `agent` schema,不影响 Web 表。

### 5.3 schema / 迁移 / 归属边界
- schema 命名:`agent`。
- 迁移目录:`apps/agent/migrations/`(Alembic),版本号独立于 Web 的 `0009_*`。
- 归属边界:
  - `agent.*` 表 = agent 单写单读(edit loop 会话状态)。
  - `public.albums.draft_json` = Web 单写;agent 只通过 §4 回调读(不直连读相册表),保持「draft_json 唯一真相 + Web 单写」不变式。
  - agent 库**不存**任何 draft_json 内已有的布局/文本/树(只存"对话/loop 状态")——与 Stage3 设计 §2 一致。

### 5.4 表清单 + 字段骨架(只到 schema 级)
```sql
-- agent.edit_sessions  (1 album 1 行;Stage3 会话 checkpoint)
id            uuid pk
album_id      text unique not null      -- 指向 Web public.albums.id(逻辑外键,非 DB 级 FK,跨 schema 不强约束)
version       int  not null default 0   -- 乐观锁/CAS
session_json  jsonb not null            -- focus / cursor / accumulatedDecisions / pendingClarification / 计数
created_at    timestamptz not null
updated_at    timestamptz not null

-- agent.edit_messages  (对话消息;T-history 读这里,取代回 Web 取 history)
id            uuid pk
op_id         text                       -- ★关联本轮 edit_ops.op_id(纯 talk 轮可空);ack 时连同转 committed
album_id      text not null
chapter_id    text                       -- 可空(全书级消息)
role          text not null              -- user|assistant
content       text not null
status        text not null              -- ★pending|committed;T-history 只读 committed(B4)
created_at    timestamptz not null
-- index: (album_id, chapter_id, status, created_at)  -- 仿 albumMessageRepo.findRecentByAlbumChapter

-- agent.edit_ops  (操作日志;已提交动作审计)
id            uuid pk
op_id         text unique not null       -- ★稳定 opId(放进 CommitBundle;Web 经 /internal/agent-ack 回销)
album_id      text not null
session_id    uuid not null              -- -> agent.edit_sessions.id
kind          text not null              -- write_chapter|edit_text|swap_image|swap_layout|advance
status        text not null              -- ★pending|committed;agent 落库 pending,Web ack 后 committed(B4)
payload_json  jsonb not null             -- 该次动作的 patch/decision 摘要
created_at    timestamptz not null
-- index: (album_id, status, created_at)
```
> 字段只到 schema 级;约束/索引细节由 Stage3 板块在实现期定。`album_id` 跨 schema 用**逻辑外键**(不建 DB 级 FK,避免 Drizzle/Alembic 互相耦合)。

### 5.5 与 Stage3 设计的对齐注记
Stage3 设计 §2 原把 `edit_sessions` 写成 **Drizzle 表 + Web migration `0010`**。**本决策推翻该点**:会话/消息/操作日志归 **agent 库(Alembic)**,Web 不再加 `0010_edit_sessions`。提交协议(AI 决定·Agent 提交·Web 记录)中"Web 记录"的范围相应调整:Web 仍单事务写 **draft_json.pages + progress + stage + album_messages(若保留 Web 侧消息镜像)**;**会话 checkpoint 改由 agent 写 `agent.edit_sessions`**。→ 这是关键耦合点,见 §7-1,需总架构师裁定"提交原子性"如何跨两库保证。

---

## 6. `skeleton_v3` 合法性兜底(共享引擎,签名不变)

### 6.1 落点:`apps/agent/src/engine/skeleton_v3.py`(REUSE,签名冻结)
```python
legal_candidates(category: str, image_count: int) -> list[dict]
pick_template_v3(category: str, image_count: int) -> str
assign_images_v3(template_id: str, photos: Sequence[Mapping|str]) -> dict[str, str]   # {slotId: photoId}
validate_grouping(grouping: Sequence[Sequence[str]], photo_ids: Sequence[str], *, category="interior") -> bool
# + 覆盖校验(build/partition/wrap 内部已含)
```

### 6.2 被谁复用
- **Stage2**:`gemini_layout` 出口逐 unit 钳合法 + 局部降级(§2.3)。
- **Stage3 case3(换图,T3)**:`image_edit_intent` grounding 后 `pick_template_v3 + assign_images_v3`(现 `_execute_intent`)。
- **Stage3 case4(换版式,T4)**:`gemini_layout(mode="case4-swap")` 出口同 Stage2 走 `validate_grouping` + 局部降级。

### 6.3 不变式
**"模型只出意图、代码保合法"的唯一落点 = skeleton_v3**。任何模型(Gemini 排版意图 / 豆包换图意图)产出的版式都**必须**过 skeleton_v3 校验/钳裁/兜底才能落 draft_json。各板块**不得**绕过它直接落非法版式。签名冻结,确保 Stage2/Stage3 引用一致、不分叉。

---

## 7. 边界处可能与其它板块重叠/耦合的点(供总架构师审)

1. **提交原子性跨两库**(最高风险):Stage3「Web 单事务记录」原是单库(Web Postgres)原子。现会话/操作日志迁入 `agent` schema(agent 写)、draft_json/progress/stage 仍 Web 写——**一次 edit 提交跨两个写入者**。同实例同事务理论可行(同连接同 schema 可跨,但 agent 与 Web 是两个进程/两套连接),需裁定:是否容忍"draft 落了但会话 checkpoint 失败"的弱一致(靠 version CAS 重放修复),还是要求 agent 也读写 draft(破坏 Web 单写)。**建议**:agent 先写自己库 checkpoint,再由 Web 单事务落 draft+progress+stage;两者用 `version` 对齐,失败可重放——但需总架构师确认这与 Stage3「单写入者+原子」表述的偏差可接受。

2. **agent 加 DB 依赖 + 顶层 `apps/agent/migrations/`**:违反 CLAUDE.md「加依赖 / 加顶层目录先问架构师」。新增 `sqlalchemy/asyncpg/alembic` 与 Alembic 目录、`architecture.md` 需登记;Fly.io 部署需注入 `DATABASE_URL`(env 文档 `deploy/env.production.md` 要加 agent 侧)。

3. **history 来源二选一未对齐**:Stage3 设计 §6 写 `/internal/agent-data?type=...|history` + T-history 复用 `albumMessageRepo`;本文把 history 收敛进 agent 库(§4.1/§5.4)。需总架构师拍:对话消息归 **Web 库(album_messages)** 还是 **agent 库(agent.edit_messages)**?若归 agent 库,则 Web 现有 `album_messages` 表/`albumMessageRepo` 在 Stage3 的角色需重定(镜像?废弃?)。两处不能各执一词。

4. **模板预览图资源**:`gemini_layout` 需要"模板预览图"喂 Gemini,agent 侧目前 `template_select` 只用 `TemplateDef`(无预览图)。新增预览图静态资源是新依赖/新资产,Stage2 与 Stage3 共用同一份。★**已裁定(chief-review B3)**:烘焙脚本入 `apps/web/scripts/`、产物存 `packages/contracts/template-previews/`(随模板库,Stage2/Stage3 共用一份,`gemini_layout` 模块从该路径加载)。

5. **finalize_color 收编 + 颜色识别代码化**:实测代码中只有 `_coerce_accent`(theme_recommend/handler.py)真做设计色→hex 归一化;`_apply_page`(apply_theme_v3.py)、`_bake_text_slots`(finalize_v3.py)只**消费**已合法色。★新模型:**颜色设计 = AI「颜色设计」skill**(Stage4 吃 Stage1 1d 提取色作依据;Stage5 封面色吃 `accent_from_photo` 出的封面照片提取色作依据 —— 同一套);**颜色识别 = 代码**(`accent_of_group` / `accent_from_photo` 产提取色,是依据非最终色);**finalize_color 在**(AI 出色经它/`_coerce_accent` 归一化成最终 hex)。`_coerce_accent` **保留**(它就是 finalize_color 在 recommend 端的落点)。唯一出最终色口 = finalize_color(章节色 Stage4、封面色 Stage5,同一套)。需确认:下游 `_apply_page`/`_bake_*` 收到的 `accentColor` 一律是已合法 hex,不再各自钳色,"唯一/不重复出色口"在新模型下成立。
