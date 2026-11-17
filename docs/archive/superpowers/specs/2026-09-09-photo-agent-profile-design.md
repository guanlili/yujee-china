# 图片处理收敛到 Agent：照片视觉档案 + 三项写能力

状态：待拍板（2026-09-09）
提出人：小雨
背景问题：「版式和文案已经收敛到 Agent，图片处理还全是手动的」

---

## 一、这份方案回答的问题

让 Design Agent 能管三件现在只能手动做的事：

1. **整本定调** —— 按全书气质选 LUT（26 个滤镜），单张可 override
2. **构图裁切** —— 决定每张照片在框里的位置和缩放（`imagePos`），人脸别被切
3. **抠图** —— 把主体抠出来叠版式

## 二、被推翻的前提：不用换画布

小雨最初的判断是「要支持拖拽 + Agent 理解位置，就没法用固定 JSON 模板，得让
Agent 读 canvas」。查证后这个前提不成立：

- `imagePos {x, y, scale}` 早就是契约字段（`apps/web/src/components/album/types.ts:6`），
  拖拽已经在写它
- 页面真相是 `htmlJson`（C 方案已上线），画板优先渲染它
- 52 个模板 230 个槽里 199 个本来就是绝对定位 + 794×1123 固定坐标系
  （2026-08-11 调研结论，`docs/specs/2026-08-11-manual-editing-blockers.md`）
- **Agent → 画板的 imagePos 通道，前端那一半早就铺好了**：`LayoutPatchEntry`
  已带 `imagePosJson`，`applyPatchToPages` 已在处理，注释写着 "Phase 3 adjust"
  （`types.ts:143-148`）

缺的不是数据模型，是 **design-agent 那一头的读写通道**：`readPagePayload` 不吐
`imagePos`，15 个工具里没有一个能写它。

另外「让 AI 看渲染缩略图当评委」这条路建过两版（线框评委 → 真图缩略图评委），
2026-07-22 `bec57de2` 整条移除改纯确定性选版（-531 行）。再走这条路前得先说清
这次跟上次哪里不一样。

**产品层面**：自由拖拽画布跟「屌丝也能做出高大上 zine」的定位是打架的 ——
版式锁死是护城河，给普通人自由画布产出的就是丑东西。Agent 该收敛的是调色和
构图裁切（普通人不会、也选不明白 26 个 LUT），不是放开版面自由度。

## 三、真正的根因：Agent 看不见照片

三个需求卡在同一件事上 —— **Design Agent 对照片内容一无所知**：

| 字段 | 契约里有 | 生产实际 | 后果 |
|---|---|---|---|
| `sceneDescription` | 有（max_length=300） | **恒空** —— `tree_builder.py:157` 写死 `""` | Agent 每次 read_page 收到空串；`skills.ts:41` 在教它用一个死字段；`search_book` 搜照片描述那条分支永远搜不到 |
| `composition` | 有（`closeup`/`focal`/`wide`） | **恒 None** —— `tree_builder.py:162` 写死 | 模板槽位声明的构图约束**在生产里完全没生效**：`slot_matcher_v3.py:44` 遇到 `None` 就「视作任意，不挡」，三级兜底阶梯第 1、2 级现在等价 |

compose 环节早就绕开了这个问题：真图直喂视觉模型（`handler.py:191`，每张照片以
`ref200px` 进 user content）。design-agent 没有这条路。

**所以 Agent 要看的不是画布，是照片。** 画布状态它已经能读（templateId/images/
texts/html 都在），照片它一点都看不见。

## 四、契约（三条并行线的前提，必须先锁死）

### 4.1 PhotoProfile —— 存 `album_photos.profile` jsonb

选这张表的理由：档案是照片的属性；不动 `draft_json`（那玩意儿被抹空过，见
`b4cba3f1`）；不进 `_V3Strict`（避开 pydantic/zod 双改）；OCC 不跟页面/settings 抢。

