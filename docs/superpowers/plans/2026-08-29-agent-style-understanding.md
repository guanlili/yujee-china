# 设计 Agent「风格理解」实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给设计 Agent 一个「风格」概念层：一个把用户模糊不满翻译成风格判断的 skill，外加四个能真正落地风格的工具。

**Architecture:** 配色真相源从 `apps/web/src/lib/design/` 搬进 `packages/contracts/src/design/`（design-agent 是独立包，够不着 apps/web），apps/web 留 re-export 薄壳保持导入路径不变。风格从封面 templateId 反推，不加数据字段。页底色靠新 carrier 键 `#pageBackground` 挺过重烘。

**Tech Stack:** TypeScript · pnpm workspace · node:test（`tsx --test`，全仓统一）· typebox（Agent 工具 schema）

**Spec:** `docs/superpowers/specs/2026-08-29-agent-style-understanding-design.md`

## Global Constraints

- **测试框架统一 `node:test`**：`import test from 'node:test'` + `import assert from 'node:assert/strict'`。不要引入 vitest。
- **验证命令按包跑，别在仓根跑**：contracts 用 `cd packages/contracts && pnpm test`；web 用 `cd apps/web && pnpm test`；design-agent 用 `cd packages/design-agent && pnpm test`。仓根 `pnpm test` 会倒在 design-agent 的环境上。
- **所有文字/底色组合对比度 ≥ 4.5:1**，用 `design/contrast.ts` 导出的 `contrastRatio()` 实测，不许凭眼睛判断。
- **两色字规则**：全书只有两个字色 `THIRD_SET_INK = { light: '#F5F2E8', dark: '#1A1A14' }`。深底一律浅字，浅底一律深字。这是设计语言，不要按底色逐个派生字色。
- **`interiorInkSequence` 的前缀稳定性不能破**：第 i 项只取决于 seed 和 i。追加照片时只重刷新页，前缀变了老页就串色。
- **老书兼容表不能删**：`LEGACY_THIRD_SET_COVERS`、`LEGACY_THIRD_SET_INTERIOR` 只用于按 id 查回，删了线上老书追加照片会刷成 1.09:1 的白底深色书。
- **禁止在给用户的回复里出现内部标识**（模板 id / 字体 id / 槽 id / 风格 id）。工具的 `notes` 是给模型看的，可以带 id；模型转述给用户时要说人话。

---

## 文件结构

**新建**
- `packages/contracts/src/design/third-set-palette.ts` — 多巴胺色表（从 apps/web 原样搬）
- `packages/contracts/src/design/page-backgrounds.ts` — 四个白系底色（从 apps/web 原样搬）
- `packages/contracts/src/design/contrast.ts` — WCAG 对比度计算，测试和运行时校验共用
- `packages/contracts/src/design/book-styles.ts` — 四风格表 + `bookStyleOf` 反推
- `packages/contracts/src/design/index.ts` — 统一出口
- `packages/contracts/src/design/*.test.ts` — 对应测试
- `packages/contracts/skills/album-style/SKILL.md` — 风格理解技能（本次核心）
- `apps/web/scripts/render-style-preview.mts` — 配色稿生成器

**修改**
- `apps/web/src/lib/design/third-set-palette.ts` — 整个换成 re-export 薄壳
- `apps/web/src/lib/design/page-backgrounds.ts` — 同上
- `packages/contracts/package.json` — 加 `./design` export，test glob 加 `src/design/*.test.ts`
- `packages/contracts/src/render/theme-carrier.ts` — 加 `PAGE_BACKGROUND_CARRIER_KEY`
- `packages/contracts/src/render/fill-template.ts` — 烘制时注入页底色
- `packages/design-agent/src/core/album/tools.ts` — 两个新工具 + 两个工具改造
- `packages/design-agent/src/core/album/system-prompt.ts` — 模糊反馈分流
- `packages/design-agent/src/web/album-server.ts` — 书级简报带当前风格
- `packages/contracts/skills/album-color/SKILL.md` — 补一句从风格调色板挑色
- `apps/web/src/services/album/design-apply.ts` — 同时写 carrier

**删除**
- `apps/web/src/lib/design/third-set-palette.test.ts` — 内容搬进 contracts
- `apps/web/render-covers.mts`、`apps/web/render-styles.mts` — 出稿用的临时脚本

---

## Task 1: 配色真相源搬进 contracts

**Files:**
- Create: `packages/contracts/src/design/third-set-palette.ts`, `packages/contracts/src/design/page-backgrounds.ts`, `packages/contracts/src/design/index.ts`
- Create: `packages/contracts/src/design/third-set-palette.test.ts`
- Modify: `packages/contracts/package.json`
- Modify: `apps/web/src/lib/design/third-set-palette.ts`（整个替换）, `apps/web/src/lib/design/page-backgrounds.ts`（整个替换）
- Delete: `apps/web/src/lib/design/third-set-palette.test.ts`

**Interfaces:**
- Consumes: 无（第一个任务）
- Produces: `@yujee/contracts/design` 导出 `THIRD_SET_COVERS`、`LEGACY_THIRD_SET_COVERS`、`THIRD_SET_INTERIOR`、`LEGACY_THIRD_SET_INTERIOR`、`THIRD_SET_INK`、`THIRD_SET_COVER_TEMPLATE_ID`、`DEFAULT_COVER_COLORWAY_ID`、`coverColorwayById(id)`、`coverColorwayForAlbum(albumId)`、`interiorInkSequence(seed, count)`、`legacyInteriorInkSequence(count)`、`PAGE_BACKGROUNDS`、`DEFAULT_PAGE_BACKGROUND`、`isValidPageBackground(hex)`、`isDefaultPageBackground(hex)`，以及类型 `CoverColorway`、`DarkInk`、`PageBackground`

- [ ] **Step 1: 原样搬两个源文件**

```bash
cd /Users/smalldog/Desktop/yujee工程文件/memoir-agent-rebuild
mkdir -p packages/contracts/src/design
git mv apps/web/src/lib/design/third-set-palette.ts packages/contracts/src/design/third-set-palette.ts
git mv apps/web/src/lib/design/page-backgrounds.ts packages/contracts/src/design/page-backgrounds.ts
git mv apps/web/src/lib/design/third-set-palette.test.ts packages/contracts/src/design/third-set-palette.test.ts
```

文件内容一个字都不要改（注释里记录的是线上事实和踩过的坑，改了就丢证据）。测试文件的 import 路径 `'./third-set-palette'` 恰好不用动。

- [ ] **Step 2: 建统一出口**

`packages/contracts/src/design/index.ts`：

```ts
// 设计真相源：配色表 + 风格表。design-agent 是独立包，够不着 apps/web，
// 所以这些表必须住在 contracts —— apps/web 侧留 re-export 薄壳保持导入路径不变。
export * from './third-set-palette';
export * from './page-backgrounds';
```

- [ ] **Step 3: 加 package export 和 test glob**

`packages/contracts/package.json`：`exports` 里 `"./render"` 之后加一行

```json
"./design": "./src/design/index.ts"
```

`scripts.test` 改成（**必须加 `src/design/*.test.ts`，否则新测试根本不会跑**）：

```json
"test": "tsx --test \"src/*.test.ts\" \"src/render/*.test.ts\" \"src/design/*.test.ts\""
```

- [ ] **Step 4: 跑搬过来的测试，确认全绿**

Run: `cd packages/contracts && pnpm test 2>&1 | tail -20`
Expected: 原有 8 条左右的第三套配色断言全 PASS（对比度、分布、前缀稳定、老书表）。若报模块解析失败，检查 Step 3 的 exports 是否写对。

- [ ] **Step 5: apps/web 换成薄壳**

`apps/web/src/lib/design/third-set-palette.ts` 整个文件替换成：

```ts
// 真相源已搬到 packages/contracts/src/design（design-agent 够不着 apps/web）。
// 这里留薄壳只为保持既有导入路径不变 —— 别在这里加逻辑或第二份色表。
export * from '@yujee/contracts/design';
```

`apps/web/src/lib/design/page-backgrounds.ts` 替换成同样两行注释 + 同一行 export。

- [ ] **Step 6: 跑 web 测试确认零回归**

Run: `cd apps/web && pnpm test 2>&1 | tail -30`
Expected: `design-apply.test.ts`、`compose-completed.test.ts`、`job-service-append.test.ts`、`cover-recap.test.ts` 全 PASS。这四个文件一行没改，它们绿了就证明搬家对调用方透明。

Run: `cd apps/web && pnpm typecheck`
Expected: 无错误。

- [ ] **Step 7: Commit**

```bash
git add -A packages/contracts apps/web/src/lib/design
git commit -m "refactor: 配色真相源搬进 contracts，apps/web 留 re-export 薄壳"
```

---

## Task 2: 对比度工具

**Files:**
- Create: `packages/contracts/src/design/contrast.ts`
- Create: `packages/contracts/src/design/contrast.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `contrastRatio(a: string, b: string): number`、`meetsAA(a: string, b: string): boolean`、`deltaE(a: string, b: string): number`、`bestInkFor(bg: string): '#F5F2E8' | '#1A1A14'`

**为什么单独抽一个文件：** 现在这套 WCAG 算法在 `third-set-palette.test.ts` 和 `cover-recap.test.ts` 里各抄了一份，Task 6 的运行时校验还要第三份。抽出来一处。

- [ ] **Step 1: 写失败的测试**

`packages/contracts/src/design/contrast.test.ts`：

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { bestInkFor, contrastRatio, meetsAA } from './contrast';
import { THIRD_SET_INK } from './third-set-palette';

test('黑白对比度是 21:1', () => {
  assert.ok(Math.abs(contrastRatio('#000000', '#FFFFFF') - 21) < 0.01);
});

test('对比度与参数顺序无关', () => {
  assert.equal(contrastRatio('#2D6DB0', '#F5F2E8'), contrastRatio('#F5F2E8', '#2D6DB0'));
});

test('支持 #RGB 简写', () => {
  assert.equal(contrastRatio('#000', '#fff'), contrastRatio('#000000', '#FFFFFF'));
});

test('meetsAA 卡在 4.5', () => {
  // 蓝底浅字 4.78 达标；橙原稿 #E8481C 配浅字 3.49 不达标（见 third-set-palette 注释）
  assert.equal(meetsAA('#2D6DB0', '#F5F2E8'), true);
  assert.equal(meetsAA('#E8481C', '#F5F2E8'), false);
});

test('bestInkFor 按两色规则选字色：深底浅字、浅底深字', () => {
  assert.equal(bestInkFor('#2D6DB0'), THIRD_SET_INK.light);
  assert.equal(bestInkFor('#F3F0A8'), THIRD_SET_INK.dark);
  assert.equal(bestInkFor('#FFFFFF'), THIRD_SET_INK.dark);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/contracts && npx tsx --test src/design/contrast.test.ts`
