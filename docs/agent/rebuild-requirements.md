# Agent 重写 · 需求文档 (v2)

> 遇己(Yujee)AI 人生纪念册 · Agent 模块完全重写的需求基线。
> 最后更新:2026-06-08。本文是**需求层共识**,不是技术施工方案。
> 现状:`apps/agent/` 现有 pipeline 是早期 **demo**,本次按本文整本重做。

## ⚠️ 需先过架构师闸门的条目(CLAUDE.md 硬要求)

| 条目 | 涉及 | 见 |
|---|---|---|
| 新增 v2 交互端点 / 内部树形结构 | 改 Web↔Agent 协议 | §9 |
| `albums.draft_json` 新列 + `album_messages.chapter_id` 新列 | 改 schema | §9 |
| 积分 hold 时机改为 init/finalize | 改积分流程 | §9 |
> 对外**渲染契约**(扁平 `AlbumLayoutPlan`)**不变**,故底层契约无需闸门。

---

## 0. 一句话

用户批量上传手机照片 → 系统**识图 + 分组 + 去重** → 轻对话定**主题** → 确定性排出**图片骨架** → 以"组"为单位**逐章对话**沉淀真实故事并灌文案 → 整体收尾 → 拍平导出。

---

## 1. 核心设计理念(承重墙)

1. **图先于文**:版面(哪张图进哪页/模板)与文案彻底分开。版面=确定性引擎,零 LLM、零 token,可即时急切排;文案=LLM,按组生成,上下文只含本组,永不喂整本。
2. **base64 只进系统一次**:像素只有识图(Stage 1)需要,之后转成结构化 `analysis` 即弃 → 全程纯文本。"原图永不落服务器"天然成立。
3. **对话单位 = 组(Chapter)**,不以"页"为单位(太碎)。
4. **真实优先,防胡编**:配文混合制——有用户输入的图用其事实扩写,没有的走安全氛围文案(不编具体人/事/地)。
5. **全局 arc 兜底**:主题先行(**Stage 2**)约束每章 + 收尾 pass(**Stage 5**)管首尾页与一致性,对冲"碎成一堆无关章节"。
6. **改动局部化**:不满意只重生成那一组的文案(几百 token),绝不重吐整本。
7. **简单优先(v1)**:面向 1000 用户可用性,不为 10 万用户提前上复杂度(如向量去重)。
8. **authoring 与 delivery 分层**:交互期用**树形草稿**,finalize 拍平成**扁平 `pages[]`** 渲染;树永不到渲染器/PDF。

---

## 2. 整体 Pipeline(6 阶段)

```
Stage 0  浏览器准备
   ├─ Canvas 压到 800px(base64)
   └─ 压缩前抽 EXIF:takenAt / GPS   ← now-or-never(压缩会丢 EXIF)

Stage 1  识图 + 分组 + 去重   (Vision LLM · 按 EXIF 时间分批 · 纯文本输出)
   每张 → analysis { desc, tags, quality, orientation, mood, scene, duplicateOf? }
   分组 → groupHint(同一次调用顺带)
   ★ base64 当场丢弃;原始 GPS 反查粗地名后即弃(见 §8)

Stage 2  主题确定   (轻 LLM · 1~2 轮)
   从 clusters 概览提议主旨/基调/风格,或问用户一句 → theme{subject,occasion,timeframe,tone,style}
   可立即出封面 → 早期成品感
   （与 Stage 3 相互独立,可并行;主题不阻塞骨架）

Stage 3  骨架排版   (确定性 · 零 LLM · 零 token)
   for each Chapter:
     ① 分页   : 组内 N 张 → [每页张数…]   (规则见 §4.3)
     ② 选模板 : pickTemplate(每页张数, 照片, 避重)   ← Tool,合法集内随机+seed
     ③ 填图   : 组内照片 → 模板槽位(贴图 cover 吸收比例错配)
   + basePages: cover /(toc,见 §4.3)/ ending
   → 用户立刻看到完整"图片骨架"(图已就位,文案留空)

Stage 4  逐章对话 + 文案   (LLM · 按组 scoped · 自适应)
   对着已摆好的一组发问 → brief → 只生成本组文案灌入 pages.texts
   状态机见 §5;用户随时"直接生成剩余" → 推测补完

Stage 5  整体收尾 pass   (全局)
   开篇页 / 真正的结尾页 / 基调一致 / 模板节奏不重复 / 目录页(如有)

Stage 6  编辑   (chat-edit + pickTemplate Tool;随时换版/换图/改文案)
```

