# Agent V3 需求文档

> **状态**:已评审,作为 V3 实现依据。本文只写「**要做什么 / 边界在哪 / 谁负责**」的**已定结论**,不含开放式待决策(以免干扰实现)。
>
> **来源**:用户口述需求 + Frame 2–7 线框图(2026-06-18)。
>
> **前置阅读**:`docs/architecture.md` → `docs/agent/contract.md` → `docs/agent/design.md`(现有 V2 实现)。
>
> **文档层级**:本文是 **V3 总约定框架**需求(定流程、边界、职责、契约)。各模块**施工时各自再写详细方案/需求文档**,把框架级未细化的机制(如调色/字体的精确控制模型)在那里敲定——本文不预先硬敲那些施工级细节。

> **导出失败**:当前只记日志 + 前端弹框;飞书服务台推送**后置**(方案已调研记录,上线后视失败率再加,§4.5)。

---

## 0. TL;DR(V2 → V3 变更概览)

| 维度 | V2(现状) | V3(目标) |
|---|---|---|
| 主流程 | init → theme → chapter-chat → finalize → edit | **五环节状态机**:分析 → 章节故事 → 确定主题与章节色 → 书籍设计 → 待导出 |
| 进入编辑器 | 等 init 回调出草稿树 | **点「下一个」≤ 0.5s 进入编辑器**,分析在后台异步跑,前端放加载动画 |
| 模型分层 | vision(火山)+ DeepSeek | **两类**:① **识图模型 = GPT-5.5 Mini**(图片分析 + 主控:布局/主题/章节色;火山 doubao-vision 退为**备用/failover**)② DeepSeek(章节文案) |
| 分析产出 | 草稿树(无正式文案) | 草稿树 **+ 通用文案/通用色 + 即时预览**(文案与色彩来自模板,不基于用户图片) |
| 章节文案 | chapter-chat 一次性问答 | **按章顺序引导**(DeepSeek 为主),AI 先问不擅自动笔;全部章节补齐后才进下一环 |
| 主题/色/字体 | theme(主题 + 封面) | **主题 + 章节色 + 字体,写入 `layout.json`**;识图模型按 Skill 推荐,脚本一键批量渲染(含 SVG 图层) |
| 封面 | 强制存在,混在 skeleton | **独立「书籍设计」环节,可跳过**;画板里封面/封尾**单独成页** |
| 导出 | finalize | **状态闸**:章节故事完成即解锁导出(主题/封面不卡);失败重试 3 次→弹框+日志(飞书推送后置) |
| 积分 | init 成功按张扣(PR#147) | **不变**:仍 init 成功即按张实扣(⌈张数/10⌉);失败 release;**不引入锁定/R2/8h**(§5) |
| 模板契约 | slot/scene(Python)↔ category(改造中) | **已统一为现行 JSON**:`category`(并入 scene)/`pairing`/`images`/`svgs`/`texts`/`items` + `variableDecor` 渲染标记(§9) |
| 去重逻辑 | union-find(单批从不触发) | **已删**,仅剩残留代码待清理 |

---

## 1. 顶层目标 & 体验红线

1. **极速进入(硬红线)**:用户从 Home 或「我的相册」发起新增相册,点「下一个」后 **必须在 0.5 秒内进入编辑器主页面**。
   - 照片解析 / 后端分析(预计 1–2 min)放到进入之后异步进行;前端展示**加载动画**并标注「正在分析照片」(Frame 3),用户可离开稍后回来。
   - 含义:**建相册 + 跳转编辑器** 必须与 **分析任务** 解耦——分析未完成不阻塞进入。
2. **五环节顺序推进**,以五个环节作为**状态主控**。
3. **过程透明**:编辑器顶栏常驻面包屑 `分析 >> 章节故事 > 确定主题 > 书籍设计 > 待导出`,当前环节高亮。
4. **AI 引导而非代劳**:涉及创作的环节,AI 先引导/征询,不擅自决定就开写(Frame 4 批注)。

---

## 2. 五环节状态机

```
            点「下一个」(≤0.5s)
  Home / my-albums ─────────────► [编辑器已打开,后台起分析任务]
                                          │
   ┌──────────────────────────────────────┘
   ▼
 ① 分析 ──► ② 章节故事 ──► ③ 确定主题与章节色 ──► ④ 书籍设计 ──► ⑤ 待导出
   │            │                  │                    │            │
   │            │                  │                    │            └─ 导出免费(积分已在 init 成功时扣)
   │            │                  │                    └─ 封面/封尾(可跳过,单独成页)
   │            │                  └─ 主题+章节色+字体→写 layout.json→脚本一键渲染
   │            └─ 逐章引导讲故事,补齐文案(布局变动→识图模型)
   └─ 压缩→识图分析→分组→套模板→填通用文案/通用色→出预览
```

- **状态归属(已定)**:整本相册的主状态(五选一)存 **Web DB**(相册行加 `stage`),Web 为唯一真相源;Agent 全程无状态(见 §8)。
- **导出闸门(已定)**:导出(⑤)解锁 = **「章节故事」全部章节完成**。主题(③)、封面(④)**不卡导出**(封面可跳过;色/字体有分析阶段通用值兜底)。

---

## 3. 角色与职责边界

### 3.1 三端职责

| 端 | V3 职责 |
|---|---|
| **Browser** | 唯一持原图;**端内压缩**(800px / base64);本地 `@react-pdf/renderer` 出 PDF;渲染五环节 UI、加载动画、面包屑;章节故事交互组件;**画板把封面/封尾单独成页展示**(§4.4)。 |
| **Web (Next.js)** | 建相册 + **秒级跳转编辑器**;转发 base64 不落盘;持有 layout 树 + `stage`;调度各环节对 Agent 的调用;**积分扣费**(§5,init 成功即扣);导出失败日志(飞书推送后置,§4.5)。 |
| **Agent (FastAPI)** | 无状态。承载两类 LM 调用 + 确定性引擎(分组 / 套模板 / flatten / 校验)。 |

### 3.2 两类模型

| 代号 | 角色 | 用在哪 | 选型 |
|---|---|---|---|
| **识图模型**(分析 + 主控) | 第一轮图片分析(含现有 Agent 分析字段)+ 布局变动校验/调整 + 主题/章节色推荐 | ①(b)、②(c)、③(a) | **主:GPT-5.5 Mini;备用:火山 doubao-vision** |
| **DeepSeek**(文本) | 引导用户讲章节故事 + 填章节文案 | ②(b) | DeepSeek 等(便宜、语感好) |

- **接入点**:`settings.py` 已同时预留 `OPENAI_*`(主)与 `ARK_*`(火山,备用)两套 OpenAI 兼容槽位。识图模型默认走 OpenAI 通道,GPT 不可用 / ① 重批量分析过慢时切回火山。
- **识图模型是 V3 核心**:同一个有视觉能力的模型既做识图分析、又当「主控」负责一切「会改变版面观感」的判断;DeepSeek 只管文字,不碰布局。

---

## 4. 逐环节需求

### 4.1 分析环节(Frame 3)

目标:用户进来很快看到一本「已排好版、填了通用文案/通用色」的预览。

| 步骤 | 内容 | 负责 |
|---|---|---|
| (a) | 浏览器端图片压缩 | Browser |
| (b) | **识图模型 → 章节树(簇感知,可并发)**:模型只做三件事——① 把图分到各章(分章)② 写每章 `description`(主要画面 / 人物 / 情绪氛围 / 地点场景)③ 写每图一句 `sceneDescription`。按 `describe-content` skill 约定结构输出 JSON(§6)。**当照片带 `clusterId`(#232)时**,describe 按簇分组、整簇打包,总数大时**多路并发**(`asyncio.gather`,互不跨簇)再按簇全局序合并、章节重编号——既消除大批量 omission、又并发提速;`clusterId` 缺省时退化为当前「一次大批 / 模型自由分组」。详细调度/合并实现见 `design.md`、WP-C(#232)| Agent · 识图模型 |
| (c) | **代码补全 photo 确定性属性**:每张图的 `width/height/orientation`(输入宽高算)、`takenAt`(EXIF)由**代码批量填**,不经 LLM;时间作为 (b) 分章的输入信号喂给模型(**不抽 GPS、无地点信号**;另可借浏览器派生的不透明 `clusterId` 共址/共时标签,见 §11 第 4 条)| Agent · 确定性引擎 |
| (d) | **模板套用**:`select-template` skill 按各章特征(图片数 + 内容摘要)选版,确定性引擎兜底合法性(§6) | Agent · 识图模型 + 确定性引擎 |
| (e) | **填通用文案/通用色 + 占位点缀**:**不生成正式文案**,直接用模板自带通用文案 + 填照片;章节 `accentColor` / `artFont` 先填通用占位 → 出**预览**,环节结束 | Agent |

**章节树结构**(第一步输出,落 `draft_json`,五环节全程复用、**绝不重生成**):

```jsonc
{
  "chapters": [
    {
      "chapterId": "c1",
      "description": "京都初春清晨,母女走过落雪老街,安静温柔;祇园一带。",  // LLM 写
      "accentColor": null,   // 占位,theme 环节填(每章挑 1 图 → 取色工具采样)
      "artFont": null,       // 占位,theme 环节填(从固定字体包选)
      "photos": [
        {
          "photoId": "p1",
          "sceneDescription": "穿红大衣的女人走在雪中街道上",       // LLM 写
          "width": 800, "height": 1200, "orientation": "portrait", // 代码:输入宽高
          "takenAt": "2024-03-15T08:30:00"                         // 代码:EXIF(不抽 GPS,无 location)
        }
      ]
    }
  ]
}
```

- **LLM 只写 3 处**:章节 `description` + 选图归章 + 每图 `sceneDescription`;其余字段全由代码批量覆盖——省 token、提准确度(同 §9「模型出意图、代码保确定性」)。
- **已砍**:V2 逐图的 `tags` / `quality` / `peopleCount` / `mood` / `timeOfDay`(图片槽 quality/orientation 概念整体作废,见 §9);grouping 不再是 vision 之后的独立确定性步骤,**分章并进识图模型这一次调用**。
- **一图一章**:每张 photo 只归属一个 chapter,不跨章。
- **`accentColor` / `artFont` 与品牌字体无关**,是排版专用的点缀色 / 艺术字:分析期占位,theme 环节由识图模型(每章挑 1 张代表图 → Agent 端从 base64 采样主色定色 + 从固定字体包选字)出值,代码一键刷到该章所有 `variableDecor` 槽(§4.3 / §9)。
- V2 grouping 只按时间 + groupHint;**V3 分章改由识图模型做**,加「画面整体性」信号 + 浏览器派生的不透明 `clusterId` 共址/共时标签(#232);**仍不接入地点 / GPS / 坐标**。
- ✅ **【已定 #232】clusterId 共址/共时标签**:浏览器本地从 EXIF 时间/GPS 派生一个**不透明** `clusterId`(`c1`/`c2`/…),只发标签、**绝不发坐标**,作为 (b) 簇感知 describe 的预分组输入。比原始 GPS 弱得多(只表达「这几张同址同时」),产品已确认接受。算不出(无 EXIF / 无 GPS)→ null/缺省 → describe 退化为当前行为(向后兼容)。§3 隐私红线随之放宽到**允许 `clusterId`、仍严禁 location/place/GPS/坐标/经纬度任何真实位置字段**。
- ❌ **【已定 2026-06-18】location/GPS 不接入**:V3 草案曾拟重新接入地点供分章,**产品拍板撤销**——排版不需要地址,GPS 反查(本地打包全球城市库几 MB,或调外部地理 API 的配额成本)与体验提升不成正比。**Stage 0 只读 `takenAt`,不抽 GPS;`location`/`place` 字段不产出(恒 null)。** §3 隐私 维持「不抽 GPS」(architecture §3 / §6.8 第 3 条);redact 列表保留 `lat/lng/...` 作防御红线。clusterId 是上一条的不透明标签例外,**不是坐标**,不与此条冲突。
- 预览即「同一棵树的初态」(见 §7 数据流):此刻文案与色彩**均来自通用模板**;后续章节故事覆盖正式文案、主题环节覆盖正式色彩。
- 全程异步;失败要可重试,不能把用户卡死在加载动画里。

### 4.2 章节故事环节(Frame 4)

目标:逐章引导用户口述「章节故事」,补齐每章正式文案。UI 沿用之前写好的界面(对话 + 缩略图条)。

**本质 = 章节间顺序状态机 + 章节内无序 turn 式交互**(✅ 已定 2026-06-18):

#### (1) 章节间:严格顺序,一章一确定

一本书有多章,**AI 写完一章 + 用户确定 → 才进下一章**,一章一章推进。Web 持 `stage` + 当前章 + 各章 `done` 标记;**所有章节确定后**才解锁导出(§4.5)。

```
chapter 1 (内部自由交错) → 确定 → chapter 2 → … → 全部确定 → 解锁导出
```

#### (2) 章节内:三个动作自由交错,**不是管线**

引导 / 写 / 改三个动作**没有固定顺序**——③ 可先发生、可插在 ② 之后、可反复。所以章节内**不能建模成 pipeline**,而是**按 turn 推进的交互状态**:每个 `/v3/chapter-chat` = 一个 turn,Agent 按用户这次的意图分派动作。

| 动作 | 模型 | 资产 | 说明 |
|---|---|---|---|
| ① 引导 | DeepSeek | **引导 Skill** | AI 先开口提问,不擅自开写(Frame 4 红线);引导话术写进独立 Skill |
| ② 写 | DeepSeek | **写作 Skill** + 模板逐槽 `hint` | 收齐用户故事后**一次性写满全章** `pagesTexts`;创作风格走写作 Skill,不再写死代码 |
| ③ 改 | 见下 | — | 用户选中某页让 AI 重写,对话式(复用现有 `focusedPageIndex` 焦点页机制) |

#### (3) ③ 改页的图文分流(用户驱动)

焦点页重写里,**改文字 vs 动图片**分两条路,**触发权在用户**:

- **纯文字诉求**(改文案 / 语气)→ **DeepSeek**。它"看见"那页是结构化数据(templateId + `slot→photoId` + texts),够用。
- **用户对某张图不满 / 要换图挪图**→ 写作 LLM 判断"这需要动图" → **交识图模型(GPT-5.5 Mini)接手**(它真看像素),出「意图」后再交确定性引擎 `pick_template` / `assign_images` 执行(模型不直接编 templateId,§8.3)。
- 不是每次编辑都上识图模型——**只有涉及图片时才升级**,纯文字始终走 DeepSeek。

#### (4) 写作 LM 的信息装配

```
写作 LM 输入
  用户信息(history + userMessage + brief)
+ 写作 Skill(创作风格,集中维护)
+ 模板逐槽 hint(文案指引,模板里会有,Agent 透传——Agent 不自编 hint)
+ 画面背景(章节 description + 每图 sceneDescription,来自 §4.1 分析树)
+ 页面结构(本章总页数 + 每页槽位 id/role/lang/maxChars + 每页放了哪些图)
──► 一次性写满本章所有页 pagesTexts
```

- **代码侧 `writing_guides` 只留确定性约束**(哪些 role 归 LM 写、decoration 自动填、maxChars clamp);**创作性文字全部移出代码、进写作 Skill**(旧 `ROLE_GUIDES` 角色指引退场,不留兜底)。
- 模板逐槽 `hint`(文案编写指引)由**模板维护方**填进模板 JSON,Agent 侧 `page_slot_specs` 需把 `hint` 一并透传给写作 LM(现仅传 id/role/lang/maxChars,缺 hint,待补)。

### 4.3 确定主题与章节色(Frame 5 / 6)

目标:定**每章主题(subject,作章节标题)** + 每章点缀色 + 字体,**写入 `layout.json`**,脚本一键渲染。

- (a) **识图模型按 Skill 逐章推荐 subject + 章节色**(`recommend-theme` / `recommend-chapter-colors`,见 §6)。**【已定 #236】环节产物纯逐章** `{chapterId, subject, accentColor, artFont}` —— 不再产 album 级 `themeOptions(subject/label/tone)`;`subject` 是 grounded 该章照片+故事的一句章节主题(英文,简短,无句末标点),用户确认后**作章节标题**(进章节时对话框「章节卡片」+ 章节页 `title` 槽 + 画板定位到当前章)。
- (b) **一键渲染**:颜色确定后,用工具一键批量填充**文字 + 点缀元素**,完成内页渲染;同时把每章 `subject` 持久化到该章 `title` 角色文字槽(`apply-theme` 确定性写入)。
- **数据决策**:
  - 章节色 / 字体 **定义在 `layout.json` 里**(不是纯前端临时变量)。
  - **品牌字体库固定**(就那么几个),用户在最后一步选其一。
  - 渲染时**脚本一键批量填充**,**含模板变量里的 SVG 图层**。
- 校验需**认识这些字段**(章节色/字体的允许集 + 合法值)。
- **细化留待施工文档**:章节色/字体「**按章节控制**」的精确模型(映射规则、用户可调粒度、与 `variableDecor` 的对应)属施工级细节,在该模块(③)的详细方案文档里定;本框架只锁定「写入 `layout.json` + `variableDecor` 落点 + `apply-theme` 一键刷 + 每章 subject 作标题」。

### 4.4 书籍设计 / 封面设计(Frame 6)

目标:选封面 + 封尾,自动成稿;封面可跳过。

- (a) **系统模板**:封面、封尾系统模板;**用户可选择展示或不设计封面**(可跳过)。
- (b) **自动填充**:选定模板后系统自动填充内容 + 生成版案。
- **删掉「page 0 必须是 cover」的校验规则**(封面可跳过,page0 不再保证是封面)。
- **画板展示:封面 / 封尾单独成页**,不混进明细(跨页)里——**需 Web 端配合**,在用户可见画板中把封面、封尾单列。

### 4.5 待导出环节(Frame 7)

- (a) **状态锁定**:**仅当「章节故事」全部章节完成后**,PDF 导出按钮才出现/可用(主题、封面不作为闸门)。
- (b) **流程结束**:提示「**太棒了,你的书已经准备好了!**」+ 一键导出按钮。
- (c) **导出本体**:Browser 端 `@react-pdf/renderer` 出 PDF → 上传 R2(架构不变)。
- (d) **导出失败处理(已定)**:出 PDF / 上传 R2 失败时**自动重试,最多 3 次**;**连续 3 次失败**触发:
  1. 前端**弹安抚弹框**安抚用户;
  2. 记录**错误日志**(当前阶段只到这一步)。
  - 失败**不涉及积分**:积分早在 init 成功时已实扣(§5),导出环节既不扣也不退。
- **飞书服务台推送 = 后置**:当前**先只做日志**,不实现飞书推送;**上线后视真实失败率再决定是否加**。方案已调研、记录如下备用(届时直接照做):
  - **推送走飞书「自定义机器人 Webhook」**(不用自建应用 API——Serverless 无需管 token、零状态、量小够用);现有自建应用凭据保留为后备。
  - **计数在前端**(失败 +1、成功清零、满 3 触发弹框 +(届时)调一次告警端点);服务端只负责推送 + **去抖**(同相册短期只推一条,防刷屏)。
  - 代码:Web `POST /api/v1/alerts/pdf-export-failure`(nodejs runtime)→ `src/lib/feishu/helpdesk.ts` 发富文本 `post` 消息(沿用 Creem webhook 的「薄 route + lib」风格)。
  - env:`FEISHU_HELPDESK_WEBHOOK_URL` / `FEISHU_HELPDESK_WEBHOOK_SECRET` / `FEISHU_ALERTS_ENABLED`。
  - 红线:推送 **fire-and-forget**、3–5s 超时、**开签名校验**(HMAC-SHA256)、端点校登录态、消息体**脱敏 + 截断**、带 `env` 字段避免 preview 告警混入正式群。
  - 消息体字段:相册 id、用户标识(脱敏)、失败环节(本地生成 / R2 上传)、错误信息(截断)、次数、时间、环境。

---

## 5. 积分扣费(沿用现状,不引入锁定 / R2 / 8h 三段式)

> ✅ **【已定 2026-06-18】扣点不调整,仍在 init 成功即真实扣**(沿用 `architecture.md §6.7`,无需改写)。评审一度提的「init 锁定 → R2 上传成功转实扣 → 8h 未导出兜底转扣」三段式**已否决**,不在 V3 落地。

| 时点 | 动作 |
|---|---|
| **init(分析)成功时** | 在 `handleInitCompleted` 同一事务里 `settle`——**真实扣减**,按张计费 ⌈照片张数 / 10⌉ credits(`PHOTOS_PER_CREDIT=10`) |
| **init 失败 / 超时** | `release`(从未真扣,无退款中间态);兜底由 zombie sweeper 收尸(读时机会式 5min 阈值 + 每日 cron / 10min 阈值——cron 一天跑一次、扫 RUNNING 超 10min 的 job,**不是每 10min 扫一次**,`design.md §7`) |
| 章节故事 / 主题 / 书籍设计 / 导出 | **全部免费**,不二次计费;**导出成功或失败都不碰积分** |

- **为什么不做 R2-成功扣 / 8h 兜底**:① init 成功即扣最简单,导出失败根本不涉及积分,不存在「导出失败要退款」的别扭(那是「导出按钮出现即扣」才有的问题,本来就没采用);② init 即扣本身已堵住「不导出就无限免费重复分析」——再次分析要再过一次 init、再扣一次;③ 不引入 hold/8h 定时任务,少一套中间状态和兜底触发。
- **8h 兜底(评审遗留项的结论)**:既然扣点回到 init 即实扣,**8h 转扣机制不需要,明确不做**。唯一兜底是 init 未达终态时的 zombie sweeper(release),已存在,无新增。
- **落地动作**:V3 **不改**现有 `creditService.cost(photoCount)` / `handleInitCompleted` 的 settle 逻辑;只要新 `/v3/analyze` 的 init 完成回调**复用同一 settle 路径**即可。`yujee-credit-charge-model` 记忆**无需更新**(结论与现状一致)。

---

## 6. Skills

> Skill 均为 **prompt 资产**(独立 prompt 模板,由识图模型加载执行),非写死的代码模块。**所有 skill 集中放一处、由人工统一维护**(不散落,便于调 prompt)。

| Skill(暂名) | 输入 | 输出 | 用在 |
|---|---|---|---|
| `describe-content` | 一批图(base64)+ 代码提供的时间信号 + 不透明 `clusterId` 簇标签(#232) | **章节树**:分章 + 每章 `description` + 每图 `sceneDescription`(§4.1 结构)。带 `clusterId` 时簇感知、整簇打包、总数大时多路并发再合并(详见 `design.md`/WP-C) | ① 分析 |
| `select-template` | 每组/页特征(**图片数** + 内容/情绪摘要)+ **目标 `category` 下的合法候选** | 选定 templateId(从合法候选里挑最契合的) | ①(d) 套模板、②(c) 换版、④ 封面 |
| `recommend-theme` | 章节概览 + 图片分析摘要 | **每章 `subject`**(一句话章节主题/标题,grounded 该章,作章节标题;#236 不再产 album 级 themeOptions/label/tone) | ③(a) |
| `recommend-chapter-colors` | 各章代表图 + 内容/情绪 + **取色工具**(Agent 端从 base64 采样主色)+ 固定字体包 | 每章 `accentColor`(色值)+ `artFont`(字体包内选一) | ③(a) |

> `select-template`:识图模型出选择,但**只在确定性引擎给出的合法候选集里挑**(候选 = `category` 匹配 + 图片槽数能容纳本组图片数),模型不凭空造 templateId——沿用 §8.3「模型出意图、确定性引擎保合法」的安全模式。模型失败时直接走 §9 的纯代码兜底(按图片数挑模板顺序塞)。

---

## 7. 数据流 & 与现有 V2 实现的 Delta

### 7.1 数据流:同一棵树渐进填充

```
分析: 套模板 + 通用文案 + 通用色  ──►  章节故事: 覆盖成正式文案
                                  ──►  主题/章节色: 覆盖成正式色彩+字体(写 layout.json)
                                  ──►  书籍设计: 加/换封面封尾页
                                  ──►  导出: flatten 定稿
```

一棵 layout 树从头到尾被逐环节"刷新",不是分析树 / 最终树两套。

### 7.2 Delta 表

| 模块 | 处置 |
|---|---|
| `init` 异步 202+callback | **保留强化**——支撑「0.5s 进入 + 后台分析」。 |
| grouping | **改**:加「画面整体性」信号;**不接入 location/GPS**(§3 隐私 维持不抽 GPS)。 |
| 去重 union-find / jaccard | **删残留**。 |
| skeleton 套模板 | **保留**,接新标准化模板契约 + `select-template` skill。 |
| theme 服务 | **改**:扩成主题 + 章节色 + 字体,写 `layout.json`,产出按 Skill 组织。 |
| chapter-chat | **改**:顺序引导 + 完成度闸门 + 文本/视觉双模型。 |
| finalize / 双 validate_v2 | **重定**:拆「渲染硬约束 vs 美学规则」,合并成单一真相源;**删 page0-must-cover**;认章节色/字体字段;容忍无封面。 |
| 封面 | **拆出**独立环节,可选,画板单独成页(Web 配合)。 |
| 模板 JSON 契约 | **前置 + 标准化**:统一 JSON;Python 侧 slot/scene→category 迁移必须先完成(否则 Agent 当前无法启动)。 |
| 识图模型 | **新建**:GPT-5.5 Mini 走 OpenAI 槽,火山 failover;定义"何时介入布局"的判定。 |
| 积分 | **不变**:沿用 init 成功即按张实扣;失败 release(§5)。不引入锁定/R2/8h。 |
| 飞书服务台 | **后置**:当前只做日志 + 前端弹框;飞书推送方案已记录,上线后视失败率再加(§4.5d)。 |

---

## 8. Agent 通信机制

总原则(沿用 `architecture.md` 不变式):**Web 持有 layout 树 + 当前 `stage`,是唯一真相源;Agent 无状态,每次调用收完整上下文、回补丁/子树,Web 合并入库。识图模型也是每次无状态调用,不维持会话。**

### 8.1 端点全景

> ✅ **【已定 2026-06-18】V3 是一套全新的 `/v3/*` 端点集**,不在 V2 路由上原地改。V3 与 V2 有重合(都要识图/分组/套模板/校验),但**区别足够大**,新建一套更清爽。三端的复用边界:
> - **前端 UI**:**复用 V2 的**(编辑器框架、画板、对话板、缩略图条等),只按五环节状态机改造交互流。
> - **Agent 内部逻辑**:**能迁移就迁移**(grouping / skeleton 套模板 / finalize flatten / chat 的 retemplate 工具链 / 校验 都可大量复用 V2 代码),但**以满足 V3 需求为准**——不为复用 V2 而牺牲 V3 需求;复用不便处直接重写。
> - **对外契约**:V3 端点用新的 req/res 形状。**旧 `/v1`、`/v2` 端点随时可下线**——当前**无真实用户**,V3 调通后**直接全部删除**(路由 + service + 旧 schema + 旧测试一并清),不留兼容层、不做灰度。

| 环节 | 端点(暂名) | 模式 | 模型 | Web 传入 | Agent 回 |
|---|---|---|---|---|---|
| ① 分析 | `POST /v3/analyze` | **异步** 202 + callback | 识图模型(GPT-5.5 Mini;火山备用) | base64 照片 + EXIF(`takenAt`)+ 不透明 `clusterId`(#232,可空) | 回调:layout 树(套模板 + 通用文案/色,预览态) |
| ② 章节故事 | `POST /v3/chapter-chat` | **同步** | DeepSeek(+ 识图模型仅布局变动时) | 单章切片 + history + 当前 layout 子树 + userMessage | assistantReply + 章节文案补丁(+ 必要时版面补丁) |
| ③ 主题/章节色-推荐 | `POST /v3/recommend`(承载 2 个 Skill) | **同步** | 识图模型 | 章节概览 + 分析摘要 + 当前 layout | 逐章 `{subject, accentColor, artFont}`(#236,subject 作章节标题;无 album 级 themeOptions) |
| ③ 主题/章节色-应用 | `POST /v3/apply-theme` | **同步**(确定性) | 无(脚本) | 用户选定的逐章 `{subject, 色, 字体}` + 当前 layout | 写入色/字体/SVG + 把 subject 写进 `title` 槽后的 layout 补丁 |
| ④ 书籍设计 | `POST /v3/cover` | **同步**(确定性,可选) | 无 / 识图模型辅助选 | 选定的封面/封尾模板 + 当前 layout | 封面/封尾页补丁(或跳过=空) |
| ⑤ 待导出 | `POST /v3/finalize` | **同步**(确定性) | 无 | 完整 layout 树 | flatten 后的定稿 layout(供 Browser 出 PDF) |

> 异步只给真正慢的 ① 分析(多图 1–2 min,需进度回调,正好支撑「0.5s 进入 + 后台跑」)。其余都是秒级,**同步 + 前端转圈**即可。

### 8.2 时序(一次完整流程)

```
Browser 压缩 → Web 建相册行(stage=analysing)+ ≤0.5s 跳编辑器 + 起 analyze
Web ──POST /v3/analyze──► Agent(202)            [积分:init 成功 callback → settle 实扣 ⌈张数/10⌉;失败 release]
        Agent: 识图分析 → 分组 → select-template 套版 → 通用文案/色
        Agent ──callback──► Web:存 layout 树,stage=story,前端出预览

逐章循环(stage=story):
  Web ──POST /v3/chapter-chat──► Agent(DeepSeek;涉版面→识图模型)
        ◄── 文案/版面补丁;Web 合并、记该章 done
  全部章节 done → stage=theme;导出按钮解锁

Web ──POST /v3/recommend──► 识图模型 ◄── 主题/色/字体候选(用户选)
Web ──POST /v3/apply-theme──► 脚本 ◄── 渲染补丁;stage=cover

Web ──POST /v3/cover──► ◄── 封面/封尾(或跳过);stage=ready

Web ──POST /v3/finalize──► ◄── 定稿 layout
Browser 出 PDF → 传 R2:
   成功 → 完成(积分早在 init 成功时已扣,导出不再动积分)
   连续 3 次失败 → 弹框 + 日志(飞书后置,§4.5d);不涉及积分
```

### 8.3 关键约定

- **stage 推进权在 Web**:Agent 不持 stage;每个端点只做「输入→输出补丁」的纯变换,可重试、可水平扩展。
- **识图模型何时介入(②)**:`chapter-chat` 内部由 Agent 判定——纯文字诉求只走 DeepSeek;一旦涉及版面(换版/放大/挪图),Agent 调识图模型出「意图」,再交确定性 `pick_template`/`assign_images` 执行(复用 V2 edit 的 retemplate 工具链,模型不直接编 templateId)。
- **layout 树流转**:Web 每次传「够用的切片」而非每次全树(②传单章;③④传相关页),控制识图模型的 token。全树只在 ⑤ finalize 传一次。
- **校验**:每个回补丁的端点,Agent 侧用**统一的 validate(单一真相源)** 自校后再返回(替代当前分叉的双 validate_v2)。
- **失败语义**:异步 ① 走回调 `failed`;同步端点走 HTTP 错误码(沿用 contract.md);前端可重试,不污染 stage。

---

## 9. 模板标准化契约(现行格式)

> 模板模块**已统一为下述现行格式**(`packages/contracts/templates/*.json`,单一真相源;TS + Python 双侧 loader 派生)。**模板模块由用户单独维护**,本节只为对齐 Agent 侧消费,不再展开演进。示例:`mag-08`。

> 过渡说明(WP0.2 → WP0.4):下述格式是 V3 最终消费契约。WP0.2 代码库为保证现有
> skeleton 引擎、Python 消费路径和 golden fixtures 不中断,模板 JSON 会临时同时携带
> legacy `slot`/`scene`、图片槽 `quality`/`orientation` 和文字槽 `repeat`;TS/Python
> loader 会校验新旧两层字段。WP0.4 改写引擎后,这些 legacy 字段再删除。

```jsonc
{
  "id": "mag-08",
  "category": "interior",        // cover | interior | toc | ending(替代旧 slot + scene)
  "pairing": null,               // 仅 interior 有意义,默认 null
  "images": [ { "id": "image" } ],                          // 不重复的图片槽
  "svgs":   [ { "id": "divider", "variableDecor": true } ], // 装饰矢量图槽,可选
  "texts": [
    { "id": "title",   "role": "title",      "lang": "user", "maxChars": 12,  "hint": "...", "variableDecor": true },
    { "id": "body",    "role": "body",       "lang": "user", "maxChars": 180, "hint": "..." },
    { "id": "explain", "role": "explain",    "lang": "user", "maxChars": 90,  "hint": "..." },
    { "id": "date",    "role": "decoration", "lang": "en",   "maxChars": 12,  "variableDecor": true },
    { "id": "folio",   "role": "decoration", "lang": "en",   "maxChars": 2 }
  ],
  "items": {                     // 可选:唯一的「重复组」(一行/一格反复出现)
    "images": [ { "id": "image" } ],
    "texts":  [ { "id": "caption", "role": "explain", "lang": "user", "maxChars": 70 } ]
  }
}
```

字段约定:
1. `id` — 模板唯一 id。
2. `category` — `cover | interior | toc | ending`(**替代旧 `slot` + `scene`**),决定进哪个环节候选池。
3. `pairing` — 仅 `interior` 有意义,默认 `null`(跨页配对)。
4. `images` — **不重复**图片槽,每槽 `{ id }`。**【已定 2026-06-18】图片槽不带 `quality`/`orientation`,也不需要**。
5. `svgs`(可选)— **装饰矢量图槽**,每槽 `{ id, variableDecor }`(花饰/分隔线/图标)。
6. `texts` — **不重复**文字槽 `{ id, role, lang, maxChars, hint?, variableDecor? }`:`role` = `title|body|explain|decoration`;`lang` = `user`(随用户语言)/ `en`(固定英文装饰,如 folio/date);`maxChars` 硬上限;`hint` 给写文案模型的逐槽指引。
7. `items`(可选)— **唯一的「重复组」**(一行/一格反复出现)`{ images:[{id}], texts:[{...}] }`,**替代旧 `repeat:true` + bracket-path 键**。

**`variableDecor` = 渲染变量落点**(对应 §4.3 一键渲染):凡 `variableDecor:true` 的 text/svg 槽,就是「章节色 / 一级文字字体 / 花字字体 / SVG 点缀」要刷的地方;`apply-theme` 脚本按此标记批量填,普通正文槽不碰。

校验侧:
- `category` 合法值 `cover|interior|toc|ending`;**已删 page0-必须-cover 规则**(封面可跳过)。
- validate 认 `svgs` / `items` / `variableDecor` / `role` / `lang` / `maxChars`,合法值来自模板声明。
- 重复内容统一走 `items` 组(不再散落 `titles[0]` bracket-path 键),消除旧 finalize/edit 两个 validate 处理不一致的分叉。

> ✅ **【已定 2026-06-18】图片槽 quality/orientation 概念整体作废,不需要 hero 保护**:V2 的 `can_place`/`assign_images`/`_is_hero_slot`/hero-cap 这套硬约束**全部废弃**——图片槽不带 quality/orientation,这两个维度对排图没有意义;图配文槽位也**不做 hero 保护**。新的排图逻辑分两条:
> - **正常路径**:`select-template` skill 由识图模型按分组特征挑模板,图片填入即可——不再做 quality/orientation/hero 任何匹配校验,横竖比错配交给 center-cover 渲染兜底。
> - **兜底路径(LLM 调用失败时)**:走**纯代码确定性逻辑**——按本组图片数 N,从合法候选模板里挑一个**图片槽数能容纳 N 张**(== N 或最接近且 ≥ N)的模板,把这 N 张图**直接顺序塞进槽位**即可,不做任何 quality/orientation/hero 匹配。即「10 张图就挑一个能放下 10 张的模板,直接塞进去」。这是 LLM 失败时唯一的兜底,取代 V2 的 `build_text_first_layout` / `coerce_image_slots` 那套基于 quality 的复杂兜底。
>
> ⚠️ **blocker**:Python `templates.py` loader + `skeleton.py`/`finalize.py` 必须迁到本契约(原要 `slot/scene`,现为 `category/pairing/images/svgs/texts/items/variableDecor`),否则 Agent 起不来、测试 0 收集。

---

## 10. 术语

- **状态主控 / 状态机**:整本相册当前所处环节(五选一),存 Web DB `stage`。
- **识图模型**:具视觉能力的模型(GPT-5.5 Mini,火山备用),既做识图分析、又当主控(布局变动 + 主题/章节色)。
- **通用文案 / 通用色**:模板自带的占位文字与配色,分析阶段直接用,非正式创作产物。
- **章节色**:每个章节的点缀色(accent),写入 `layout.json`,V3 新增维度。
- **服务台**:导出连续失败时,推送告警到飞书的运维/客服通道(后置,§4.5)。

---

## 11. 落地前已敲定的横切决策(2026-06-18)

> 评审 V3 框架时浮现、原本悬而未决的几点,现已逐条拍定(无独立「待澄清」桶,问题归到所属类目)。

1. **积分扣点**(§5)— ✅ **不调整**,仍 init 成功即实扣;锁定/R2/8h 三段式否决,8h 转扣明确不做。详见 §5。
2. **旧端点下线**(§8.1)— ✅ 无真实用户,V3 调通后直接全删 `/v1`、`/v2`,不留兼容层。详见 §8.1。
3. **TS↔Python 契约**(关联 `design.md §14` 漂移)— ✅ **V3 期间以新契约重整两端,`packages/contracts`(TS)为单一真相源先行,Python `schemas.py` 镜像它**。理由:V3 大量新增 layout 树字段(章节色/字体/`variableDecor`/`items`),与其在漂移基础上叠加,不如借 V3 把 TS 真相源补齐、Python 重新对齐。落地排序上,**契约重整是 Agent 各 `/v3/*` 端点的前置**(与 §9 模板 loader 迁移同属「起不来就别往上盖」的地基层)。
4. **GPS / 地点反查**(关联 §4.1 location)— ✅ **不做**:排版不需要地址,GPS 反查(本地全球城市库几 MB,或外部地理 API 配额成本)与体验提升不成正比,**V3 整体不接入 location/GPS**。Stage 0 只读 `takenAt`;§3 隐私 维持「不抽 GPS」(architecture §3 / §6.8 第 3 条);`logging_config.py` redact 保留 `lat/lng/...` 作防御红线。