Expected: FAIL — `Cannot find module './contrast'`

- [ ] **Step 3: 实现**

`packages/contracts/src/design/contrast.ts`：

```ts
// WCAG 相对亮度/对比度。全仓唯一实现 —— 此前 third-set-palette.test.ts 和
// cover-recap.test.ts 各抄了一份，运行时校验（set_text_colors）需要第三份，抽出来一处。
import { THIRD_SET_INK } from './third-set-palette';

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** #RGB / #RRGGBB → 相对亮度。非法输入返回 NaN，由调用方判定。 */
export function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return Number.NaN;
  return (
    0.2126 * channel(parseInt(full.slice(0, 2), 16)) +
    0.7152 * channel(parseInt(full.slice(2, 4), 16)) +
    0.0722 * channel(parseInt(full.slice(4, 6), 16))
  );
}

/** 两色对比度（1~21）。与参数顺序无关。任一色非法返回 NaN。 */
export function contrastRatio(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)];
  if (Number.isNaN(la) || Number.isNaN(lb)) return Number.NaN;
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG AA 正文门槛 4.5:1。非法色返回 false（拒绝比放行安全）。 */
export function meetsAA(a: string, b: string): boolean {
  const ratio = contrastRatio(a, b);
  return Number.isFinite(ratio) && ratio >= 4.5;
}

/**
 * CIE76 色差（Lab 空间欧氏距离）。判断两个颜色**肉眼是否分得出**要用它，别用对比度 ——
 * 对比度只看亮度，看不见色相：冷灰 #E7EAE9 和暖砂 #F1E7D5 的对比度只有 1.01（垫底），
 * 但 ΔE 有 9.97（三对底色里最容易分的）。参考：ΔE≈2.3 刚能察觉，ΔE>5 明显可分。
 */
export function deltaE(a: string, b: string): number {
  const toLab = (hex: string): [number, number, number] => {
    const h = hex.replace('#', '');
    const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
    const [r, g, b2] = [0, 2, 4].map((i) => {
      const c = parseInt(full.slice(i, i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const X = f((0.4124 * r + 0.3576 * g + 0.1805 * b2) / 0.95047);
    const Y = f(0.2126 * r + 0.7152 * g + 0.0722 * b2);
    const Z = f((0.0193 * r + 0.1192 * g + 0.9505 * b2) / 1.08883);
    return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
  };
  const [A, B] = [toLab(a), toLab(b)];
  return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
}

/**
 * 按两色字规则给底色选字色：深底浅字、浅底深字。
 * 不按底色逐个派生字色 —— 那样一本书看着像五本书拼的（小雨拍板 2026-08-28）。
 */
export function bestInkFor(bg: string): string {
  return contrastRatio(bg, THIRD_SET_INK.light) >= contrastRatio(bg, THIRD_SET_INK.dark)
    ? THIRD_SET_INK.light
    : THIRD_SET_INK.dark;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/contracts && npx tsx --test src/design/contrast.test.ts`
Expected: 5 条全 PASS

- [ ] **Step 5: 出口加上，Commit**

`packages/contracts/src/design/index.ts` 加 `export * from './contrast';`

```bash
cd packages/contracts && pnpm test 2>&1 | tail -5
git add packages/contracts/src/design
git commit -m "feat: 抽出 WCAG 对比度工具，供风格校验与测试共用"
```

---

## Task 3: 四风格表与反推

**Files:**
- Create: `packages/contracts/src/design/book-styles.ts`
- Create: `packages/contracts/src/design/book-styles.test.ts`
- Modify: `packages/contracts/src/design/index.ts`

**Interfaces:**
- Consumes: Task 1 的 `THIRD_SET_INK`/`THIRD_SET_INTERIOR`/`PAGE_BACKGROUNDS`，Task 2 的 `contrastRatio`/`deltaE`
- Produces: `BOOK_STYLES: readonly BookStyle[]`、`bookStyleById(id)`、`bookStyleOf(coverTemplateId)`、`styleBackgroundOptions(styleId)`、类型 `BookStyle`、`BookStyleId = 'editorial' | 'magazine' | 'dopamine' | 'postcard'`

- [ ] **Step 1: 写失败的测试**

`packages/contracts/src/design/book-styles.test.ts`：

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { BOOK_STYLES, bookStyleById, bookStyleOf, styleBackgroundOptions } from './book-styles';
import { contrastRatio, deltaE } from './contrast';
import { THIRD_SET_INK, THIRD_SET_INTERIOR } from './third-set-palette';

test('四个风格，id 与封面模板一一对应', () => {
  assert.deepEqual(
    BOOK_STYLES.map((s) => [s.id, s.coverTemplateId, s.endingTemplateId]),
    [
      ['editorial', 'mag-01', 'mag-22'],
      ['magazine', 'mag-23', 'mag-22'],
      ['dopamine', 'mag-62', 'mag-63'],
      ['postcard', 'p01', 'mag-22'],
    ],
  );
});

test('非多巴胺风格的三个字色在自己底色上都过 4.5:1', () => {
  for (const style of BOOK_STYLES) {
    if (style.id === 'dopamine') continue;
    const bg = style.pageBackground;
    for (const [role, color] of Object.entries(style.colors)) {
      const ratio = contrastRatio(bg, color);
      assert.ok(ratio >= 4.5, `${style.id} 的 ${role} ${color} 落在 ${bg} 上只有 ${ratio.toFixed(2)}:1`);
    }
  }
});

test('三张白被拉开：任意两个非多巴胺底色肉眼明显可分（ΔE >= 5）', () => {
  // 换表前四套配的是 #FFFFFF/#FBF8F1/#F1F2F0/#ECEDEE，肉眼分不出，等于没有风格。
  //
  // 判据必须用色差 ΔE，不能用对比度：对比度只看亮度，看不见色相。冷灰 #E7EAE9 和
  // 暖砂 #F1E7D5 的对比度只有 1.01（三对里垫底），ΔE 却有 9.97（三对里最容易分的）。
  // 2026-08-29 实测三对：editorial↔magazine 6.37、editorial↔postcard 8.46、
  // magazine↔postcard 9.97。ΔE>5 = 明显可分。
  const bgs = BOOK_STYLES.filter((s) => s.id !== 'dopamine').map((s) => s.pageBackground);
  for (let i = 0; i < bgs.length; i += 1) {
    for (let j = i + 1; j < bgs.length; j += 1) {
      const diff = deltaE(bgs[i]!, bgs[j]!);
      assert.ok(diff >= 5, `${bgs[i]} 与 ${bgs[j]} 色差只有 ${diff.toFixed(2)}，肉眼分不出`);
    }
  }
});

test('多巴胺风格引用第三套五色，不另立一份色表', () => {
  const dopamine = bookStyleById('dopamine')!;
  assert.equal(dopamine.interiorInks, THIRD_SET_INTERIOR);
  assert.equal(dopamine.pageBackground, THIRD_SET_INTERIOR[0]!.bg);
});

test('多巴胺五色各自配的字色都过 4.5:1', () => {
  for (const ink of THIRD_SET_INTERIOR) {
    const ratio = contrastRatio(ink.bg, ink.body);
    assert.ok(ratio >= 4.5, `${ink.id} ${ink.bg} 配 ${ink.body} 只有 ${ratio.toFixed(2)}:1`);
    assert.ok(ink.body === THIRD_SET_INK.light || ink.body === THIRD_SET_INK.dark, '字色必须是两色之一');
  }
});

test('bookStyleOf 从封面模板反推风格', () => {
  assert.equal(bookStyleOf('mag-62').id, 'dopamine');
  assert.equal(bookStyleOf('mag-01').id, 'editorial');
  assert.equal(bookStyleOf('mag-23').id, 'magazine');
  assert.equal(bookStyleOf('p01').id, 'postcard');
});

test('表外封面回落 editorial（不抛错：老书/手工换过封面的书也要有风格）', () => {
  assert.equal(bookStyleOf('mag-32').id, 'editorial');
  assert.equal(bookStyleOf('').id, 'editorial');
});