---

## 3. 数据结构(authoring 树 · 仅活在交互期)

```
Album(一本 · authoring 期存 albums.draft_json,见 §9)
├─ meta : { theme{subject,occasion,timeframe,tone}, style, language }
├─ photoPool
│   └─ Photo { photoId, analysis{desc,tags,quality,orientation,mood,scene},
│              exif{takenAt?, place?}, duplicateOf?, used:bool }   ← 去重折叠,不删
├─ basePages { cover, toc?, ending }        ← 与 chapters 平级
└─ chapters : [ Chapter ]                    ← 对话单位
    └─ Chapter {
         chapterId, state(§5),
         cluster{label,timeRange?,place?,role:opening|body|closing},
         photoIds[],                          ← 同组永远在一起
         brief{userWords?,factNote?,mood?},   ← intake 蒸馏
         pages:[ Page{ pageIndex, templateId, images{slot→photoId}, texts{slot→str} } ]
       }                                       ↑Stage3引擎填        ↑Stage4 LLM填(图先于文)
```

**finalize 拍平**(→ 对外扁平 `AlbumLayoutPlan`,见 §9):
```
pages[] = cover → toc → chapter₁.pages → chapter₂.pages → … → ending  (pageIndex 重排 0..N)
```

---

## 4. 模板与骨架排版(Stage 3)

### 4.1 模板
- 每模板有唯一 ID + 图片张数(= `imageSlots` 个数)。真相源 `packages/contracts/templates/*.json`。
- 建"按张数索引的模板表"供 pickTemplate 取用。

### 4.2 朝向/比例(已弱化)
手机照片以竖屏为主、横屏次之。贴图 `object-fit:cover` 吸收比例错配,直接填入。朝向至多软偏好(可忽略)。

### 4.3 确定性规则(已钉死,不再待定)
- **分页 partition**:① hero 图各占一页(1-up);② 其余按每页 3 张切,余 1 → 末两页改 2+2,余 2 → 成一个 2 页。每页张数 ∈ {2,3,4},优先 3。
- **hero 判定**:用 VLM 的 `quality=hero`;**每章最多 1 张当 solo 页**(多出按 detail 进 partition);无 hero 的章不强制 solo。
- **pickTemplate(imageCount, photos[], exclude[]) → templateId**:取槽位数==imageCount 的模板 → 滤掉无法合法容纳的(唯一硬线:fill 图不进 hero 槽)→ 滤掉 exclude(本章/相邻页刚用过)→ 剩余里**按 seed 随机取**。
- **seed**:`hash(albumId + chapterId + attempt)`;reroll 时 attempt++ → 可复现/可撤销;结果存 `Page.templateId`。
- **TOC**:章数 ≥ 4 **且** 总页数 ≥ 8 才加目录页。
- **尾页**:固定 closing 模板 + AI 按整本基调写一句收束语(混合制,用户给了收尾话则锚定),用户可改。

### 4.4 引擎硬保证(按构造成立)
每个图片槽都填满 · 每张 `used=true` 照片在其章内出现恰好一次 · 同页不重复 · 页数合理。→ 无需旧 `layout_rules` 那套回溯修复。

### 4.5 可调参数(有默认,便于调)
每页目标张数(默认 3)· 每章 hero solo 上限(默认 1)· TOC 阈值(默认 4 章/8 页)。