```ts
// packages/contracts/src/photo-profile.ts（新文件）
export const PhotoProfileSchema = z.object({
  v: z.literal(1),

  // ── 几何组（确定性，分割 mask 派生）────────────────────────
  // ⚠️ 坐标系一律 0-100 百分比，与 imagePos 的 objectPosition 同口径。
  // 别用 [0,1] —— 两套坐标系并存必然出现 Agent 心算换算错误（页码换算已经
  // 栽过一次，见 33a790c8）。
  // 主体包围盒。null = 没跑出主体（纯风景/抽象构图），此时 imagePos 走默认 50/50/1。
  subjectBox: z.object({
    x: z.number().min(0).max(100),
    y: z.number().min(0).max(100),
    w: z.number().min(0).max(100),
    h: z.number().min(0).max(100),
  }).nullable(),
  // 人脸框（0..n 个），同坐标系。给 imagePos 做「别切脸」的硬约束。
  faceBoxes: z.array(z.object({
    x: z.number(), y: z.number(), w: z.number(), h: z.number(),
  })).default([]),
  // alpha mask 的 R2 key。**默认 null** —— 建档时只取 mask 的包围盒，mask 本身
  // 丢弃不存：绝大多数照片不会被抠，一本 100 张的书预存 mask 是 5-20MB 的
  // 净浪费。真要抠图时按需跑第二次推理并存。CPU worker 单张几秒，可接受。
  maskKey: z.string().nullable().default(null),

  // ── 色彩组（纯像素算法，不用模型）──────────────────────────
  colorTemp: z.enum(['warm', 'neutral', 'cool']),
  brightness: z.enum(['dark', 'mid', 'bright']),
  saturation: z.enum(['muted', 'normal', 'vivid']),
  // 主色调，最多 3 个 hex。给 LUT 选择和配色协调用。
  dominantColors: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).max(3),

  // ── 语义组（豆包 vision，ARK_VISION_MODEL）─────────────────
  composition: z.enum(['closeup', 'focal', 'wide']),
  scene: z.enum(['indoor', 'outdoor', 'nature', 'city', 'interior']),
  peopleCount: z.enum(['0', '1', '2-3', '4+']),
  mood: z.enum(['warm', 'cool', 'sentimental', 'energetic', 'quiet']),
  // 一句话描述，回填死掉的 sceneDescription。
  description: z.string().max(300),
}).strict();
```

**隐私红线（继承 v3-requirements §3）**：档案里**不得出现任何** location / place /
GPS / lat / lng / coordinate 字段或其语义等价物。`description` 里也不许写具体地名。
engine 侧 `_V3Strict` 在 parse 期就拒这类 key，新契约必须保持同等强度 —— 加一条
测试断言 schema 是 `.strict()` 且不含这些键。

`scene`/`peopleCount`/`mood` 三个 Literal 已经在 `engine/src/contracts/schemas.py:38-40`
定义好了，复用，不新造。

### 4.2 回填两个既有契约字段

档案跑完，把 `composition` 和 `description` 分别回填到章节树的
`V3ChapterPhoto.composition` / `.sceneDescription`。这两个字段契约里本来就有，
填回去立即生效：

- `composition` → `slot_matcher_v3` 的构图匹配真正开始工作，选版质量提升
- `sceneDescription` → `search_book` 能搜到照片了，`skills.ts:41` 不再是空指令

**这是白捡的收益，跟三个新能力无关，单独就值得做。**

### 4.3 design-agent 新增工具签名

```ts
// set_image_pos —— 构图裁切。两种模式，**默认用 auto**。
{ updates: Array<{
    pageNo: PageRef;
    positions: Record<SlotId,
      // auto：Agent 只表达意图，x/y/scale 由工具层拿 subjectBox/faceBoxes
      // 和槽位宽高比算出来。
      | { fit: 'center-subject' | 'avoid-face-crop' | 'fill' }
      // manual：用户明确说「往左一点」「再拉近些」时才用。
      | { x: number; y: number; scale: number }
    >;
  }> }
// x/y 是 object-position 百分比（0-100），scale >= 1，缺省 50/50/1
//（与 #165 的 render default 一致）。整槽替换。

// set_photo_filter —— 整本定调 + 单张 override
{ default?: { lutId: LutId; strength: 0-100 } | null,
  overrides?: Record<PhotoId, { lutId; strength } | null> }
// strength 会被 quantizeStrength 归到 5 的倍数（沿用 filter-state.ts 的现有归一化）。

// set_photo_cutout —— 抠图开关
{ photoIds: PhotoId[], on: boolean }
// 契约铁律：cutouts 只认 true，关掉是删键（filter-state.ts 注释）。
// on:false → 走 toggleCutout 的删键路径，绝不写 false。

// look_at_photos —— 兜底：真图直喂
{ photoIds: PhotoId[] }  // 最多 6 张，复用 compose 的 ref200px 路径
// 只在用户说「这张不对劲」这类档案答不了的场景调用。skill 里要写死这条边界，
// 否则模型会为了「稳妥」每轮都看图，上下文和成本双爆。
```