test('多巴胺的底色选项是五色 id，其余风格是主底色 + 四白', () => {
  assert.deepEqual(
    styleBackgroundOptions('dopamine').map((o) => o.id),
    ['butter', 'violet', 'orange', 'green', 'blue'],
  );
  const editorial = styleBackgroundOptions('editorial');
  assert.equal(editorial[0]!.hex, '#FBF8F1');
  assert.deepEqual(editorial.map((o) => o.id).slice(1), ['white', 'ivory', 'mist', 'ash']);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/contracts && npx tsx --test src/design/book-styles.test.ts`
Expected: FAIL — `Cannot find module './book-styles'`

- [ ] **Step 3: 实现**

`packages/contracts/src/design/book-styles.ts`：

```ts
// 四个书级风格：Agent 能调用的「气质」单位。每个风格 = 封面/封底模板 + 页底色 + 三个文字色。
//
// 为什么不是照搬选封面卡的四套：卡上四套配的页底色是 PAGE_BACKGROUNDS 的
// #FFFFFF/#FBF8F1/#F1F2F0/#ECEDEE —— 四个白，肉眼分不出；字体也不随套变。
// 照搬映射成四个风格，用户说「换成风格 2」时全书几乎不变，是个空功能。
// 所以这里给另外三套各自补了真配色（暖白 / 冷灰 / 暖砂），第三套沿用现成的多巴胺。
// （小雨拍板 2026-08-29，配色稿见 apps/web/scripts/render-style-preview.mts）
//
// ⚠️ 色值不是随便填的：非多巴胺三套的每个字色都卡着 4.5:1（见 book-styles.test.ts）。
// 两个 explain 色都是压深来的，别改回更浅的：
//   · magazine #6E7370 在 #E7EAE9 上实测 3.99 —— 不达标，压到 #646966 才有 4.62；
//   · postcard  #A8502E 在 #F1E7D5 上实测 4.45 —— 差 0.05，压到 #A34E2D 才有 4.65
//     （它本身已经是 p01 模板自带的 #d27b62（仅 2.9:1）压深过一轮的结果）。
// 改任何色值都要重跑测试，别凭眼睛判断。
import { PAGE_BACKGROUNDS } from './page-backgrounds';
import { type DarkInk, THIRD_SET_INK, THIRD_SET_INTERIOR } from './third-set-palette';

export type BookStyleId = 'editorial' | 'magazine' | 'dopamine' | 'postcard';

export type BookStyle = {
  id: BookStyleId;
  /** 给用户看的中文名。模型转述时用它，不要报 id。 */
  name: string;
  nameEn: string;
  /** 一句话气质，进 skill 和书级简报。 */
  mood: string;
  coverTemplateId: string;
  endingTemplateId: string;
  /** 主页底色。多巴胺是五色里的第一个，实际每页按 interiorInkSequence 抽。 */
  pageBackground: string;
  colors: { title: string; body: string; explain: string };
  /** 只有多巴胺有：内页可用的整张色表。其余风格靠 pageBackground 单色。 */
  interiorInks?: readonly DarkInk[];
};

export const BOOK_STYLES: readonly BookStyle[] = [
  {
    id: 'editorial',
    name: '素白散文',
    nameEn: 'Editorial',
    mood: '暖白纸配墨黑字，留白最多，长段落最好读',
    coverTemplateId: 'mag-01',
    endingTemplateId: 'mag-22',
    pageBackground: '#FBF8F1',
    colors: { title: '#1C1B18', body: '#2E2C27', explain: '#6B6760' },
  },
  {
    id: 'magazine',
    name: '杂志刊头',
    nameEn: 'Magazine',
    mood: '冷灰底配纯黑字，硬朗、信息密度高，像一本作品集',
    coverTemplateId: 'mag-23',
    endingTemplateId: 'mag-22',
    pageBackground: '#E7EAE9',
    colors: { title: '#0F0F0F', body: '#2B2E2C', explain: '#646966' },
  },
  {
    id: 'dopamine',
    name: '多巴胺',
    nameEn: 'Dopamine',
    mood: '整页满版彩色底，一页一个颜色，最跳最年轻',
    coverTemplateId: 'mag-62',
    endingTemplateId: 'mag-63',
    // 底色逐页由 interiorInkSequence 派，这里放第一个色只作为「代表色」用于预览和兜底。
    pageBackground: THIRD_SET_INTERIOR[0]!.bg,
    colors: { title: THIRD_SET_INK.dark, body: THIRD_SET_INK.dark, explain: THIRD_SET_INK.dark },
    interiorInks: THIRD_SET_INTERIOR,
  },
  {
    id: 'postcard',
    name: '旅行画报',
    nameEn: 'Postcard',
    mood: '暖砂底配陶土橙图注，胶片明信片感，适合旅途和老照片',
    coverTemplateId: 'p01',
    endingTemplateId: 'mag-22',
    pageBackground: '#F1E7D5',
    colors: { title: '#1C1B18', body: '#3A362E', explain: '#A34E2D' },
  },
];

export const DEFAULT_BOOK_STYLE_ID: BookStyleId = 'editorial';

export function bookStyleById(id: string | null | undefined): BookStyle | undefined {
  return BOOK_STYLES.find((s) => s.id === id);
}

/**
 * 从封面模板反推风格。**故意不存字段** —— 封面模板与风格一一对应，反推等于零迁移，
 * 老书自动就有风格。用户单独换过封面模板时风格跟着变，这是对的：封面就是风格的脸。
 *
 * 认不出的封面（换成了表外模板）回落 editorial 而不是抛错：Agent 任何时候都要能
 * 答出「这本书现在是什么风格」，答不出比答得不准更糟。
 */
export function bookStyleOf(coverTemplateId: string | null | undefined): BookStyle {
  return (
    BOOK_STYLES.find((s) => s.coverTemplateId === coverTemplateId) ??
    bookStyleById(DEFAULT_BOOK_STYLE_ID)!
  );
}

export type BackgroundOption = { id: string; name: string; hex: string };

/**
 * 某风格下页底色的合法取值。Agent 只能从这张表里挑，不能自由填 hex ——
 * 自由 hex 会超四色印刷色域（印不出）且对比度失守（小雨拍板 2026-08-29）。
 */
export function styleBackgroundOptions(styleId: string): BackgroundOption[] {
  const style = bookStyleById(styleId) ?? bookStyleById(DEFAULT_BOOK_STYLE_ID)!;
  if (style.interiorInks) {
    return style.interiorInks.map((ink) => ({ id: ink.id, name: ink.id, hex: ink.bg }));
  }
  return [
    { id: style.id, name: style.name, hex: style.pageBackground },
    ...PAGE_BACKGROUNDS.map((b) => ({ id: b.id, name: b.name, hex: b.hex })),
  ];
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/contracts && npx tsx --test src/design/book-styles.test.ts`
Expected: 8 条全 PASS。若「三张白被拉开」失败，说明底色改回了近似值——不要放宽阈值，改底色。

- [ ] **Step 5: 出口加上并跑全量，Commit**

`packages/contracts/src/design/index.ts` 加 `export * from './book-styles';`

```bash
cd packages/contracts && pnpm test 2>&1 | tail -5
git add packages/contracts/src/design
git commit -m "feat: 四个书级风格表与封面反推"
```

---

## Task 4: 页底色 carrier（挺过重烘）

**Files:**
- Modify: `packages/contracts/src/theme-carrier.ts`（加常量）
- Modify: `packages/contracts/src/render/fill-template.ts`（烘制时注入）
- Create: `packages/contracts/src/render/page-background.ts`（注入函数，单独文件便于测试）
- Create: `packages/contracts/src/render/page-background.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `isValidPageBackground` 不用；此处只做 hex 合法性正则
- Produces: `PAGE_BACKGROUND_CARRIER_KEY = '#pageBackground'`、`applyPageBackground(html: string, hex: string | undefined): string`

**背景：** `set_text_colors` 和 `swap_page_template` 都是 `page.html = undefined` 再从模板重烘。
`applyDesign` 写的 inline 背景色在重烘后会丢。所以页底色必须变成「重烘能读到的四字段」之一 ——
走 texts 这张 string map 的 magic key 文法（与 `#accentColor`/`#artFont` 同一套）。

**关键约束：** `background-color` 必须追加在页根 style 的**末尾**。模板根节点写的是
`background:#fff` **简写**，前置会被它盖掉（本设计过程中实测踩中过）。

- [ ] **Step 1: 写失败的测试**

`packages/contracts/src/render/page-background.test.ts`：

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { applyPageBackground } from './page-background';

const ROOT = '<div data-template="mag-05" style="position:relative;width:794px;background:#fff;color:#1c1b18">x</div>';

test('无底色时逐字节不变', () => {
  assert.equal(applyPageBackground(ROOT, undefined), ROOT);
  assert.equal(applyPageBackground(ROOT, ''), ROOT);
});

test('background-color 追加在 style 末尾（必须盖住 background:#fff 简写）', () => {
  const out = applyPageBackground(ROOT, '#F3F0A8');
  const style = /style="([^"]*)"/.exec(out)![1]!;
  assert.ok(style.endsWith('background-color:#F3F0A8'), `末尾不是新底色：${style}`);
  assert.ok(style.indexOf('background:#fff') < style.indexOf('background-color:'), '简写必须在前才盖得住');
});

test('页根没有 style 属性时补一个', () => {
  const bare = '<div data-template="mag-05">x</div>';
  assert.equal(applyPageBackground(bare, '#2D6DB0'), '<div data-template="mag-05" style="background-color:#2D6DB0">x</div>');
});

test('重复应用是幂等的（同一个键覆盖，不追加第二份）', () => {
  const once = applyPageBackground(ROOT, '#F3F0A8');
  const twice = applyPageBackground(once, '#F3F0A8');
  assert.equal(twice, once);
  const changed = applyPageBackground(once, '#2D6DB0');
  assert.equal((changed.match(/background-color:/g) ?? []).length, 1, '不能留下两个 background-color');
});

test('非法色值原样返回（拒绝比写坏安全）', () => {
  assert.equal(applyPageBackground(ROOT, 'red; content:url(x)'), ROOT);
  assert.equal(applyPageBackground(ROOT, 'rgb(1,2,3)'), ROOT);
});

test('找不到页根时原样返回', () => {
  assert.equal(applyPageBackground('<p>no root</p>', '#F3F0A8'), '<p>no root</p>');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/contracts && npx tsx --test src/render/page-background.test.ts`
Expected: FAIL — `Cannot find module './page-background'`

- [ ] **Step 3: 实现注入函数**

`packages/contracts/src/render/page-background.ts`：

```ts
// 页底色注入：把 texts['#pageBackground'] 落到页根 [data-template] 的 inline style。
//
// 为什么要有它：set_text_colors / swap_page_template 都会 page.html = undefined 再从
// 模板重烘，applyDesign 写的 inline 背景色会丢。页底色必须是「重烘能读到的字段」，
// 所以借 texts 这张 string map 走 magic key 文法（与 #accentColor / #artFont 同一套）。
//
// ⚠️ background-color 必须追加在 style **末尾**：模板根节点写的是 background:#fff
// **简写**，前置会被它盖掉。web 的 upsertStyleAttr 用 Map 保序、新键天然落末尾，
// 所以那条 inline 路径一直是对的；这里要显式保证同样的顺序。

/** 页根是 html 里第一个带 data-template 的元素（见 render/html-templates/*：794×1123 外框）。 */
const ROOT_RE = /<[a-z0-9]+\b[^>]*\bdata-template="[^"]*"[^>]*>/i;
const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const BG_PROP = 'background-color';

export function applyPageBackground(html: string, hex: string | undefined | null): string {
  if (!hex || !HEX_RE.test(hex)) return html; // 含非法值：原样返回，不写坏页面
  const m = ROOT_RE.exec(html);
  if (!m) return html;
  const openTag = m[0]!;
  const styleMatch = /style="([^"]*)"/.exec(openTag);
  let nextTag: string;
  if (styleMatch) {
    // 去掉已有的 background-color（幂等），再把新值追加到末尾
    const decls = styleMatch[1]!
      .split(';')
      .map((d) => d.trim())
      .filter((d) => d && !d.toLowerCase().startsWith(`${BG_PROP}:`));
    decls.push(`${BG_PROP}:${hex}`);
    nextTag = openTag.replace(styleMatch[0]!, `style="${decls.join(';')}"`);
  } else {
    nextTag = openTag.replace(/>$/, ` style="${BG_PROP}:${hex}">`);
  }
  return html.slice(0, m.index) + nextTag + html.slice(m.index + openTag.length);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/contracts && npx tsx --test src/render/page-background.test.ts`
Expected: 6 条全 PASS

- [ ] **Step 5: 加 carrier 键常量**

`packages/contracts/src/theme-carrier.ts` 在 `THEME_FONT_CARRIER_SUFFIX` 之后加：

```ts
/**
 * 页级 carrier 键：页底色落 `texts['#pageBackground']`。
 *
 * 与 ①②（槽级 sibling carrier）不同，这是**页级**键 —— 没有 slotId 前缀，整页一个值。
 * 零碰撞同样成立：真实 slotId 不含 `#`，而这个键以 `#` 起头。
 */
export const PAGE_BACKGROUND_CARRIER_KEY = '#pageBackground';
```

同时在 `packages/contracts/src/design/index.ts` 末尾 re-export 它，让 `@yujee/contracts/design`
成为设计相关的一站式出口（下游只记一个路径）：

```ts
export { PAGE_BACKGROUND_CARRIER_KEY } from '../theme-carrier';
```

- [ ] **Step 6: 写「无 carrier 时逐字节不变」的守卫测试**

这条护的是 engine 和 web 共用的渲染路径，最重要。追加到 `packages/contracts/src/render/page-background.test.ts`：

```ts
import { renderPageHtml } from './fill-template';
import { PAGE_BACKGROUND_CARRIER_KEY } from '../theme-carrier';
import { TEMPLATES } from '../templates.generated';

function sample(templateId: string, extraTexts: Record<string, string> = {}) {
  const tpl = (TEMPLATES as Record<string, { texts?: { id: string; sample?: string }[]; images?: { id: string }[] }>)[templateId]!;
  const texts: Record<string, string> = {};
  for (const t of tpl.texts ?? []) texts[t.id] = t.sample ?? '';
  const images: Record<string, string> = {};
  for (const im of tpl.images ?? []) images[im.id] = `p-${im.id}`;
  return { templateId, images, texts: { ...texts, ...extraTexts } };
}

test('没有 #pageBackground 键时，renderPageHtml 输出逐字节不变', () => {
  for (const id of ['mag-05', 'mag-13', 'mag-01', 'mag-62']) {
    const before = renderPageHtml(sample(id), () => 'IMG');
    const after = renderPageHtml(sample(id, { unrelated: 'x' }), () => 'IMG');
    assert.ok(before, `${id} 渲染失败`);
    // 与本次改动前的行为对齐：无 carrier 键 → 页根不出现 background-color
    assert.ok(!/data-template="[^"]*"[^>]*background-color:/.test(before!), `${id} 页根多了 background-color`);
    assert.ok(after);
  }
});

test('有 #pageBackground 键时，页根末尾出现该底色', () => {
  const html = renderPageHtml(sample('mag-05', { [PAGE_BACKGROUND_CARRIER_KEY]: '#F3F0A8' }), () => 'IMG')!;
  const style = /data-template="mag-05"[^>]*style="([^"]*)"/.exec(html)![1]!;
  assert.ok(style.endsWith('background-color:#F3F0A8'), `末尾不是底色：${style}`);
});

