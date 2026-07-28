# 照片滤镜(3D-LUT)· 设计文档

- Issue: [#307 新增滤镜功能](https://github.com/yvaineyu9/memoir-agent-rebuild/issues/307)
- 分支: `feat/lut-filters`(worktree `~/Desktop/yujee工程文件/wt-lut`,基线 `67feba9d`)
- 日期: 2026-07-28
- 前身: `wt-photo-filters` 上 2026-07-23 那版设计。架构结论沿用,执行细节按当前 main 重写
  (那版基线 `90b54e70`,之后 main 走了 15 个提交,长出移动端编辑器和快照回退两条新路径)。

## 目标

给回忆录照片加**滤镜(照片调色 / 风格化)**。滤镜显著影响照片最终呈现,是提升成片质量的
基础能力,**完全免费、不消耗积分**。

## 关键约束(决定整体架构)

Yujee 的**照片原图从不上服务器**:原图存浏览器 IndexedDB(`apps/web/src/lib/photo/store.ts`,
store `originals`),DB/服务器只存 `photoId` 字符串。所有渲染面——桌面编辑器、移动编辑器、
翻页书、PDF/JPG 导出、封面、分享页——都是浏览器端把**同一份 HTML** 经 html2canvas 光栅化。
全链路没有任何服务器端图像处理(无 sharp / imgproxy / next-image)。

因此滤镜必须在**浏览器端、派生图之后**完成,且要让所有渲染面走同一像素源,否则必然漂移。

## 范围

| 维度 | 决定 |
|---|---|
| 作用范围 | **全书默认 + 单张覆盖** |
| 引擎 | **3D-LUT(.cube)**,出真胶片 / 日系 / 黑白质感,复用桌面「一键调色」那套 26 色 LUT |
| 入口 | **桌面编辑器顶栏「风格」+ 移动编辑器「风格」面板**,两面都做 |
| 档位 | **26 个全上 + 0–100% 强度滑杆** |
| 计费 | **免费,不消耗积分** |

LUT 引擎来源:`~/Desktop/LUT一键调色/template.html` —— 已跑通的 WebGL2 3D 纹理 + 硬件
三线性插值实现,且与 Python 浮点参考逐点比对过(最大偏差 ≤2/255,仅 8-bit 回读误差)。
本功能移植该引擎,不重写。LUT 源在 `~/Desktop/精选26色LUT/*.cube`:取 26 个 709 变体、
忽略 `-LOG`。其中 25 个文件以 `-709.cube` 结尾,「绿皮书质感」的 709 文件无后缀;
构建脚本必须走显式映射,不能靠 `*-709.cube` 通配符漏掉第 26 个。

## 架构:在 `photoStore` 层出滤镜图

**接缝选择(相对前身的第一处改写)。** 2026-07-23 那版说「改 `resolveImage`」。当时它是
唯一取图入口;现在不是了:

- `resolveImage` 是 `EditorPort.tsx` 内的闭包(`apps/web/src/components/album/editor-v2/EditorPort.tsx`,
  `(id) => imageUrls[id] ?? snapshotUrls[id]`),桌面专用;
- 移动端编辑器(`editor-v2/mobile/`)自己一套 React 取图;
- 导出(`use-export.ts` / EditorPort 导出分支)、照片备份(`use-photo-backup.ts`)各走各的。

四条路唯一的共同上游是 **`photoStore` 的取字节函数**:`getTierBlob` / `getTierUrl` /
`getTierUrls` / `getPdfDataUrls`。滤镜挂在这里,**四面同时生效,且不可能漂移**。

这样做绕开的坑:

- **53 个 HTML 模板一个不用改**,`html-template-lint` 不动,`{{IMG_TF}}` / `{{IMG_POS}}`
  token 机制不碰。
- **`page.html` 里不写任何滤镜信息** → 绕开「数据层 + HTML 双真值」坑(`bake-html.ts` /
  `patchHtml*` / `upsertStyleAttr` sanitizer 全不涉及)。
- **不碰 `Page` / `ImagePos` 的 zod `.strict()` schema** → 不用同步
  `engine/src/contracts/schemas.py`(pydantic `extra="forbid"`,多一个 key 就 hard-fail)
  和 `packages/contracts/scripts/gen-templates.ts`。
- html2canvas 始终只看到一个普通 `<img>`(blob src),**导出与编辑器天然一致**。

被否决的替代方案:

- **CSS `filter` 内联**:最省事但 CSS 做不出 LUT 胶片色彩;且 `page-html-dom.ts` 的
  `upsertStyleAttr` sanitizer(`STYLE_VALUE_BAN = /[;{}<>"]/`)会拦掉多段/带分号的 filter 值。
- **每个图位盖 WebGL canvas 实时预览、导出时才烤像素**:html2canvas 抓 WebGL canvas
  不可靠,等于编辑器与导出两套渲染,必然漂移。

## 数据模型

滤镜状态存**书级别、按 `photoId` 索引**,放在 **`albums` 表一个新的 `photo_filter` jsonb 列**。

**为什么不是 `draft_json`:** `draft_json` 是 **agent 拥有**的——analyze / finalize 五环节会
整体「刷新」重写它。编辑器往里塞的字段会在下一次 agent 刷新时被冲掉。编辑器设置的书级视觉
属性正确的落点是**专用列**:`boardBackground`(`apps/web/src/db/schema.ts:248`,`board_background`
jsonb 列)就是精确先例——`PATCH /albums/:id` → `updateBoardBackground` 写列、随书详情返回、
流进分享快照、engine 从不读它。`photoFilter` 完全照抄这套。

**为什么不是 `Page` / `ImagePos` / `AlbumLayoutPlan`:** `AlbumLayoutPlan` 是扁平渲染契约且有
硬不变量「扁平渲染契约不新增任何树形字段」(`layout.ts`),engine pydantic 镜像 `extra="forbid"`。
专用 web 列(像 `boardBackground`)engine 永不可见,同样满足隔离。

```ts
// apps/web/src/lib/photo/filter-state.ts —— 类型 + 校验,纯 web 内部(engine 不读此列)
export const PhotoFilterRef = z.object({
  // 只接受 manifest 里的稳定 id,不能用任意 string 拼资源 URL。
  lutId: LutIdSchema,
  strength: z.number().min(0).max(100),
}).strict();

export const PhotoFilterState = z.object({
  default: PhotoFilterRef.nullable(),                 // 全书默认;null = 全书原片
  overrides: z.record(z.string(), PhotoFilterRef.nullable()).optional(),
  // key = photoId;value=null 表示这张强制原片(覆盖 default)
}).strict();
```

```ts
// apps/web/src/db/schema.ts,albums 表内,紧挨 boardBackground(:248):
//   photoFilter: jsonb('photo_filter').$type<PhotoFilterState>(),
// 迁移:drizzle 生成 00XX_*.sql —— ALTER TABLE albums ADD COLUMN photo_filter jsonb
```

⚠️ **影响面(CLAUDE.md 要求先说明):** 新增一个 DB 列 `albums.photo_filter`(drizzle 迁移)。
纯 web 列,engine schema / `packages/contracts` 跨服务契约不动。

按 `photoId` 而非 `slotId` 索引是刻意的:AI 重排版把照片挪到别的页时,滤镜跟着照片走不丢;
且完全不进 page 级 schema。

**解析优先级**(渲染每张照片时):

1. `overrides[photoId]` 存在(含显式 `null`)→ 用它;
2. 否则用 `default`;
3. 都没有 → 原片。

## 渲染实现

新增 `apps/web/src/lib/photo/lut/`:

- `lut-math.ts` —— 纯 JS 三线性参考实现(node 可测),GPU 路径的校验基准。
- `engine.ts` —— 从桌面 `template.html` 移植 WebGL2 3D-LUT 引擎:单例 canvas + 复用
  WebGL2 context(**绝不每张建 context**)、3D 纹理硬件三线性插值 shader、`strength`
  uniform(0=原片,1=满强度,shader 内在原色与 LUT 色间线性混合)。canvas 工厂先尝试
  `OffscreenCanvas.getContext('webgl2')`,失败则回退隐藏的 `HTMLCanvasElement`;不能把
  “浏览器支持 WebGL2”和“OffscreenCanvas 支持 WebGL2”混成一个能力判断。
- `engine.ts` 对外 `applyToBlob` **必须内建 FIFO 串行队列**。现有 `getTierUrls` 有 4 个
  worker 并发调用;单例 canvas/context 是可变状态,如果不串行,后一张会在前一张
  `convertToBlob`/`toBlob` 完成前覆盖画布,产生串图。
- `manifest.ts` —— LUT 清单 + 两级资源的懒加载/解压(gzip)。
- `resolve-filter.ts` —— 上面那条解析优先级,纯函数。
- `cache-key.ts` —— 缓存键后缀(含强度量化),纯函数。

`photoStore` 派生图管线扩展(`apps/web/src/lib/photo/store.ts`):

- 现有派生缓存键 `${photoId}@${tier}` → 扩为
  `${photoId}@${tier}@pf-v1@${lutId}@${strength5}`,
  其中 `strength5` 是量化到整 5% 的强度档(避免拖滑杆时缓存爆炸)。无滤镜时键与今天完全一致
  (向后兼容,旧缓存不作废)。`pf-v1` 是引擎/资源版本;以后 LUT 产物或算法变化必须升版本,
  不能误用旧像素。
- 取图流程:读/生成**无滤镜**派生 JPEG blob(沿用今天的路径与键)→ 若有生效滤镜,过 LUT
  引擎出新 blob → 回存派生表。`lutId` 缺省 / 强度 0 → 直接返回原派生 blob(零开销)。
- 四个取字节函数各加一个**可选**末位 `PhotoFilterState | null` 参数;函数内部按当前
  `photoId` 解析有效 ref。省略时行为与今天逐字节一致。
- 选择器的 26 张 240px 预览只放内存,**不写 IndexedDB**。正式滤镜派生缓存每个
  `photoId+tier` 最多保留最近 2 个 `pf-v1` 变体;写入新变体后扫描并删除更旧变体。
  5% 量化不是淘汰策略,不能让 26×21 个组合永久增长。

**导出路径插桩点(第二处改写)。** `getPdfDataUrls` 不走派生表——它是
`getBlob(id)`(原图)→ `blobToPdfDataUrl(blob, maxEdge)`。前身把这处留成了「实现时择一」。
本版明确:**LUT 插在 `blobToPdfDataUrl` 内部,解码之后、编码之前,用 33³ 全精度档**。
导出与编辑器因此拿到同一 LUT、同一强度,只是分辨率不同。

**LUT 永远作用在派生/降采样之后**(display 1600px / raster PDF 3400px),不碰 IndexedDB
原图 → 用户永远能清滤镜拿回原片。

## 资源分级(基于实测)

实测 26 个 709 LUT(33³):原始 2.8MB,gzip 后 **2.6MB**(LUT 高熵,压不动)。降到 17³ 只要
374KB,但实测最大偏差 **26/255**(「夜景胶片」最差),正片不可用。

因此**两级资源**:

- **缩略预览级(17³,约 374KB)**:picker 里 26 张 240px 缩略实时预览用。缩略图上看不出偏差。
  **懒到点开「风格」面板时才加载**,不进首屏。
- **全精度级(33³,每个约 108KB)**:用户**选中某个 LUT 后**再按需拉取该 LUT 的 33³ 数据,
  用于正式渲染与导出。

构建:`apps/web/scripts/build-luts.ts`(移植桌面 `build_tool.py` 思路),通过必填
`--source <dir>` 读取源目录,按显式 `ID_MAP` 找齐 26 个 709 文件(含无 `-709` 后缀的
「绿皮书质感」),量化 uint8 + gzip,产出两级二进制资源与 manifest 进
`apps/web/public/luts/`。**不硬编码个人目录;LUT `.cube` 源文件不进仓库,产物、源文件
SHA-256、资源授权/来源说明进仓库。**

`lutId` 用稳定英文 id(如 `fuji-portrait`),显示名单独存;构建脚本里有显式 `ID_MAP`,
未登记的文件直接报错,不允许中文文件名进代码。

## UI

**渲染层两面共用,UI 壳两套**(第三处改写)。前身只写了桌面。当前 main 上移动端编辑器
(`editor-v2/mobile/`)是独立的 React 面,不能复用桌面的 imperative DOM。

**桌面(`EditorPort.tsx`)**:沿用现有 `boardBgModal` / `imgEdit` 那套 imperative DOM 模式,
不引新框架。

- 顶栏「风格」按钮 → 展开横向滤镜带:取书里第一张照片当代表照,实时渲成 26 张 240px 缩略
  预览(17³ 小 LUT)+ 一个「原片」档。
- 选中即写 `photoFilter.default` → 全书重渲染(每张换缓存键取新 blob,debounce)。
- 下方 0–100% 强度滑杆,拖动实时联动。
- 单张覆盖:复用照片选中后那个浮条(`buildImgEditOverlay`,缩放滑杆旁)加「这张的风格」入口,
  弹同一条滤镜带,写 `overrides[photoId]`;显示「跟随全书 / 已单独设置」,一键清除回默认。

**移动(`editor-v2/mobile/`)**:新增 `modals/FilterSheet.tsx`,套现有 `BoardBgSheet.tsx` 的
React 模式 + `ModalHost` 注册 + `MoreSheet`/顶栏入口。交互与桌面同构(26 档 + 强度 + 单张覆盖)。

**渐进渲染**:切滤镜时先出低清预览、后台逐张升级,避免整书一次性阻塞。
强度拖动只更新本地预览,按 5% 量化去重;停拖 debounce 后再 PATCH,避免每个 pointer event
写数据库。持久化失败需提示,不能让用户以为已经保存。

## 导出

导出走同一个 `photoStore.getPdfDataUrls`,套完 LUT 的字节自动进 html2canvas → PDF/JPG
天然带滤镜。桌面导出与移动 `use-export.ts` 两条路各自只需在调用处把书级 filter 传下去。
写一个测试锁死这条不变量(同一 photoId + filter,编辑器与导出解析出同一 ref + 同一全精度档)。

## 分享 / 快照 / 封面

**策略:上传时烤进滤镜**(第四处改写的前半)。

两条照片备份路径(`EditorPort.tsx` 的备份分支、移动 `use-photo-backup.ts`)都调
`photoStore.getTierBlob(id, 'display')` 拿要直传 R2 的字节。`getTierBlob` 变滤镜感知后,
在这两处把书级 filter 传下去即可——**分享页 `SharedAlbum.tsx` 和只读快照渲染零改动**,
它们拿到的 R2 图本身就带滤镜。

**滤镜指纹失效(第四处改写的后半)。** 备份逻辑用 `backedUpIds` 跳过已备份照片
(`todo = bookPhotoIds().filter(id => !backedUpIds.has(id))`)。不处理的话,改滤镜后已备份的
照片永不重传,快照会永远停在第一次备份时的滤镜。

因此备份状态改存**每张照片的有效渲染版本**:

```ts
type PhotoSnapshotState = {
  photoIds: string[];                         // 兼容现有数据
  renderVersions?: Record<string, string>;   // photoId -> pf-v1__lutId__strength5 / pf-v1__original
  updatedAt: string;
};
```

- 当前照片版本只由这张照片解析后的有效 ref 决定;单张 override 变化只重传这一张。
- 新 R2 key:
  `photo-snapshots/{userId}/{albumId}/{photoId}/{renderVersion}.jpg`;旧数据没有版本时仍读
  现有 `photoId.jpg` legacy key。版本化 key 从根上避开 CDN 覆盖旧对象后仍回旧缓存。
- 签名/confirm 接口接收 `{photoId, renderVersion}[]`;confirm 只登记 PUT 成功的 entry,
  允许部分成功,下一次只补版本不匹配的照片。
- `backedUpIds` 不再只看 id 是否存在,而是比较服务端 `renderVersions[photoId]` 与当前
  `effectiveRenderVersion(photoId, photoFilter)` 是否相等。

**封面/PDF 派生物失效。** `updatePhotoFilter` 成功时同一事务清空
`coverThumbnailR2Key/coverThumbnailUrl/pdfR2Key/pdfUrl`,并把 `COMPLETED` 退回 `EDITING`。
相册列表接口返回 `photoFilter`;本地封面预览和 `createCoverThumbnailJpeg` 的输入都先走
滤镜感知的 `photoStore`。旧分享链接是冻结快照,继续保留旧样式;用户重新生成分享链接时,
必须先确认所有照片的 renderVersion 都与当前滤镜一致。

## 已知边界(第五处改写)

**无本地原图的设备上,改滤镜对那些照片不生效。** 换设备/清缓存后,照片走
`resolveImage` 的 `snapshotUrls` 分支(服务器 R2 图),完全绕开 `photoStore`;那些图上的
滤镜是备份当时烤死的。UI 上给一句明确提示(比如「部分照片来自云端备份,需在有原图的设备上
调整风格」),**不假装能改**。

这是「上传时烤进滤镜」这个选择的直接代价,已确认接受:换来的是分享页/只读页零改动、
无需在远程图上跑 LUT、不必处理 R2 CORS。

## 其他边界与降级

- Offscreen WebGL2 不可用但 DOM WebGL2 可用 → 自动使用隐藏 DOM canvas。
- 两种 canvas 都拿不到 WebGL2 → 隐藏两面的「风格」入口 + 渲原片
  (`applyToBlob` 原样返回,链路无需分支)。
- LUT 资源加载、shader、context-loss 或编码失败 → 本次返回原派生图并上报可诊断错误,
  不能让整书白屏;下一次仍允许重试。
- 强度滑杆连续值,缓存键量化到整 5% 档。
- 原图永不被改写,清滤镜即回原片。

## 施工风险

1. **首次全书套滤镜的延迟**(如 60 张 1600px):单例 WebGL context + FIFO 串行队列;
   切滤镜先出低清、后台升级。
2. **html2canvas-pro 抓 blob img 保真**:理论无问题(普通 img),但要真跑一次 PDF 逐点比对确认。
3. **`EditorPort.tsx` 已 5053 行**:本功能只在其中加接线与一段 UI,不做无关重构;
   滤镜带 UI 若明显成块,抽到同目录独立文件,不再把这个文件推大。

## 测试策略

- LUT 数学:纯 JS 三线性参考实现单测(恒等 LUT 满强度 = 原色、strength=0 = 原色)。
- GPU 路径:浏览器里对参考实现逐点校验,阈值 ≤2/255(node:test 无 WebGL,不进单测)。
- `photoStore` 接缝:同 photoId 不同 `(lutId, strength)` 缓存键正确;无滤镜时键与今天一致;
  `strength=0` / 无 filter 走原片零开销;第三个滤镜变体写入后最旧变体被删。
- 并发:4 个同时 `applyToBlob` 的任务按 FIFO 完成,输出不串图。
- 解析优先级:`overrides` 显式 `null` 覆盖 `default`;photoId 挪页后滤镜跟随。
- 导出不变量:编辑器与导出解析出同一生效 ref + 同一全精度档。
- 快照版本:全书默认变化只重传有效版本变化的照片;单张 override 只重传一张;新 URL 含版本;
  legacy `photoId.jpg` 仍可读。
- 派生物失效:filter PATCH 同事务清封面/PDF,COMPLETED→EDITING;冻结分享不变。
- 降级:Offscreen 失败回退 DOM canvas;两者均无 WebGL2 时 `isSupported() === false`、
  `applyToBlob` 原样返回同一引用、两面入口隐藏。

## 明确不做(YAGNI)

- 单张自定义调色(亮度/对比/HSL 手调)—— 只做 LUT 预设 + 强度。
- LOG 素材档(桌面工具有,但回忆录照片是直出,用不上)。
- 服务器端渲染 / 预烤滤镜图。
- 滤镜进 `Page` / `ImagePos` 级 schema。
- 在远程 R2 快照图上跑 LUT(见「已知边界」,已选择烤进上传)。
