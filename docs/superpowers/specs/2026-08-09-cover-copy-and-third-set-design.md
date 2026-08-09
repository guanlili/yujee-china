# 封面文案修复 + 第三套「深色椭圆」版式 设计

日期：2026-08-09 · 状态：待小雨确认

三件事，彼此独立可分批上：
1. **修 bug** —— AI 从来没写过封面大标题，部分槽还在书上印模板 sample 的假信息。
2. **封底** —— 四套各自配封底，新做两个封底版式。
3. **第三套** —— 换成「深色椭圆封面 + 深底反白亮字内页」，另外三套不动。

---

## 一、封面文案没写（bug）

### 1.1 现象

成品书封面上：大标题恒为 `My Memoir`；mag-23 的两个 title 槽同时是 `My Memoir`；
body/body2 原样留着模板 sample `2026\n2025\n2024` 和 `Shanghai \nBeijing\nDali`。

### 1.2 根因（已在 dev 库 `draft_pages` 真页上验证，不是推测）

| 模板 | 真页 title | 真页其它槽 |
| --- | --- | --- |
| p01 | `My Memoir` | body ✅ AI 写的；label `Latitude · Longitude`、label3 `VOL. 1`（占位味） |
| mag-32 | `My Memoir` | body / explain ✅ AI 写的 |
| mag-23 | `My Memoir` ×2 | body / body2 ❌ 原样 sample |
| mag-22 封底 | ✅ | ✅ |

**根因 A — 默认书名冒充用户书名。**
相册标题默认就是 `My Memoir` / `我的故事`（`generation-service.ts:61`），而
`compose_global.md` 第 11/24 行写着「albumTitle 非空时封面标题槽**原样使用它**，
不翻译不改写」，`handler.py:440` 的 `_with_album_title` 再兜一道：**所有** `role=title`
的空槽都灌 albumTitle。「非空 = 用户自己起的书名」这个前提不成立 —— 系统默认值被当成
用户书名，AI 从未获准写封面标题；多 title 槽还被灌成同一句。

**根因 B — sample 与 prompt 硬规则打架。**
prompt 写「不要编造具体日期、地名、人名」，而 mag-23 的 body/body2、p01 的 label\*
的 sample 正好是年份表和地名表。模型只能弃权返回空串 → Web 侧 `mergeSlotTexts` 忽略
空串 → **sample 原封不动印在成品书上**。用户封面上是别人的年份和地名，比空着更糟。

**根因 C — 回执卡永远显示 sample。**
`coverOptionHTML`（`EditorPort.tsx:4992`）传的是 `textsJson: {}`，渲染的是模板自带
样例。选之前这样合理（那时确实没文案），**选完之后那张「已选的封面与封底」回执卡还在
显示 sample**，与真页脱节。

### 1.3 修法

**A.** Web 侧 `buildComposeRequest`（`album-service.ts:332`）传 `albumTitle` 前先判：
等于系统默认值（en `My Memoir` / zh `我的故事`）就传空串。
engine `_with_album_title` 改成只填**第一个** `role=title` 槽，其余留给 AI。
prompt 增补：多个 title 槽时第一个是主标题、后续是副标题/年份带，**不许重复同一句**。

**B.** global 批次的输入补上真实素材 —— 每章的 `place` 和 `takenAt` 年份（章数据里已有，
只是没传给全局批次）。prompt 改成「只能用输入里给出的时间/地点；输入里没有就写不含具体
信息的替代文案，**不许留空**」。

**C.** `appendCoverSummary` 已能拿到真页 `textsJson`，把它传进 `coverOptionHTML`。
选择卡保持 sample，回执卡显示真文案。

---

## 二、四套结构

- 去掉 `albumId` 轮换（`design-apply.ts:151`），改**固定顺序**，第三套恒在第 3 位。
- 每套 = `{封面模板, 封底模板}` 一对一绑定，封底不再四套共用。
- 第 1 / 2 / 4 套：**维持现状**，版式和白底都不动。
- 第 3 套：换成本文第三节的深色椭圆版式。

### 封底

新做**两个**封底版式（小雨出稿）。加上现有 mag-22 共三个可用封底
（mag-20 没有文字槽，AI 写的结语会全部落空，不进池）。四套里会有一套与别套共用封底。

---

## 三、第三套：深色椭圆封面 + 深底内页

### 3.1 封面版式（已出预览：桌面/椭圆挖空封面-预览.html）

仿 Joan Didion《상실》书封，比例等比换算到 794×1123：