test('#pageBackground 不会被当成文字槽渲进页面内容', () => {
  const html = renderPageHtml(sample('mag-05', { [PAGE_BACKGROUND_CARRIER_KEY]: '#F3F0A8' }), () => 'IMG')!;
  assert.ok(!html.includes('>#F3F0A8<'), 'carrier 值漏进了页面文字');
});
```

- [ ] **Step 7: 跑测试确认新增三条里有失败的**

Run: `cd packages/contracts && npx tsx --test src/render/page-background.test.ts`
Expected: 前两条 PASS（本来就不会有 background-color），第 8 条「有 #pageBackground 键时」FAIL —— `renderPageHtml` 还没接上注入。

- [ ] **Step 8: 在 renderPageHtml 里接上**

`packages/contracts/src/render/fill-template.ts`：
1. 顶部 import 加 `import { applyPageBackground } from './page-background';` 和 `import { PAGE_BACKGROUND_CARRIER_KEY } from '../theme-carrier';`
2. `renderPageHtml`（文件末尾那个函数）改成：

```ts
export function renderPageHtml(page: FillablePage, resolveImage: ResolveImage): string | undefined {
  const tpl = getHtmlTemplate(page.templateId);
  if (!tpl) return undefined;
  // 页底色是页级 carrier，不走 token 替换（模板里没有对应 token，53 个模板不可能挨个加）——
  // 填充完成后统一注入页根 style 末尾。无该键时 applyPageBackground 原样返回，老书零影响。
  return applyPageBackground(
    fillTemplateHtml(tpl, page, resolveImage),
    page.texts[PAGE_BACKGROUND_CARRIER_KEY],
  );
}
```

- [ ] **Step 9: 跑 contracts 全量测试**

Run: `cd packages/contracts && pnpm test 2>&1 | tail -20`
Expected: 全绿，特别是 `fill-template.test.ts` 和 `html-templates.smoke.test.ts` 不许红 —— 它们红了说明「无 carrier 逐字节不变」被破了。

- [ ] **Step 10: 跑 mutation 验证守卫真会红**

把 `applyPageBackground` 里 `decls.push(...)` 临时改成 `decls.unshift(...)`（前置而非追加），重跑测试。

Run: `cd packages/contracts && npx tsx --test src/render/page-background.test.ts`
Expected: 「追加在 style 末尾」那条 FAIL。确认后**改回 push**。守卫绿不是证据，能红才是。

- [ ] **Step 11: Commit**

```bash
git add packages/contracts/src/theme-carrier.ts packages/contracts/src/render
git commit -m "feat: 页底色 carrier，重烘后不再丢失"
```

---

## Task 5: `set_page_background` 工具

**Files:**
- Modify: `packages/design-agent/src/core/album/tools.ts`
- Create: `packages/design-agent/test/set-page-background.test.ts`

**Interfaces:**
- Consumes: Task 3 的 `bookStyleOf`/`styleBackgroundOptions`、Task 2 的 `bestInkFor`、Task 4 的 `PAGE_BACKGROUND_CARRIER_KEY`
- Produces: 工具 `set_page_background`；内部辅助 `currentBookStyle(options): BookStyle`（Task 6/7/8 复用）

**先读现有代码：** `tools.ts` 的 `createSetTextColorsTool`（约 686-766 行）是最接近的范本 ——
照它的形状写：`prepareArguments` 归一化入参、`execute` 里 `cloneAlbumBookState` → 改 → `commitWrite`。
页码解析一律走 `resolveRefToInternal(options, value)`（用户口径页码是铁律）。

- [ ] **Step 1: 写失败的测试**

`packages/design-agent/test/set-page-background.test.ts`。

**fixture 照抄 `test/album-delete-page-tool.test.ts` 的 `createHarness()`** —— 它从
`fixtures/sample-book.json` 建书 + `loadTemplateCatalog()` + `createAlbumTools()`，别另造一套。
该 fixture 6 页，`pages[0]` 是 **mag-01**（→ editorial 风格）、`pages[5]` 是 mag-22。所以：

```ts
// editorial：直接用 fixture
function setupEditorialBook() { return createHarness(); }
// dopamine：把封面换成 mag-62，风格靠封面反推，改这一个字段就够
function setupDopamineBook() {
  const h = createHarness();
  const state = h.getBook();
  state.pages[0]!.templateId = 'mag-62';
  h.setBook(state); // createHarness 里补一个 setBook 出口
  return h;
}
```

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { createAlbumTools } from '../src/core/album/tools.ts';
// fixture 构造：照抄同目录既有测试里建 catalog / bookState 的写法

test('把内页第 1 页刷成多巴胺的黄底，字色跟着翻成深字', async () => {
  // 书的封面是 mag-62 → 当前风格 dopamine
  const { tools, getState } = setupDopamineBook();
  const tool = tools.find((t) => t.name === 'set_page_background')!;
  await tool.execute('c1', tool.prepareArguments({ pages: [1], colorId: 'butter' }));
  const page = getState().pages[1]!; // 0 是封面
  assert.equal(page.texts['#pageBackground'], '#F3F0A8');
  // 浅底 → 深字
  assert.equal(page.texts['title#accentColor'], '#1A1A14');
  assert.ok(page.html!.includes('background-color:#F3F0A8'));
});

test('刷成蓝底时字色翻成浅字', async () => {
  const { tools, getState } = setupDopamineBook();
  const tool = tools.find((t) => t.name === 'set_page_background')!;
  await tool.execute('c1', tool.prepareArguments({ pages: [1], colorId: 'blue' }));
  assert.equal(getState().pages[1]!.texts['title#accentColor'], '#F5F2E8');
});

test('pages 传 "all" 刷全书', async () => {
  const { tools, getState } = setupDopamineBook();
  const tool = tools.find((t) => t.name === 'set_page_background')!;
  const result = await tool.execute('c1', tool.prepareArguments({ pages: 'all', colorId: 'green' }));
  for (const page of getState().pages) assert.equal(page.texts['#pageBackground'], '#107E47');
  assert.ok(result.details!.notes!.join(' ').includes('全书'));
});

test('表外 colorId 被打回，且报错里列出可选值', async () => {
  const { tools } = setupDopamineBook();
  const tool = tools.find((t) => t.name === 'set_page_background')!;
  await assert.rejects(
    () => tool.execute('c1', tool.prepareArguments({ pages: [1], colorId: 'hotpink' })),
    (err: Error) => {
      assert.match(err.message, /butter/);
      assert.match(err.message, /blue/);
      return true;
    },
  );
});

test('非多巴胺风格只能用该风格底色 + 四白，不能用五色', async () => {
  const { tools } = setupEditorialBook(); // 封面 mag-01
  const tool = tools.find((t) => t.name === 'set_page_background')!;
  await assert.rejects(() => tool.execute('c1', tool.prepareArguments({ pages: [1], colorId: 'violet' })));
  await tool.execute('c1', tool.prepareArguments({ pages: [1], colorId: 'ivory' }));
});

test('封面/封尾用类别名指代', async () => {
  const { tools, getState } = setupDopamineBook();
  const tool = tools.find((t) => t.name === 'set_page_background')!;
  await tool.execute('c1', tool.prepareArguments({ pages: ['cover'], colorId: 'red' }));
  assert.ok(getState().pages[0]!.texts['#pageBackground']);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/design-agent && npx tsx --test test/set-page-background.test.ts`
Expected: FAIL — 找不到名为 `set_page_background` 的工具

- [ ] **Step 3: 实现**

`tools.ts` 顶部 import 加：

```ts
import {
  type BookStyle,
  bestInkFor,
  bookStyleOf,
  PAGE_BACKGROUND_CARRIER_KEY,
  styleBackgroundOptions,
} from "@yujee/contracts/design";
```

schema 和工具：