---

## 5. 逐章对话状态机(Stage 4)

```
empty ──asking──▶ asking ──用户答──▶ brief_ready ──生成文案──▶ generated ──收尾──▶ finalized
  │                  │
  └─"直接生成剩余"/跳过─┴──────────────▶ skipped ──氛围文案──▶ generated
```
- **每轮 I/O**:in `{chapterId, history[], userMessage}` → out `{assistantReply, chapterBrief?, state}`。
- **最大追问轮数**:每章默认 **2 轮**,到顶自动前进(brief_ready / skipped),不纠缠。
- **skipped 文案策略**:仅用照片 `analysis` 出安全氛围文案,不编具体人/事/地。

---

## 6. 识图 / 分组 / 去重(Stage 1 细节)

- **一次调用三件事**:识图 + groupHint + duplicateOf,均文本输出。
- **成本**:输入图片 token 是大头 → 按 EXIF 时间**分批**(每批 10~15 张)并行。
- **全局分组主键 = EXIF 时间/地点**:全部照片按 `takenAt` 排序,时间间隔超阈值或地点变化处切章;**VLM groupHint 只在同一时间地点段内做语义细分**,不负责跨批合并 → 跨批冲突消解。
- **跨批去重**:批内由 VLM 判;跨批仅用"EXIF 时间相邻(<X 秒)+ tags 高度重叠"确定性二次扫描兜;无 EXIF 则放弃跨批判重(接受偶发重复)。embedding 留 v2。
- **EXIF 缺失排序**:主键 `takenAt`,缺失退回 `order`(上传序);无时间图按 groupHint + 上传序成章。
- **每重复簇保留 1 张代表图**(VLM 选最佳),其余 `used=false` 折叠保留。
- **纠错入口**:分组在对话里显式说出让用户确认/调整;用户拖图换组 → 引擎免费重排受影响的章。

---

## 7. 对外契约 & finalize(§1 闸门项)

- **底层渲染契约不变**:最终产物仍是现有扁平 `AlbumLayoutPlan`(`magazine + photos + pages[]`,见 `packages/contracts/src/layout.ts`),Web 存 `album_pages`、PDF 渲染器**照旧,零改动**。
- **树是 authoring 工作草稿**,finalize 时拍平成扁平 `pages[]`(§3)。**树永不到渲染器/PDF。**
- **端点并行 v2**:新增 `/v2/album/*` 交互端点,`/v1/layout` 保留至 v2 验证通过再废。
  - `POST /v2/album/init` (异步 202+callback):唯一带 base64;跑 Stage1 → 返回 photoPool/chapters(含骨架)/basePages,base64 丢弃。
  - `POST /v2/album/theme`:Stage2 主题确定 / 出封面。
  - `POST /v2/album/chapter-chat`:Stage4 逐章对话(纯文本)。
  - `POST /v2/album/finalize`:补全未聊章 + 收尾 pass + 拍平。
  - `POST /v2/album/edit`:Stage6 编辑 + pickTemplate Tool。
- **状态模型**:agent 仍**无状态**;base64 只用一次、之后全文本,Web 持有树并每轮回传(payload 随章增长但有界)。

---

## 8. 隐私边界(扩展到 EXIF/GPS · 同步 design.md §9)

- **base64**:只在 Stage 1 用一次即弃,不落盘、不日志。
- **takenAt(时间)**:低敏,入 `draft_json`(排序/分组需要)。
- **GPS**:**默认抽取**,但原始经纬度**比照 base64——只用于反查一次,当场丢弃,绝不入库、绝不日志**;入库的只有**粗粒度地名**(城市/地标级 `place`)。
- **可关闭**:创建页开关"包含地点信息",关则完全不抽 GPS。
- **日志红线**:GPS/原始坐标/place 加进 design.md §9 禁打字段。

---

## 9. Web 存储 & 积分(闸门项)