`read_page` 的 `images[slotId]` 扩字段：加 `profile`（档案摘要，不含 maskKey）、
`imagePos`（当前值）、`filter`（当前生效的 LUT + 是否抠图）。

### 4.4 分工原则：语义交给模型，几何交给代码

贯穿三个能力的一条线 —— **别让 LLM 做几何计算**：

| 归模型 | 归代码 |
|---|---|
| 这本书什么气质 → 选哪个 LUT、强度多少 | subjectBox + 槽位宽高比 → 算出 x/y/scale |
| 这页的版式要不要抠图主体 | mask 包围盒的推导 |
| 哪几张照片是这一章的主角 | 「别切脸」的约束求解 |

LLM 心算坐标必然出错，而且错得没有规律、测不出来。所以 `set_image_pos` 默认走
`fit` 意图模式，`{x, y, scale}` 只在用户明确说「往左一点」时才让 Agent 直接写。

同理，`subjectBox` 用 0-100 而不是 [0,1]，就是为了跟 `imagePos` 同口径 —— 一旦
两套坐标系并存，模型迟早换算错（页码换算已经栽过一次）。

## 五、三条并行线

契约锁死后文件不重叠，可并行。

### A 线 —— engine（Python）

- CLIP worker（`yujee-agent-clip`，shared-cpu-1x / 2GB，`min_machines_running=0`）
  加 `/internal/photo-profile` endpoint
- 装两个 **Apache-2.0** 的分割模型（2026-09-09 拍板，见下面「为什么不是 RMBG-1.4」）：
  - **建档 `u2netp`**（4MB ONNX，320²，CPU 单张 ~0.6s）—— 档案只要**包围盒**，
    320² 足够。**建档时只取 mask 的包围盒当 `subjectBox`，mask 本身丢弃**
    （理由见契约注释）
  - **真抠图 `isnet-general-use`**（170MB ONNX，1024²，CPU 单张 ~4s）—— 抠图要精细
    边缘；拿 320² 的糙边啃人像，正是风险④里 2026-08-29 否决自动抠图的那个病。
    走同一个 endpoint 带 `persistMask=true` 再跑一次，写 R2 并回填 `maskKey`

  **为什么不是 RMBG-1.4（原方案点名的模型）**：它的许可是 `bria-rmbg-1.4`，
  HuggingFace 官方元数据写明 *"source-available model for **non-commercial** use"*
  （license_link: bria.ai/bria-huggingface-model-license-agreement）。Yujee 是收费
  产品，烘进镜像就是拿非商用许可的模型商用。**这是硬约束，别因为「RMBG 效果更好」
  改回去。**

  顺带纠正原方案的一处事实错误：「ONNX ~44MB 比 torch 版 176MB 省」不成立 ——
  fp32 ONNX 就是 176MB，44MB 那个是 int8 量化版，而且实测量化版反而更吃内存。

- **内存实测**（2026-09-09，本机原生；开发机没装 docker，不是 2g 容器内的数）：

  | | 峰值 RSS | 单张耗时 |
  |---|---|---|
  | torch + open_clip + ViT-B-32 加载 | ~1356 MB | — |
  | 　+ u2netp（320²）推理 | ~1356 MB（**没再抬高**） | 0.6s |
  | 　+ RMBG-1.4（1024²）推理 | 1478 MB | 7.2s |
  | isnet 单独跑 | 951 MB | 4.1s |

  结论：**吃内存的是 CLIP 的加载瞬时峰值，不是档案模型**（2048MB 的机器剩 ~690MB）。
  三条退路（升内存 / 拆第三个 worker / 改调外部 API）一条都没用上。

  两条实现约束由此而来：ORT 的 `enable_cpu_mem_arena` 必须**关掉**（开着会一路只涨
  不还，1095MB 且继续爬）；`intra/inter_op_num_threads` 钉成 1（shared-cpu-1x 就一个核）。