```ts
const setPageBackgroundSchema = Type.Object({
  pages: Type.Union([Type.Literal("all"), Type.Array(PageRefSchema)], {
    description: `要改底色的页：${PAGE_REF_DESCRIPTION} 传 "all" 表示全书。`,
  }),
  colorId: Type.String({ description: "底色 id，只能从当前风格的调色板里挑（报错时会列出可选值）。" }),
});
type SetPageBackgroundInput = Static<typeof setPageBackgroundSchema>;

/** 当前书的风格：从封面页的模板反推（封面模板与风格一一对应，故意不存字段）。 */
function currentBookStyle(options: AlbumToolsOptions): BookStyle {
  const state = options.getBookState();
  const coverPage = state.pages.find((p) => options.catalog.get(p.templateId)?.category === "cover");
  return bookStyleOf(coverPage?.templateId);
}

function createSetPageBackgroundTool(
  options: AlbumToolsOptions,
): AgentTool<typeof setPageBackgroundSchema, AlbumWriteDetails> {
  return {
    name: "set_page_background",
    label: "设定页面底色",
    description:
      "改页面底色：指定页或全书换一个底色，该页文字色按深底浅字/浅底深字自动跟着翻。底色只能从当前风格的调色板里挑，传错会列出可选值。整本换气质用 apply_book_style，不要用这个逐页刷。",
    parameters: setPageBackgroundSchema,
    prepareArguments(args: unknown): SetPageBackgroundInput {
      if (!isRecord(args)) return { pages: [], colorId: "" };
      const pages =
        args.pages === "all"
          ? ("all" as const)
          : Array.isArray(args.pages)
            ? args.pages
            : args.pages !== undefined
              ? [args.pages]
              : [];
      return { pages, colorId: typeof args.colorId === "string" ? args.colorId.trim() : "" };
    },
    async execute(
      _toolCallId: string,
      params: SetPageBackgroundInput,
    ): Promise<AgentToolResult<AlbumWriteDetails>> {
      const style = currentBookStyle(options);
      const optionsList = styleBackgroundOptions(style.id);
      const picked = optionsList.find((o) => o.id === params.colorId);
      if (!picked) {
        throw new Error(
          `底色 "${params.colorId}" 不在「${style.name}」风格的调色板里。可选：${optionsList
            .map((o) => o.id)
            .join(" / ")}`,
        );
      }

      const state = options.getBookState();
      const targets =
        params.pages === "all"
          ? state.pages.map((_, i) => i + 1)
          : params.pages.map((ref) => resolveRefToInternal(options, ref));
      const bad = targets.filter((n) => n <= 0);
      if (bad.length > 0 || targets.length === 0) {
        throw new Error(`认不出要改哪几页。${pageRefRangeText(options, state)}`);
      }

      const ink = bestInkFor(picked.hex);
      const nextState = cloneAlbumBookState(state);
      const touched: number[] = [];
      for (const internalNo of targets) {
        const page = nextState.pages[internalNo - 1];
        if (!page) continue;
        const template = options.catalog.get(page.templateId);
        page.texts[PAGE_BACKGROUND_CARRIER_KEY] = picked.hex;
        // 底色变了字色必须跟着翻，否则留下「改完底色字读不了」的中间态。
        if (template) {
          for (const slotId of collectThemeableSlots(page, template)) {
            page.texts[`${slotId}#accentColor`] = ink;
          }
        }
        page.html = undefined;
        page.html = bakeAlbumPageHtml(page);
        touched.push(internalNo);
      }
      if (touched.length === 0) throw new Error("没有页面被改到，检查页码。");

      const notes = [
        params.pages === "all" ? `全书 ${touched.length} 页刷成${picked.name}` : `${touched.length} 页刷成${picked.name}`,
        `文字色跟着翻成 ${ink === "#F5F2E8" ? "浅字" : "深字"}`,
      ];
      return commitWrite(options, nextState, {
        pageNo: touched[0]!,
        operations: [`pageBackground:${picked.id}=${picked.hex}`],
        notes,
      });
    },
  };
}
```

在 `createAlbumTools` 的返回数组里，`createSetTextColorsTool(options)` 之后加一行
`createSetPageBackgroundTool(options),`。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/design-agent && npx tsx --test test/set-page-background.test.ts`
Expected: 6 条全 PASS

- [ ] **Step 5: Commit**

```bash
git add packages/design-agent
git commit -m "feat: set_page_background 工具，底色限定在风格调色板内"
```

---

## Task 6: `apply_book_style` 工具

**Files:**
- Modify: `packages/design-agent/src/core/album/tools.ts`
- Create: `packages/design-agent/test/apply-book-style.test.ts`

**Interfaces:**
- Consumes: Task 3 的 `BOOK_STYLES`/`bookStyleById`、Task 5 的 `currentBookStyle`、`migratePageToTemplate`（tools.ts 已有，约 1111 行）、`interiorInkSequence`
- Produces: 工具 `apply_book_style`

**这是整本刷：** 换封面/封底模板 + 全书页底色 + 三色文字。多巴胺走
`interiorInkSequence(seed, count)` 那条确定性序列 —— **不能用随机**，追加照片时只重刷新页，
两次结果不一样就会让新页跟全书不同色。seed 用书状态里能拿到的稳定标识（`albumId`，
拿不到时回落封面 photoId），逐页顺序取序列的第 i 项。

- [ ] **Step 1: 写失败的测试**

`packages/design-agent/test/apply-book-style.test.ts`（fixture 同 Task 5）：

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { interiorInkSequence } from '@yujee/contracts/design';
import { bookSeed } from '../src/core/album/tools.ts';

test('换成多巴胺：封面变 mag-62、封底变 mag-63，内页底色走确定性序列', async () => {
  const { tools, getBook } = createHarness(); // fixture 封面 mag-01
  const tool = tools.get('apply_book_style')!;
  await tool.execute('c1', tool.prepareArguments({ styleId: 'dopamine' }));
  const book = getBook();
  assert.equal(book.pages[0]!.templateId, 'mag-62');
  assert.equal(book.pages[book.pages.length - 1]!.templateId, 'mag-63');
  const interiors = book.pages.slice(1, -1);
  const expected = interiorInkSequence(bookSeed(book), interiors.length);
  interiors.forEach((page, i) => {
    assert.equal(page.texts['#pageBackground'], expected[i]!.bg);
    assert.equal(page.texts['title#accentColor'], expected[i]!.accent);
  });
});

test('同一本书连刷两次多巴胺，逐页颜色完全一致（确定性，不是随机）', async () => {
  const a = createHarness(); const b = createHarness();
  for (const h of [a, b]) await h.tools.get('apply_book_style')!.execute('c1', { styleId: 'dopamine' } as never);
  assert.deepEqual(
    a.getBook().pages.map((p) => p.texts['#pageBackground']),
    b.getBook().pages.map((p) => p.texts['#pageBackground']),
  );
});

test('换成杂志刊头：全书单一冷灰底 + 三个文字色', async () => {
  const { tools, getBook } = createHarness();
  await tools.get('apply_book_style')!.execute('c1', { styleId: 'magazine' } as never);
  const book = getBook();
  assert.equal(book.pages[0]!.templateId, 'mag-23');
  for (const page of book.pages) assert.equal(page.texts['#pageBackground'], '#E7EAE9');
  assert.equal(book.pages[1]!.texts['title#accentColor'], '#0F0F0F');
});

test('返回值报告封面文案迁移代价', async () => {
  const { tools } = createHarness();
  const result = await tools.get('apply_book_style')!.execute('c1', { styleId: 'dopamine' } as never);
  assert.match(result.details!.notes!.join(' '), /封面/);
});

test('已经是该风格时打回，不空转', async () => {
  const { tools } = createHarness(); // 已是 editorial
  await assert.rejects(
    () => tools.get('apply_book_style')!.execute('c1', { styleId: 'editorial' } as never),
    /已经是/,
  );
});