- **authoring 树**:整棵塞 **`albums.draft_json`(新列)**;**finalize 时拍平写 `album_pages`(现有表不动)**。逐章对话进 `album_messages`(加 `chapter_id` 列)。
- **不重构表结构**(v1 简单优先),只加列。
- **旧 album 兼容**:老作品已是扁平 `layout_json`+`album_pages` 的 finalized 态 → 照旧渲染;新流程只作用于新建作品,**零数据迁移**。
- **积分**:**init 时 hold**(VLM 识图是主成本),**finalize 时 settle**,中途失败 release;逐章纯文本对话不单独计费(计入同一 hold)。

---

## 10. 产品体验层(用户视角)

### 10.1 作品状态(产品文案,非技术枚举)
| 阶段 | 用户看到 | 可做 |
|---|---|---|
| 处理中 | "正在整理你的照片…" | 等待 |
| **草稿就绪** | "草稿已就绪 — 继续讲故事,或直接完成" | 逐章聊 / 直接完成 |
| 完成中 | "正在生成你的纪念册…" | 等待 |
| 已完成 | 进入编辑器 | 编辑 / 导出 PDF |
| 失败 | "生成失败,未扣积分,可重试" | 重试 |
> init 后是**「草稿就绪」**,不是「生成中」——图片骨架已可见,主动权在用户。

### 10.2 用户动作清单(草稿/逐章阶段)
- 回答当前章 / **跳过当前章**
- 上一章 / 下一章
- **调整分组**(拖图换章 / 合并 / 拆分)→ 引擎免费重排受影响章
- **重新生成某章**(reroll 版式 / 重写文案)
- **直接完成全书**(跳过剩余对话)
- 退出草稿(稍后继续)

### 10.3 「直接生成剩余」文案原则(验收规则 · 可测)
> 没有用户事实的章节,文案**只写氛围与画面可见内容,绝不出现具体人名、地名、事件、关系、日期**。
> 可测:抽查 skipped 章文案,不含任何未由用户/EXIF 提供的专有名词。

### 10.4 隐私同意体验(创建页文案)
> 地点开关旁一句:"包含地点信息可帮助自动按地点分组,我们只保留城市/地标名称,不会保存原始坐标。" 默认开,可一键关。

### 10.5 计费体验(积分状态怎么跟用户解释)
| 时点 | 用户看到 |
|---|---|
| init 后 | "已预留 N 积分,完成时结算" |
| 中途退出草稿 | "草稿已保存,积分仍预留(24h 内继续不重复扣)" |
| 失败 | "生成失败,未扣积分" |
| 跳过对话直接完成 | 同正常完成,结算预留积分 |
| 草稿过期(24h 未完成) | "已释放预留积分,可重新开始"(复用现有 recover-stuck cron) |
| 重新进入草稿 | 沿用原预留,**不二次扣** |

---

## 11. v1 验收体验(成功标准)

- [ ] 上传 1 / 2 / 10 / 30 张图都能生成草稿(不报错、不空槽)
- [ ] 用户全程不聊天,也能"直接完成"出一本完整册子
- [ ] 聊过的章节含用户真实事实;没聊的章节只有氛围文案、不胡编(§10.3)
- [ ] 最终册子能进入现有编辑器、就地编辑、导出 PDF
- [ ] 原图 base64 与原始 GPS 坐标:不落库、不进日志(只存粗地名)

---

## 12. 非目标 / v2 backlog

向量去重(embedding,几百张规模)· 人脸/人物贯穿一致 · 中文字体子集化(#31)。

---

## 13. 不变式自查

- ✅ 原图永不落服务器:base64 + 原始 GPS 均用一次即弃。
- ✅ 模板单一真相源:`packages/contracts/templates/`。
- ✅ 对外渲染契约不变(扁平 `AlbumLayoutPlan`)。
- ⚠️ v2 端点 / draft_json 列 / 积分时机:需架构师闸门(见顶部表)。