- **推理必须全机串行**：`run_in_threadpool` 默认 40 线程，并发推理会把工作集乘上去，
  两三路就撑爆 2GB。CLIP 与档案**共用同一把 RLock**（`profile/inference.py`）——
  它们抢的是同一台机器的同一块内存，各锁各的等于没锁。但**视觉模型的网络调用不进锁**：
  那是好几秒的 I/O，锁进去 100 张的书就是几百秒串行，analyze 直接超时。

- ⚠️ **「不进锁」不等于「并发」**：批内必须显式 `asyncio.gather`，逐个 `await` 照样串行
  （第一版实现正是栽在这 —— 代码没锁，但仍是 for 循环）。并发要**限流**
  （`Semaphore(8)`，与 `PROFILE_BATCH_SIZE` 对齐）：视觉模型有速率限制，一次 gather
  一百个会被打回来。批内 8 张因此从 ~28s 降到 ~5s，100 张从 ~6 分钟降到 ~1 分钟
  （批与批之间仍串行，既够用又天然兜住总并发）。
  验收要按**真的并发**来：探针记录本地推理与视觉调用各自的进出窗口，断言视觉
  **有重叠**且推理**无重叠** —— 只测一条会漏掉「并发了但锁失效」或「锁住了但没并发」。
- 人脸框：轻量检测器（不引入新的重依赖，优先复用已装的）
- 色彩组：纯直方图/统计，不用模型
- 语义组：豆包 vision（`ARK_VISION_MODEL=doubao-seed-1-6-vision-250815`），
  一次调用吐 composition/scene/peopleCount/mood/description
- 接进 analyze 阶段（必须在 select_layout 之前，否则 composition 白填）
- `tree_builder.py:157/162` 的写死值改成从档案取

碰的文件：`engine/src/**`。不碰任何 TS。

### B 线 —— web 服务层（TS）

- `album_photos` 加 `profile` jsonb 列 + drizzle 迁移
  （⚠️ dev 库账本漂移，`db:migrate` 本地必失败，新迁移手工应用）
- 档案读写 service + engine 回调落库
- **跨存储写入 seam**：`AlbumToolsOptions` 加 `getPhotoFilter()` / `setPhotoFilter()`，
  实际落库走 `album-service.ts:439` 那个「三个相册级设置共享事务骨架」，
  带 `baseSettingsRevision` 做 OCC
- **分享快照护栏**（见风险①）
- 存量书补跑档案的后台任务

碰的文件：`apps/web/src/services/**`、`apps/web/src/db/**`。

### C 线 —— design-agent（TS）

- 4 个新工具 + `readPagePayload` 扩字段
- `AlbumBookState` 装 `photoFilter`（现在完全不在里面）+ `AlbumChapterPhoto` 装 `profile`
- 清死账：`skills.ts:41` 的 sceneDescription 指令、`search_book` 的空搜分支
- skill 文档：什么时候该用档案、什么时候才准调 `look_at_photos`

碰的文件：`packages/design-agent/**`。

### 汇合

三线各自 TDD 到绿，然后一次端到端：上传 → 档案 → Agent 调色/裁切/抠图 → 导出对照。
导出验证走浏览器取证法（esbuild 打真管线 + playwright 对照，mock 测不出真 bug）。

## 六、风险与护栏

### ① Agent 改滤镜会炸掉已分享的书（必须挡）

`share-service.ts:108` 拿 `effectiveRenderVersion(album.photoFilter, photoId)` 核对
分享快照。Agent 一句「整本调成旅行大片」→ 全书 renderVersion 失配 → 用户得重新
备份全书，还撞 300 张上限那堵墙（`share-backup-300-cap-no-batching`）。

**护栏**：`set_photo_filter` / `set_photo_cutout` 执行前查这本书有没有已发布 share，
有则在工具结果的 `notes` 里明确告知，让 Agent 在回复里提醒用户。不静默改。

### ② 跨存储 + 两套 OCC

滤镜/抠图在 `albums.photo_filter` 列走 `settingsRevision`；页面在 `draft_json` 走
页面 `version`。design-agent 的 `commitWrite` 只认书状态那条路（`tools.ts:1407`）。
协同八包刚上（`1adaef05`），这里最容易并发脏写。

**护栏**：滤镜写入不走 `commitWrite`，走独立的 `commitSettingsWrite`，各带各的
baseRevision；OCC 冲突直接报错让 Agent 重试，不做自动合并。