test('未知 styleId 打回并列出四个风格', async () => {
  const { tools } = createHarness();
  await assert.rejects(
    () => tools.get('apply_book_style')!.execute('c1', { styleId: 'vaporwave' } as never),
    (err: Error) => {
      for (const id of ['editorial', 'magazine', 'dopamine', 'postcard']) assert.match(err.message, new RegExp(id));
      return true;
    },
  );
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/design-agent && npx tsx --test test/apply-book-style.test.ts`
Expected: FAIL — 找不到 `apply_book_style`

- [ ] **Step 3: 实现**

```ts
const applyBookStyleSchema = Type.Object({
  styleId: Type.String({
    description: "风格 id：editorial（素白散文）/ magazine（杂志刊头）/ dopamine（多巴胺）/ postcard（旅行画报）",
  }),
});
type ApplyBookStyleInput = Static<typeof applyBookStyleSchema>;

function createApplyBookStyleTool(
  options: AlbumToolsOptions,
): AgentTool<typeof applyBookStyleSchema, AlbumWriteDetails> {
  return {
    name: "apply_book_style",
    label: "更换全书风格",
    description:
      "整本换气质：换封面和封底版式、刷全书页底色和三个文字色。四个风格见「风格理解」技能。用户对整本观感不满（太素/太花/想文艺点/想活泼点）时用它；只有某几页颜色不对用 set_page_background。注意：换封面版式会重排封面文案，迁不过去的会丢，动手前先告诉用户。",
    parameters: applyBookStyleSchema,
    prepareArguments(args: unknown): ApplyBookStyleInput {
      return { styleId: isRecord(args) && typeof args.styleId === "string" ? args.styleId.trim() : "" };
    },
    async execute(
      _toolCallId: string,
      params: ApplyBookStyleInput,
    ): Promise<AgentToolResult<AlbumWriteDetails>> {
      const target = bookStyleById(params.styleId);
      if (!target) {
        throw new Error(
          `未知风格 "${params.styleId}"。可选：${BOOK_STYLES.map((s) => `${s.id}（${s.name}）`).join(" / ")}`,
        );
      }
      const current = currentBookStyle(options);
      if (current.id === target.id) {
        throw new Error(
          `这本书已经是「${target.name}」了。要微调就用 set_page_background 换底色，或 set_text_colors 换字色。`,
        );
      }

      const state = options.getBookState();
      const nextState = cloneAlbumBookState(state);
      const notes: string[] = [];
      const categoryOf = catalogCategoryOf(options.catalog);

      // ① 换封面/封底模板（图槽数不匹配就跳过并说明，不要因此整个操作失败）
      for (const [idx, page] of nextState.pages.entries()) {
        const category = categoryOf(page.templateId);
        const wantId =
          category === "cover" ? target.coverTemplateId : category === "ending" ? target.endingTemplateId : undefined;
        if (!wantId || wantId === page.templateId) continue;
        const nextTemplate = options.catalog.get(wantId);
        if (!nextTemplate) continue;
        if (nextTemplate.imageSlotIds.length !== Object.keys(page.images).length) {
          notes.push(`${category === "cover" ? "封面" : "封尾"}图槽数对不上，版式没换（底色和字色仍已刷）`);
          continue;
        }
        const migrateNotes: string[] = [];
        nextState.pages[idx] = migratePageToTemplate(page, nextTemplate, migrateNotes);
        notes.push(
          `${category === "cover" ? "封面" : "封尾"}版式换成 ${wantId}${
            migrateNotes.length > 0 ? `（${migrateNotes.join("；")}）` : ""
          }`,
        );
      }
      notes.push("封面/封尾文案已按新版式重排，迁不过去的槽已清空 —— 告诉用户并确认是否要补写");

      // ② 逐页刷底色和字色
      // 多巴胺：确定性序列（同 seed 同长度逐项相同、前缀稳定）。绝不能换成随机 ——
      // 追加照片时只重刷新页，两次结果不一样就会让新页跟全书不是一套色。
      const seed = bookSeed(nextState);
      const interiorIdx = nextState.pages
        .map((p, i) => ({ i, category: categoryOf(p.templateId) }))
        // NON_NUMBERED_PAGE_CATEGORIES 是 Set（book-state.ts:170），用 .has 不是 .includes
        .filter((x) => !NON_NUMBERED_PAGE_CATEGORIES.has(x.category ?? ""))
        .map((x) => x.i);
      const sequence = target.interiorInks ? interiorInkSequence(seed, interiorIdx.length) : undefined;

      for (const [idx, page] of nextState.pages.entries()) {
        const template = options.catalog.get(page.templateId);
        if (!template) continue;
        const seqPos = interiorIdx.indexOf(idx);
        const ink = sequence && seqPos >= 0 ? sequence[seqPos]! : undefined;
        const bg = ink?.bg ?? target.pageBackground;
        const colors = ink
          ? { title: ink.accent, body: ink.body, explain: ink.body }
          : target.colors;
        page.texts[PAGE_BACKGROUND_CARRIER_KEY] = bg;
        for (const slotId of collectThemeableSlots(page, template)) {
          const role = template.textDefsByBase.get(slotBaseIdForTheme(slotId))?.role ?? "text";
          const kind = ROLE_TO_COLOR_KIND[role];
          page.texts[`${slotId}#accentColor`] =
            kind === "body" ? colors.body : kind === "caption" ? colors.explain : colors.title;
        }
        page.html = undefined;
        page.html = bakeAlbumPageHtml(page);
      }

      notes.unshift(`全书 ${nextState.pages.length} 页刷成「${target.name}」`);
      return commitWrite(options, nextState, {
        pageNo: 1,
        operations: [`bookStyle:${current.id}->${target.id}`],
        notes,
      });
    },
  };
}

/** 多巴胺内页取色的 seed。书状态里没有 albumId 时回落封面首图 photoId —— 只要
 *  对同一本书稳定即可（前缀稳定性靠 interiorInkSequence 自身保证）。
 *  **导出**是为了让测试能算出期望序列，不必在测试里复刻一份取 seed 的逻辑。 */
export function bookSeed(state: AlbumBookState): string {
  const cover = state.pages[0];
  return Object.values(cover?.images ?? {})[0] ?? cover?.templateId ?? "yujee";
}
```

注册：`createAlbumTools` 数组里 `createSetPageBackgroundTool(options)` 之后加
`createApplyBookStyleTool(options),`。

**注意** `ROLE_TO_COLOR_KIND` 和 `slotBaseIdForTheme` 是 tools.ts 已有的（约 675-684 行、863 行），
直接用，不要重写一份。`NON_NUMBERED_PAGE_CATEGORIES` 从 `book-state.ts` 已 import。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/design-agent && npx tsx --test test/apply-book-style.test.ts`
Expected: 6 条全 PASS

- [ ] **Step 5: 跑 design-agent 全量，确认没弄坏别的工具**

Run: `cd packages/design-agent && pnpm test 2>&1 | tail -20`
Expected: 全绿。特别看 `album-tools.test.ts`、`album-contract-parity.test.ts`。

- [ ] **Step 6: Commit**

```bash
git add packages/design-agent
git commit -m "feat: apply_book_style 整本换风格"
```

---

## Task 7: `set_text_colors` 加对比度硬校验

**Files:**
- Modify: `packages/design-agent/src/core/album/tools.ts`（`createSetTextColorsTool`，约 686-766 行）
- Create: `packages/design-agent/test/text-colors-contrast.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `contrastRatio`/`meetsAA`、Task 4 的 `PAGE_BACKGROUND_CARRIER_KEY`
- Produces: 无新导出

**为什么：** 现在这个工具能把字刷成任意色。深底书上刷个深字就整页读不了，而且 AI 看不见
渲染结果，不会自己发现。

- [ ] **Step 1: 写失败的测试**

```ts
test('在深底页上刷深字被打回，报错说清哪几页、实测多少', async () => {
  const { tools, getBook } = createHarness();
  // 先把第 1 页刷成蓝底
  await tools.get('set_page_background')!.execute('c1', { pages: [1], colorId: 'ivory' } as never);
  const book = getBook();
  book.pages[1]!.texts['#pageBackground'] = '#2D6DB0'; // 深蓝底
  // 再刷深字
  await assert.rejects(
    () => tools.get('set_text_colors')!.execute('c2', { titleColor: '#1A1A14' } as never),
    (err: Error) => {
      assert.match(err.message, /对比度/);
      assert.match(err.message, /1\.\d\d|2\.\d\d|3\.\d\d/); // 报出实测值
      return true;
    },
  );
});

test('浅底页上刷深字正常通过', async () => {
  const { tools, getBook } = createHarness();
  await tools.get('set_text_colors')!.execute('c1', { titleColor: '#1C1B18' } as never);
  assert.equal(getBook().pages[1]!.texts['title#accentColor'], '#1C1B18');
});

test('没有页底色的页按纯白判定（模板默认 background:#fff）', async () => {
  const { tools } = createHarness();
  await assert.rejects(
    () => tools.get('set_text_colors')!.execute('c1', { bodyColor: '#F5F2E8' } as never), // 白底浅字
    /对比度/,
  );
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/design-agent && npx tsx --test test/text-colors-contrast.test.ts`
Expected: 第 1、3 条 FAIL（现在什么色都放行）

- [ ] **Step 3: 实现**

在 `createSetTextColorsTool` 的 `execute` 里，**十六进制格式校验之后、开始写 nextState 之前**插入：

```ts
// 对比度体检:文字色落在该页底色上必须 >= 4.5:1。AI 看不见渲染结果,不会自己发现
// 「深底刷深字」——这里不拦,用户拿到的就是一整页读不了的书(mag-62 上实测 1.3:1)。
const state0 = options.getBookState();
const failures: string[] = [];
for (const [index, page] of state0.pages.entries()) {
  const bg = page.texts[PAGE_BACKGROUND_CARRIER_KEY] ?? "#FFFFFF"; // 缺省=模板默认白底
  for (const [kind, color] of provided) {
    const ratio = contrastRatio(bg, color as string);
    if (!Number.isFinite(ratio) || ratio >= 4.5) continue;
    failures.push(
      `${pageLabelOf(options, state0, index + 1)}底色 ${bg} 配 ${kind} 色 ${color} 只有 ${ratio.toFixed(2)}:1`,
    );
  }
}
if (failures.length > 0) {
  const shown = failures.slice(0, 3).join("；");
  throw new Error(
    `对比度不够（要 4.5:1 以上）：${shown}${failures.length > 3 ? ` 等 ${failures.length} 处` : ""}。` +
      `深底配浅字 ${THIRD_SET_INK.light}、浅底配深字 ${THIRD_SET_INK.dark}；要整本换气质用 apply_book_style。`,
  );
}
```

import 补 `contrastRatio`、`THIRD_SET_INK`。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/design-agent && npx tsx --test test/text-colors-contrast.test.ts`
Expected: 3 条全 PASS

- [ ] **Step 5: 跑全量确认没打断既有用例**

Run: `cd packages/design-agent && pnpm test 2>&1 | tail -20`
Expected: 全绿。**若 `album-skills-theme.test.ts` 之类因为用了低对比色而变红，改测试用例的颜色，
不要放宽 4.5 这个门槛。**

- [ ] **Step 6: Commit**

```bash
git add packages/design-agent
git commit -m "feat: set_text_colors 加对比度硬校验"
```

---

## Task 8: `swap_page_template` 换深底模板时自动翻字色

**Files:**
- Modify: `packages/design-agent/src/core/album/tools.ts`（`createSwapPageTemplateTool`，约 567-620 行）
- Create: `packages/design-agent/test/swap-template-dark-ink.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `bestInkFor`、Task 4 的 `PAGE_BACKGROUND_CARRIER_KEY`
- Produces: 无新导出

**这修的是 `design-apply.ts:249-256` 注释点名、至今没修的坑：** Agent 能把浅底书的封面换成
mag-62，carrier 仍是 `#1c1b18` 落在 `#12363A` 上约 1.3:1，读不了。p01 同病。

- [ ] **Step 1: 核对模板自带底色（值已实测，跑一遍确认没漂）**

```bash
cd packages/contracts/src/render/html-templates
for t in mag-62 mag-63 p01; do echo "== $t"; grep -o "data-template=\"$t\"[^>]*" $t.ts | head -1; done
```

Expected（2026-08-29 实测）：mag-62 和 mag-63 都是 `background:#12363A`，p01 是 `background:#1c1b18`。
对不上就以实测为准改 Step 4 的常量表，别用计划里的值。

- [ ] **Step 2: 写失败的测试**

```ts
test('封面换成 mag-62（深底）后，文字 carrier 翻成浅字', async () => {
  const { tools, getBook } = createHarness(); // 封面 mag-01，字色 #1c1b18
  await tools.get('swap_page_template')!.execute('c1', { pageNo: 'cover', templateId: 'mag-62' } as never);
  const cover = getBook().pages[0]!;
  for (const [key, value] of Object.entries(cover.texts)) {
    if (!key.endsWith('#accentColor')) continue;
    assert.equal(value, '#F5F2E8', `${key} 没翻成浅字`);
  }
});

test('从深底模板换回浅底模板时字色翻回深字', async () => {
  const { tools, getBook } = createHarness();
  await tools.get('swap_page_template')!.execute('c1', { pageNo: 'cover', templateId: 'mag-62' } as never);
  await tools.get('swap_page_template')!.execute('c2', { pageNo: 'cover', templateId: 'mag-01' } as never);
  const cover = getBook().pages[0]!;
  const accents = Object.entries(cover.texts).filter(([k]) => k.endsWith('#accentColor'));
  assert.ok(accents.length > 0, '应该有 carrier 键');
  for (const [key, value] of accents) assert.equal(value, '#1A1A14', `${key} 没翻回深字`);
});

test('页面已有 #pageBackground 时以它为准，不看模板自带底色', async () => {
  const { tools, getBook } = createHarness();
  const book = getBook();
  book.pages[1]!.texts['#pageBackground'] = '#F3F0A8'; // 浅黄
  await tools.get('swap_page_template')!.execute('c1', { pageNo: 1, templateId: 'mag-13' } as never);
  const page = getBook().pages[1]!;
  const accent = Object.entries(page.texts).find(([k]) => k.endsWith('#accentColor'))?.[1];
  assert.equal(accent, '#1A1A14', '浅黄底应该配深字');
});

test('浅底换浅底时字色不动（不引入无谓改动）', async () => {
  const { tools, getBook } = createHarness();
  const before = { ...getBook().pages[1]!.texts };
  await tools.get('swap_page_template')!.execute('c1', { pageNo: 1, templateId: 'mag-13' } as never);
  const after = getBook().pages[1]!.texts;
  for (const [k, v] of Object.entries(before)) {
    if (k.endsWith('#accentColor')) assert.equal(after[k], v, `${k} 不该变`);
  }
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `cd packages/design-agent && npx tsx --test test/swap-template-dark-ink.test.ts`
Expected: 前两条 FAIL

- [ ] **Step 4: 实现**

在 tools.ts 里加常量和辅助（用 Step 1 查到的真实色值）：

```ts
/**
 * 模板自带的深色页底。换到这些模板上，文字 carrier 必须跟着翻成浅字 ——
 * 不翻的话 mag-62 上是 #1c1b18 配 #12363A，约 1.3:1，整页读不了
 * (design-apply.ts:249 那条注释点名至今没修的坑)。
 * 值取自 render/html-templates/<id>.ts 的页根 style，改模板底色要同步改这里。
 */
const TEMPLATE_OWN_BACKGROUND: Record<string, string> = {
  "mag-62": "#12363A",
  "mag-63": "#12363A",
  "p01": "#1C1B18",
};

/** 一页的实际底色：页级 carrier 优先，其次模板自带深底，最后模板默认白。 */
function effectivePageBackground(page: AlbumPage): string {
  return page.texts[PAGE_BACKGROUND_CARRIER_KEY] ?? TEMPLATE_OWN_BACKGROUND[page.templateId] ?? "#FFFFFF";
}
```

在 `createSwapPageTemplateTool` 的 `execute` 里，`migratePageToTemplate` 之后、重烘 html 之前插入：

```ts
// 换模板可能换掉了页底色（深底模板自带深底）——字色必须跟着翻，否则留下读不了的页。
const beforeInk = bestInkFor(effectivePageBackground(page));
const afterInk = bestInkFor(effectivePageBackground(nextPage));
if (beforeInk !== afterInk) {
  const nextTemplateEntry = requireTemplate(options.catalog, nextPage.templateId);
  for (const slotId of collectThemeableSlots(nextPage, nextTemplateEntry)) {
    nextPage.texts[`${slotId}#accentColor`] = afterInk;
  }
  notes.push(`底色明暗变了，文字色跟着翻成${afterInk === THIRD_SET_INK.light ? "浅字" : "深字"}`);
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd packages/design-agent && npx tsx --test test/swap-template-dark-ink.test.ts`
Expected: 4 条全 PASS

- [ ] **Step 6: 跑 mutation 验证守卫真会红**

把 `if (beforeInk !== afterInk)` 临时改成 `if (false)`，重跑。
Expected: 前两条 FAIL。确认后**改回来**。

- [ ] **Step 7: 全量 + Commit**

```bash
cd packages/design-agent && pnpm test 2>&1 | tail -20
git add packages/design-agent
git commit -m "fix: 换到深底模板时文字色自动翻转（修 1.3:1 读不了）"
```

---

## Task 9: 风格理解技能 + prompt 分流 + 简报带风格（本次核心）

**Files:**
- Create: `packages/contracts/skills/album-style/SKILL.md`
- Modify: `packages/contracts/skills/album-color/SKILL.md`
- Modify: `packages/design-agent/src/core/album/skills.ts`（内置默认技能要同步加一份）
- Modify: `packages/design-agent/src/core/album/system-prompt.ts`
- Modify: `packages/design-agent/src/web/album-server.ts`（`composeChatTurn`）
- Modify: `packages/design-agent/test/album-skills-theme.test.ts`（「五个技能」→ 六个）
- Create: `packages/design-agent/test/album-style-skill.test.ts`

**Interfaces:**
- Consumes: Task 3 的 `bookStyleOf`/`BOOK_STYLES`
- Produces: `composeChatTurn(message, currentPageIndex, brief?, currentPageLabel?, styleName?)`

**这是本次改动的中心。** 工具是手，skill 是脑。用户对整本观感不满时的入口。
没有这个 skill，用户说「太素了」会被 system-prompt 那条「模糊的审美反馈直接动手换模板」
导向随机换一个单页模板。

- [ ] **Step 1: 写失败的测试**

`packages/design-agent/test/album-style-skill.test.ts`：

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { BOOK_STYLES } from '@yujee/contracts/design';
import { loadAlbumSkills } from '../src/core/album/skills-loader.ts';
import { createDefaultAlbumSkills } from '../src/core/album/skills.ts';
import { composeChatTurn } from '../src/web/album-server.ts';
import { buildAlbumSystemPrompt } from '../src/core/album/system-prompt.ts';

/** 源码/文档正则断言前必须剥注释和代码块，否则注释里出现关键词就能把断言喂饱。 */
function stripFences(md: string): string {
  return md.replace(/```[\s\S]*?```/g, '');
}

test('风格理解技能被加载，且四个风格的名字都在里面', () => {
  const skill = loadAlbumSkills().find((s) => s.name === '风格理解');
  assert.ok(skill, '风格理解技能必须能加载');
  const body = stripFences(skill!.content);
  for (const style of BOOK_STYLES) {
    assert.ok(body.includes(style.name), `技能里缺「${style.name}」`);
    assert.ok(body.includes(style.id), `技能里缺 id ${style.id}`);
  }
});

test('技能给出形容词到风格的映射，覆盖两个方向的词', () => {
  const body = stripFences(loadAlbumSkills().find((s) => s.name === '风格理解')!.content);
  for (const word of ['太素', '太花', '文艺', '活泼', '像杂志', '旅行']) {
    assert.ok(body.includes(word), `映射表里缺「${word}」`);
  }
});

test('技能指向两个新工具，并写明换风格的代价', () => {
  const body = stripFences(loadAlbumSkills().find((s) => s.name === '风格理解')!.content);
  assert.ok(body.includes('apply_book_style'));
  assert.ok(body.includes('set_page_background'));
  assert.ok(body.includes('封面文案'), '必须写明换风格会重排封面文案');
});

test('技能写了反例：单页不满意不要整本换风格', () => {
  const body = stripFences(loadAlbumSkills().find((s) => s.name === '风格理解')!.content);
  assert.match(body, /不要整本换风格|不是风格问题/);
});

test('内置默认技能与文件化技能同名（skills 目录缺失时的兜底不能少这一个）', () => {
  assert.ok(createDefaultAlbumSkills().some((s) => s.name === '风格理解'));
});

test('书级简报带出当前风格名', () => {
  const turn = composeChatTurn('这本书太素了', undefined, undefined, undefined, '素白散文');
  assert.match(turn, /当前风格[:：]素白散文/);
  assert.ok(turn.includes('这本书太素了'));
});

test('没有风格名时简报不多出空行（老调用零影响）', () => {
  assert.equal(composeChatTurn('你好', undefined), '你好');
});

test('system prompt 把风格级不满分流到风格理解技能', () => {
  // 照抄 album-system-prompt.test.ts 的 promptOf()
  const prompt = buildAlbumSystemPrompt({
    activeTools: [],
    resources: { skills: [], promptTemplates: [] },
  } as never);
  assert.match(prompt, /风格理解/);
  assert.match(prompt, /整本/);
  // 单页那条不能被顺手删掉 —— 它管的是另一半场景
  assert.match(prompt, /这页不好看/);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/design-agent && npx tsx --test test/album-style-skill.test.ts`
Expected: 全 FAIL

- [ ] **Step 3: 写技能文件**

`packages/contracts/skills/album-style/SKILL.md`：

```markdown
---
name: 风格理解
description: 用户对整本书的观感不满或提出气质诉求时使用——「太素/太花/不够活泼/想文艺点/换个感觉/这本书不好看」，或直接点名风格。
---

# 风格理解

用户对**整本书**的观感说了什么，先用这个技能判断他要的是哪个风格，再动手。

## 四个风格

| id | 名字 | 气质 | 页底 |
|---|---|---|---|
| `editorial` | 素白散文 | 暖白纸配墨黑字，留白最多，长段落最好读 | 暖白 |
| `magazine` | 杂志刊头 | 冷灰底配纯黑字，硬朗、信息密度高，像一本作品集 | 冷灰 |
| `dopamine` | 多巴胺 | 整页满版彩色底，一页一个颜色，最跳最年轻 | 五色随机 |
| `postcard` | 旅行画报 | 暖砂底配陶土橙图注，胶片明信片感，适合旅途和老照片 | 暖砂 |

## 用户这么说 → 指向哪个风格

| 用户可能说 | 指向 |
|---|---|
| 太素 / 太白 / 太空 / 太单调 / 不够活泼 | 多巴胺 |
| 太花 / 太吵 / 太跳 / 太闹 / 颜色太多 | 素白散文 或 杂志刊头 |
| 文艺 / 安静 / 书卷气 / 像散文集 / 想多点留白 | 素白散文 |
| 高级 / 干净 / 利落 / 像杂志 / 有设计感 / 硬朗 | 杂志刊头 |
| 温暖 / 旅行 / 复古 / 胶片 / 有故事感 | 旅行画报 |
| 年轻 / 有活力 / 鲜艳 / 多巴胺 / 想跳一点 | 多巴胺 |

拿不准落哪个时，选与用户措辞最贴的那个直接换，改完请用户看效果，不满意再换下一个 ——
不要反问「你想要哪种风格」。

## 判断流程

1. **先看这本书现在是什么风格**。每轮消息前缀的【设计简报】里有「当前风格」。
   不知道现状就无从调整。
2. 把用户的话落到上面的映射表。**当前风格已经是目标风格时不要空转换一遍** ——
   改走局部调整（换个底色 / 只调字色），或直接告诉用户现在就是他要的那种。
3. 定作用范围：
   - 整本气质不对 → `apply_book_style`
   - 只有某几页颜色不对 → `set_page_background`
   - 只有字的颜色不对 → `set_text_colors`
4. 改完一句话说明变化，请用户看效果。

## 换风格的代价，动手前先说

`apply_book_style` 会换掉封面和封底的版式，**封面文案按新版式重排，迁不过去的槽会清空**。
换之前先用一句话告诉用户，别改完了才说。工具返回的 notes 里会列出实际丢了什么，
照着补写或问用户。

## 底色只能从调色板里挑

`set_page_background` 的 colorId 必须是当前风格调色板里的值 —— 多巴胺是五个色
（butter / violet / orange / green / blue），其余风格是该风格底色加四个白系
（white / ivory / mist / ash）。传错工具会打回并列出可选值。

不要自己编十六进制色值：超出四色印刷色域的颜色印不出来，对比度也会失守。

底色改了字色会自动跟着翻（深底浅字、浅底深字），不用再单独调一次字色。

## 反例

- 用户说「**这页**颜色不好看」→ 只调这一页，**不要整本换风格**。
- 用户说「这页版面太乱」→ 换单页模板，走「相册排版」技能，**不是风格问题**。
- 用户只说「换个字体」→ 走「相册字体」技能，风格不动。
- 不要为了用满四个风格硬推荐；当前风格合适就说合适。
```

- [ ] **Step 4: 内置默认技能同步加一份**

`packages/design-agent/src/core/album/skills.ts` 的 `createDefaultAlbumSkills()` 数组里追加一项。
`filePath` 写 `/virtual/design-agent/skills/album-style/SKILL.md`，`name` 和 `description` 与
markdown 的 frontmatter 逐字一致，`content` 用 Step 3 正文的精简版（保留四风格表、映射表、
三个工具名、封面文案代价、反例四条 —— 测试断言的都在这些里）。

- [ ] **Step 5: album-color 技能补一句**

`packages/contracts/skills/album-color/SKILL.md` 的「颜色搭配技巧」小节开头插入：

```markdown
- **先看当前风格**：颜色从当前风格的调色板里挑，别自由发挥十六进制。整本气质不对是
  风格问题，走「风格理解」技能用 `apply_book_style`，不要用文字配色去凑。
- 文字色落在该页底色上必须有 4.5:1 以上对比度，工具会实测并打回不达标的色。
```

- [ ] **Step 6: system prompt 加分流**

`system-prompt.ts` 的「工作流程」里，把这一行：

```
"- 模糊的审美反馈（「这页不好看」「太乱了」「换个感觉」）不要追问哪里不好，直接动手：版面不满意就换一个同类目、放得下当前照片数的新模板；点名字体/颜色就直接换。改完一句话说明变化，请用户看效果，不满意再换下一个。",
```

替换成两行：

```ts
"- 模糊的审美反馈**针对某一页**（「这页不好看」「这页太乱了」）不要追问哪里不好，直接动手：版面不满意就换一个同类目、放得下当前照片数的新模板；点名字体/颜色就直接换。改完一句话说明变化，请用户看效果，不满意再换下一个。",
"- 模糊的审美反馈**针对整本**（「这本书太素了」「不够活泼」「换个感觉」「想文艺一点」）是风格问题：先读「风格理解」技能判断用户要哪个风格，再用 apply_book_style 整本换，不要逐页换模板去凑。",
```

- [ ] **Step 7: 简报带上当前风格**

`album-server.ts` 的 `composeChatTurn` 加第五个可选参数 `styleName?: string`，在 briefBits
最前面加一项（**参数放最后、可选，老调用零影响**）：

```ts
if (styleName) briefBits.push(`当前风格:${styleName}`);
```

注意现在的守卫是 `if (brief && (brief.theme || ...))` —— 只有 styleName 没有 brief 时也要能出，
改成：

```ts
const briefBits: string[] = [];
if (styleName) briefBits.push(`当前风格:${styleName}`);
if (brief?.theme) briefBits.push(`主题:${brief.theme}`);
// …其余不变…
if (briefBits.length > 0) parts.push(`【设计简报】${briefBits.join(";")}`);
```

调用点（约 456 行）改成传入风格名：

```ts
composeChatTurn(
  message,
  currentPageIndex,
  runtime.getBook().brief,
  currentPageLabel,
  bookStyleOf(
    runtime.getBook().pages.find((p) => catalog.get(p.templateId)?.category === "cover")?.templateId,
  ).name,
),
```

- [ ] **Step 8: 改「五个技能」那条断言**

`packages/design-agent/test/album-skills-theme.test.ts` 第 32 行左右：

```ts
assert.deepEqual(names, ["页面HTML编辑", "相册字体", "相册排版", "相册文案", "相册配色", "风格理解"].sort());
```

- [ ] **Step 9: 跑测试确认通过**

Run: `cd packages/design-agent && npx tsx --test test/album-style-skill.test.ts`
Expected: 8 条全 PASS

- [ ] **Step 10: 跑 mutation 验证正则守卫真会红**

把 SKILL.md 里的「太素」临时改成「太朴素」，重跑。
Expected: 「映射表里缺「太素」」FAIL。确认后**改回来**。
（源码/文档正则断言最容易被注释和近义词喂饱，必须验一次。）

- [ ] **Step 11: 全量 + Commit**

```bash
cd packages/design-agent && pnpm test 2>&1 | tail -20
git add packages/contracts/skills packages/design-agent
git commit -m "feat: 风格理解技能，模糊审美反馈按整本/单页分流"
```

---

## Task 10: web 侧写 carrier + 配色稿生成器 + 清理

**Files:**
- Modify: `apps/web/src/services/album/design-apply.ts`
- Create: `apps/web/scripts/render-style-preview.mts`
- Delete: `apps/web/render-covers.mts`, `apps/web/render-styles.mts`

**Interfaces:**
- Consumes: Task 4 的 `PAGE_BACKGROUND_CARRIER_KEY`、Task 3 的 `BOOK_STYLES`
- Produces: 无新导出

**为什么要在 web 侧也写 carrier：** `applyDesign` 现在只写 inline 背景色。Agent 之后一旦
`set_text_colors` 重烘那一页，成书时选的底色就丢了。两边都写 carrier，重烘才拿得回来。

- [ ] **Step 1: 写失败的测试**

在 `apps/web/src/services/album/design-apply.test.ts` 追加：

入口是 `assembleDesignedPages` —— 该文件第 175 行和 195 行已经有两条页底色测试
（「刷进每页页根 background-color」/「纯白不写 inline」），**照它们的入参建法复制**，
只把断言换成 carrier：

```ts
test('assembleDesignedPages: 页底色同时写进 #pageBackground carrier（重烘才拿得回来）', () => {
  // 入参照第 175 行那条测试复制，pageBackground 传 '#FBF8F1'
  const pages = assembleDesignedPages({ /* 同第 175 行 */ });
  for (const page of pages) {
    assert.equal(page.texts['#pageBackground'], '#FBF8F1', '缺 carrier：Agent 重烘这页时底色就丢了');
    assert.ok(page.html!.includes('background-color:#FBF8F1'), 'inline 那条老路也要照旧');
  }
});

test('assembleDesignedPages: 纯白仍视为无底色，carrier 和 inline 都不写（对老书纯叠加）', () => {
  // 入参照第 195 行那条测试复制
  const pages = assembleDesignedPages({ /* 同第 195 行 */ });
  for (const page of pages) assert.equal(page.texts['#pageBackground'], undefined);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/web && npx tsx --test src/services/album/design-apply.test.ts`
Expected: 新增第 1 条 FAIL（carrier 还没写），第 2 条 PASS（现在本来就不写）

- [ ] **Step 3: 实现**

`design-apply.ts` 里凡是调 `patchHtmlPageStyle(html, { 'background-color': hex })` 写页底色的地方，
同一处补写 `page.texts[PAGE_BACKGROUND_CARRIER_KEY] = hex`。
`isDefaultPageBackground(hex)` 为真（纯白）时两者都不写 —— 保持「纯白 = 模板默认 = 不写 inline bg」
这条既有约定，对老书纯叠加。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/web && pnpm test 2>&1 | tail -20`
Expected: 全绿

- [ ] **Step 5: 配色稿生成器收进 scripts**

把出稿脚本移到 `apps/web/scripts/render-style-preview.mts`，改成从 `BOOK_STYLES` 读风格
（不要再硬写一份色值 —— 那就成了第二份真相源），删掉临时脚本：

```bash
cd /Users/smalldog/Desktop/yujee工程文件/memoir-agent-rebuild
git rm -f apps/web/render-covers.mts 2>/dev/null || rm -f apps/web/render-covers.mts
rm -f apps/web/render-styles.mts
```

脚本头部注释写明用途和跑法：

```ts
// 四风格配色稿生成器：改 BOOK_STYLES 的色值后跑一次，出一张自包含 HTML 给人眼验收。
// 照片用内联 SVG 渐变占位（断网可看）。风格定义只从 @yujee/contracts/design 读，
// 不在这里硬写色值 —— 硬写就成了第二份真相源。
// 跑法：cd apps/web && npx tsx scripts/render-style-preview.mts ~/Desktop/Agent四风格配色稿.html
```

- [ ] **Step 6: 出一张稿人眼验收**

Run: `cd apps/web && npx tsx scripts/render-style-preview.mts ~/Desktop/Agent四风格配色稿.html`
Expected: 桌面生成 HTML。双击打开，逐行确认：四个底色能分出来、多巴胺内页每页颜色不同、
每张页面上的字都读得清。**这一步不能省 —— 对比度测试只保证数值达标，读起来舒不舒服要人看。**

- [ ] **Step 7: 三个包全量测试 + typecheck**

```bash
cd packages/contracts && pnpm test && pnpm typecheck
cd ../design-agent && pnpm test
cd ../../apps/web && pnpm test && pnpm typecheck
```
Expected: 全绿。任何一条红都不许进 commit。

- [ ] **Step 8: Commit**

```bash
git add -A apps/web
git commit -m "feat: 成书时写页底色 carrier；配色稿生成器收进 scripts"
```

---

## 收尾

全部任务做完后：

1. **派 review agent 评审整个 diff**（`git diff main...` 或按用户的分支口径），
   评审发现的问题逐项修复并验证，全部通过才算完成。
2. 用 `superpowers:verification-before-completion` 核对：三个包的测试和 typecheck 都实际跑过、
   输出贴出来，不许凭印象说「应该没问题」。
3. 人工验收路径（本地起 web，端口只能用 3000 或 3210，换端口浏览器登录会 403）：
   开一本书 → 对 Agent 说「这本书太素了」→ 确认它读了风格理解技能、换成多巴胺、
   页面真的变彩色且字读得清 → 再说「太花了」→ 确认它换回素白散文。