| 元素 | 规格 |
| --- | --- |
| 页面 | 794 × 1123，实底铺满 |
| 照片框 | 212 × 402，圆角 106（= 宽的一半，两端全圆的胶囊形） |
| 位置 | left 291（水平居中）· top 366 |
| 主标题 | Playfair / Noto Serif SC，52px，字距 3px，居中，top 118 |
| 英文副标 | 同族 22px，字距 0.6px，居中，top 196 |
| 侧栏系列名 | 15px 无衬线，旋转 90°，字距 2.4px |
| 底行 | 左标识 / 中圆点 / 右署名两行，距下边 74~80px |
| 槽位 | `title` / `explain` / `label`（竖排）/ `label2`（左下）/ `label3`（右下） + `image` |

### 3.2 封面配色（用户选中第三套后，在它内部再选一个）

| 配色 | 底 | 字 | 标题对比度 |
| --- | --- | --- | --- |
| 深墨绿 + 粉字 ✅ 已锁 | `#12363A` | `#F0A4C2` | 6.7:1 |
| 奶黄（浅） | `#F9EDC4` | `#1F3A2E` | 10.5:1 |
| 粉底 | `#F0A4C2` | `#1F3A24` | 6.4:1 |
| 深蓝 | `#0E2A47` | `#F1EFE8` | 12.7:1 |

**已否决**：深酒红 `#3D1220`、淡紫 `#C2A6FA`、深紫 `#3B1E8F`、深蓝+粉字组合。

> 参考图里淡紫和黄绿是**两个色块并置、字是黑的**，不是紫底黄绿字 —— 那样对比度只有
> 1.4:1，字会消失在底色里。该方向随淡紫一并否决。

### 3.3 内页配色：深底 + 反白亮字

正文**不用**荧光色（整页荧光正文刺眼，小字号印刷压不住），荧光只给标题和装饰字。

| 组合 | 底 | 标题亮字 | 正文 | 标题对比度 | CMYK |
| --- | --- | --- | --- | --- | --- |
| 深蓝 + 荧光绿 | `#0E2A47` | `#B8FF3C` | `#E8E5DC` | 12.1:1 | ❌ 需专色 |
| 深墨绿 + 粉（同封面） | `#12363A` | `#F0A4C2` | `#E8E5DC` | 6.7:1 | ✅ |
| 近黑 + 黄绿 | `#14140F` | `#D4FF3F` | `#E8E5DC` | 16.0:1 | ❌ 需专色 |

**印刷代价（决策前必须知道）**：真荧光色在四色印刷里印不出来，需要专色油墨
（Pantone Neon / Riso 荧光墨）单独加一版；不加专色的话实体书上会是偏闷的黄绿。
整页深底吃墨重，便宜印厂容易印花、压痕处露白。

### 3.4 上色规则

三组配色按**上色页出现顺序**依次循环（页序推进，不按章）。

原计划「图占比 ≥65% 的页不上色」在深底方案下会变成**破洞** —— 整本深色书里突然插
一页纯白，翻过去像漏印。故：**深色套取消留白规则，全书内页一律上深底**。
（满版图页染了也基本看不见，无害。）

---

## 四、待确认假设

以下是我替你定的，不对就说：

1. **深蓝封面留着**，只是不配粉字，改浅米白 `#F1EFE8`（你只否了「深蓝+粉字」那张卡）。
2. **内页三组**按 3.3 那张表（深蓝+荧光绿 / 深墨绿+粉 / 近黑+黄绿）。深酒红和深紫都
   已被你否掉，没进内页。
3. **深色套全书内页上底色，不留白页**（3.4）。
4. AI 对某个槽真写不出来时**留空，不回落 sample** —— 宁可空着，不印别人的年份地名。

---

## 五、影响面与验证

**改动落点**

- `engine/src/workflows/core/compose/handler.py` — `_with_album_title`、global 载荷补 place/takenAt
- `engine/src/workflows/core/compose/compose_global.md` — prompt 三处
- `apps/web/src/services/album/album-service.ts` — `buildComposeRequest` 默认标题判定
- `apps/web/src/services/album/design-apply.ts` — 固定顺序、每套绑封底、深色配色循环
- `apps/web/src/components/album/editor-v2/ChatPanel.tsx` — 回执卡读真页
- `packages/contracts/src/render/html-templates/` — 新椭圆封面 + 两个新封底
- `packages/contracts/templates/` — 对应 JSON

**验证**

- Web：`cd apps/web && pnpm test`（仓根 `pnpm test` 撞到 design-agent 环境会倒）
- Agent：`PYTHONPATH=engine engine/.venv/bin/python -m pytest engine/tests`
- 模板外观：灌 sample 文案 + headless Chrome 出图对照，不起 dev server
- 端到端：真跑一次 compose，查 `draft_pages` 里封面页 texts 不再是 `My Memoir`、
  不再是 sample 年份地名