### ③ 跨会话的用户手调会被抹掉（已拍板接受）

小雨两次拍板：**Agent 全权，不加来源标记**。理由是「Agent 调得够好的话用户根本
不会去手调，现在加标记是为伪需求付复杂度」。

接受这个决定意味着接受两笔明确的代价，实现时不要偷偷绕开：

1. 用户手调过的 `imagePos`，Agent 下次整本刷时会被覆盖。撤销栈是会话级的，
   跨会话回不去。
2. `filter-state.ts` 里那个已知 bug 保持现状 —— 契约注释自己写着「没有『用户
   明确说不要』这个状态 → 重成稿会把用户关掉的抠图又加回来」。

**这决定了验收标准**：Agent 的裁切/调色质量就是这个方案的成败线。调得好，用户
不手调，冲突是伪需求；调不好，用户手调完又被抹，双重挖伤。所以端到端验收必须
拿真书真照片眼睛看，不许拿指标糊弄（见风险④的教训）。

将来若要回补标记，是一次 schema 迁移 + 所有写入点同步，已知成本。

### ④ 自动抠图的产品下限

2026-08-29 已验证否决过自动抠图，技术理由是 `cutout-math.ts` 漫水填充无语义
（棚拍人像 5 张 0 张能用）。换成真正的显著性分割模型（`isnet-general-use`，1024²）
后技术理由消失，但**产品理由仍然成立**：
未经确认就把人脸啃出缺口印进书里，下限太低。

**结论**：抠图能力给 Agent，但**不做书级默认全抠**。Agent 只在用户明确要求或
版式明确需要（如主体叠加类模板）时逐张开，且开了要在回复里说清楚改了哪几张。

⚠️ 别用「保留主体百分比」当抠图质量判据 —— 8 月那次 5 张全报「✓ 48%」实际全是
残废。验收必须眼睛看。

### ⑤ imagePos 的 rotate 字段契约不一致

`page-html-dom.ts:15` 的 imagePos 带 `rotate?: number`，`types.ts:6` 的 `ImagePos`
没有。这批要顺手对齐 —— 否则 `set_image_pos` 该不该收 rotate 说不清。

## 七、明确不做（YAGNI）

- **不换画布**（理由见第二节）
- **不做单张修图**（曝光/对比度逐张调）—— 小雨这轮没选；要做得新建契约字段、
  新建渲染管线、还要管导出/分享的 renderVersion，代价最大收益最小
- **不做书级默认全抠**（理由见风险④）
- **不把撤销/重做并进这一批** —— 它跟 B 线在 `EditorPort.tsx`（5000+ 行）上必撞车，
  且要先跟协同 OCC 对账。这批做完单独立项
- **不让 Agent 每轮看图** —— `look_at_photos` 是兜底，不是默认输入

## 八、已拍板与默认值

已拍板（2026-09-09，小雨）：

1. **Agent 管三件事**：整本定调（LUT）、构图裁切（imagePos）、抠图。**不做**单张
   曝光/对比度修图。
2. **视觉输入**：档案打底 + `look_at_photos` 按需看图兜底。
3. **冲突裁决**：Agent 全权，不加来源标记（代价见风险③）。撤销/重做单独立项，
   不并进这一批。
4. **不换画布**（理由见第二节）。

以下按默认值执行，实现中若发现代价明显超预期再回来问：

5. **存量书档案补跑**：懒加载 —— 用户下次打开书时后台补跑，不做全量扫库。
   理由：很多老书不会再被打开，全量跑是白花钱。
6. **人脸检测器选型**：A 线自行决定，硬约束是**不引入新的重依赖**，优先用
   分割那套推理栈已有的能力（onnxruntime）或体积可忽略的轻量检测器（CLIP worker
   只有 2GB 内存、shared-cpu-1x，别把它撑爆）。

   **现状（2026-09-09）：人脸框未接入，`detect_faces` 恒返回 `[]`**，
   `avoid-face-crop` 因此退化成 `center-subject`（不报错，只是少一条约束）。
   计划首选的 YuNet 要自己写 priors 解码 + NMS，而手上没有真实人脸样本可验证，
   写了也是没验过的代码；走 opencv 又要给只剩 ~690MB 余量的机器加重依赖。
   签名和 0-100 口径已钉死，将来接上不用动调用方。
