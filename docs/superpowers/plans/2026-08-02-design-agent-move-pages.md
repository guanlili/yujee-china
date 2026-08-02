# 设计 Agent 挪页工具 move_pages 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给设计 Agent 增加第七个写工具 `move_pages`：一次调用内批量 move/swap 重排页序,单纯挪位置,不改任何页内容。

**Architecture:** 三层:纯模块 `page-move.ts`(身份锚定的重排+校验,零依赖直测)→ `tools.ts` 里的 `move_pages` 工具(用户口径解析、结果反馈、commitWrite)→ web 同步点(DESIGN_WRITE_TOOLS / chat-history 类别 / 两端展示词)。技能与文档同步收尾。

**Tech Stack:** TypeScript + typebox(design-agent 既有),node:test(`tsx --test`),web 侧 node:test(`cd apps/web && pnpm test`)。

**Spec:** `docs/specs/2026-08-02-design-agent-move-pages-design.md`

## Global Constraints

- 页序真相 = pages 数组顺序;寻址一律用户口径(内页数字 1..M / `cover`/`toc`/`ending`),经 `resolvePageUserRef` 解析,**所有引用(含锚点)按调用前页序解析**。
- 锚定通则:应用完成后**任何非内页记录的数组下标不许变**。
- 净效果必须是同一批页对象的排列;恒等置换报错拒绝。
- 页对象原样搬运:texts/images/html/pageIndex 一字不改;只 `version+1` + `updatedAt`(commitWrite 既有契约)。
- 工作树里有两笔**既有**改动,不得混入功能提交(Task 0 先各自落地)。
- 当前分支 `feat/collab-editing`,直接继续,不新开分支。
- 提交信息结尾带 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。
- design-agent 测试:`pnpm --filter @smalldog/design-agent test`;web 测试:`cd apps/web && pnpm test`;收尾跑仓根 `pnpm typecheck`(含 docs:check,盯 checked-at)。

---

### Task 0: 清点工作树 —— 既有改动各自成提交

**Files:**
- Commit: `packages/contracts/skills/album-page-html/SKILL.md`(新增,本会话早前的技能加载修复)
- Commit: `packages/design-agent/test/album-skills-theme.test.ts`(同上,守卫测试)
- Commit: `packages/design-agent/src/core/album/tools.ts`(用户在编辑器里改的 `update_page_images` 描述精简,单独一笔)

- [ ] **Step 1: 确认现状**

Run: `git status --short && git diff --stat`
Expected: 恰好上述三个文件;tools.ts 的 diff 只有 update_page_images 描述一个 hunk。若出现计划外改动,停下来问用户。

- [ ] **Step 2: 提交技能修复**

```bash
git add packages/contracts/skills/album-page-html packages/design-agent/test/album-skills-theme.test.ts
git commit -m "fix(design-agent): 页面HTML编辑技能补文件版,兜底技能名守卫测试

M4 把「页面HTML编辑」只写进了代码兜底 createDefaultAlbumSkills,
contracts/skills/ 没有对应目录;文件目录非空时 loader 全用文件版,
生产环境永远加载不到这条技能。补 SKILL.md,并加守卫测试:
内置兜底的每个技能名必须在 skills/ 目录有对应文件。

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 3: 提交描述精简(用户工作树既有改动)**

```bash
git add packages/design-agent/src/core/album/tools.ts
git commit -m "docs(design-agent): update_page_images 描述精简(落地工作树既有改动)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 4: 确认工作树干净**

Run: `git status --short`
Expected: 空输出。

### Task 1: 纯模块 page-move.ts(TDD)

**Files:**
- Create: `packages/design-agent/src/core/album/page-move.ts`
- Test: `packages/design-agent/test/album-page-move.test.ts`

**Interfaces:**
- Consumes: `AlbumPage`(`./book-state.ts`,只当不透明对象搬运)
- Produces:
  ```ts
  export type PageMoveOperation =
    | { type: "move"; page: number; before?: number; after?: number } // 内部 1 基位置(调用前页序)
    | { type: "swap"; a: number; b: number };
  export function applyPageMoves(
    pages: readonly AlbumPage[],
    isInterior: (page: AlbumPage) => boolean,
    operations: readonly PageMoveOperation[],
    labelOf: (originalNo: number) => string, // 报错时把内部位次说成用户称呼
  ): AlbumPage[]; // 新数组,元素为原对象引用;违规抛 Error(中文)
  ```

- [ ] **Step 1: 写失败测试**

`album-page-move.test.ts`,用假页对象(templateId 区分类目)直测纯函数:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import type { AlbumPage } from "../src/core/album/book-state.ts";
import { applyPageMoves, type PageMoveOperation } from "../src/core/album/page-move.ts";

// 6 页假书:cover + 内页A..D + ending。对象身份即页身份。
function makeBook(): AlbumPage[] {
	return ["cover", "A", "B", "C", "D", "ending"].map((id, i) => ({
		pageIndex: i,
		templateId: id,
		images: {},
		texts: { name: id },
	}));
}
const isInterior = (p: AlbumPage) => p.templateId !== "cover" && p.templateId !== "ending";
const labelOf = (no: number) => `第${no}位`;
const names = (pages: AlbumPage[]) => pages.map((p) => p.templateId).join(",");
const apply = (pages: AlbumPage[], ops: PageMoveOperation[]) =>
	applyPageMoves(pages, isInterior, ops, labelOf);

test("move after:把 D 挪到 A 后面", () => {
	const book = makeBook();
	const out = apply(book, [{ type: "move", page: 5, after: 2 }]);
	assert.equal(names(out), "cover,A,D,B,C,ending");
	assert.equal(out[2], book[4], "必须是同一个对象,不是副本");
	assert.equal(names(book), "cover,A,B,C,D,ending", "输入数组不被改动");
});

test("move before:把 A 挪到 D 前面", () => {
	const out = apply(makeBook(), [{ type: "move", page: 2, before: 5 }]);
	assert.equal(names(out), "cover,B,C,A,D,ending");
});

test("锚点可以是封面/封尾:after 封面=挪到最前,before 封尾=挪到最后", () => {
	assert.equal(names(apply(makeBook(), [{ type: "move", page: 4, after: 1 }])), "cover,C,A,B,D,ending");
	assert.equal(names(apply(makeBook(), [{ type: "move", page: 2, before: 6 }])), "cover,B,C,D,A,ending");
});

test("swap:远距两页对调", () => {
	const out = apply(makeBook(), [{ type: "swap", a: 2, b: 5 }]);
	assert.equal(names(out), "cover,D,B,C,A,ending");
});

test("多步复合:引用全按调用前页序,锚点自己被挪过也不错位", () => {
	// 先把 A 挪到 D 后,再把 B 挪到 A(原第 2 位那页)后 —— 第二步的锚点 A 已经换过位置。
	const out = apply(makeBook(), [
		{ type: "move", page: 2, after: 5 },
		{ type: "move", page: 3, after: 2 },
	]);
	assert.equal(names(out), "cover,C,D,A,B,ending");
});

test("拒绝:封面/目录/封尾作源", () => {
	assert.throws(() => apply(makeBook(), [{ type: "move", page: 1, after: 3 }]), /只能挪内页/);
	assert.throws(() => apply(makeBook(), [{ type: "swap", a: 6, b: 2 }]), /只能挪内页/);
});

test("拒绝:锚定页被平移(before 封面)", () => {
	assert.throws(() => apply(makeBook(), [{ type: "move", page: 3, before: 1 }]), /封面|封尾|目录|位置不能/);
});

test("拒绝:swap 两页相同 / move 锚点是自己 / before-after 同给或都不给", () => {
	assert.throws(() => apply(makeBook(), [{ type: "swap", a: 3, b: 3 }]), /不能相同/);
	assert.throws(() => apply(makeBook(), [{ type: "move", page: 3, after: 3 }]), /自己/);
	assert.throws(() => apply(makeBook(), [{ type: "move", page: 3, before: 2, after: 4 }]), /恰好/);
	assert.throws(() => apply(makeBook(), [{ type: "move", page: 3 }]), /恰好/);
});

test("拒绝:恒等净效果(挪了又挪回去)", () => {
	assert.throws(
		() => apply(makeBook(), [{ type: "swap", a: 2, b: 3 }, { type: "swap", a: 2, b: 3 }]),
		/没有改变页序/,
	);
});

test("拒绝:位置越界/空操作数组", () => {
	assert.throws(() => apply(makeBook(), [{ type: "move", page: 99, after: 2 }]), /不存在/);
	assert.throws(() => apply(makeBook(), []), /至少/);
});

test("不变量:任何合法结果都是同一批对象的排列", () => {
	const book = makeBook();
	const out = apply(book, [{ type: "move", page: 5, after: 2 }, { type: "swap", a: 3, b: 4 }]);
	assert.deepEqual(new Set(out), new Set(book));
	assert.equal(out.length, book.length);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/design-agent && npx tsx --test test/album-page-move.test.ts`
Expected: FAIL,`page-move.ts` 模块不存在。

- [ ] **Step 3: 最小实现**

`src/core/album/page-move.ts`:

```ts
import type { AlbumPage } from "./book-state.ts";

/** 页序操作(内部 1 基位置,全部按调用前页序解析;寻址解析在工具层)。 */
export type PageMoveOperation =
	| { type: "move"; page: number; before?: number; after?: number }
	| { type: "swap"; a: number; b: number };

/**
 * 身份锚定的页序重排:先把所有位置引用绑定到页对象,再逐条应用,
 * 前面的操作挪动了锚点页也不会错位。违规抛中文 Error,调用方零写入。
 */
export function applyPageMoves(
	pages: readonly AlbumPage[],
	isInterior: (page: AlbumPage) => boolean,
	operations: readonly PageMoveOperation[],
	labelOf: (originalNo: number) => string,
): AlbumPage[] {
	if (operations.length === 0) throw new Error("operations 至少要有一项");
	const byOriginal = (no: number): AlbumPage => {
		if (!Number.isInteger(no) || no < 1 || no > pages.length) throw new Error(`页 ${no} 不存在`);
		return pages[no - 1];
	};
	const requireInterior = (no: number): AlbumPage => {
		const page = byOriginal(no);
		if (!isInterior(page)) throw new Error(`${labelOf(no)}是封面/目录/封尾,只能挪内页`);
		return page;
	};

	const working = [...pages];
	for (const op of operations) {
		if (op.type === "swap") {
			if (op.a === op.b) throw new Error("swap 的两页不能相同");
			const a = requireInterior(op.a);
			const b = requireInterior(op.b);
			const ia = working.indexOf(a);
			const ib = working.indexOf(b);
			[working[ia], working[ib]] = [working[ib], working[ia]];
			continue;
		}
		if ((op.before === undefined) === (op.after === undefined))
			throw new Error("move 的 before/after 必须恰好给一个");
		const anchorNo = op.before ?? op.after!;
		if (anchorNo === op.page) throw new Error("move 的锚点不能是自己");
		const source = requireInterior(op.page);
		const anchor = byOriginal(anchorNo);
		working.splice(working.indexOf(source), 1);
		const at = working.indexOf(anchor) + (op.after !== undefined ? 1 : 0);
		working.splice(at, 0, source);
	}

	// 锚定通则:任何非内页记录的下标不许变(哪怕它意外出现在书中间)。
	pages.forEach((page, index) => {
		if (!isInterior(page) && working[index] !== page)
			throw new Error(`${labelOf(index + 1)}的位置不能被改变(封面/目录/封尾钉死)`);
	});
	if (working.every((page, index) => page === pages[index]))
		throw new Error("这些操作的净效果没有改变页序");
	return working;
}
```

- [ ] **Step 4: 跑测试确认全绿**

Run: `cd packages/design-agent && npx tsx --test test/album-page-move.test.ts`
Expected: PASS 全部。

- [ ] **Step 5: Commit**

```bash
git add packages/design-agent/src/core/album/page-move.ts packages/design-agent/test/album-page-move.test.ts
git commit -m "feat(design-agent): 页序重排纯模块 —— 身份锚定 move/swap + 锚定页钉死

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 2: move_pages 工具接线(TDD)

**Files:**
- Modify: `packages/design-agent/src/core/album/tools.ts`(新 schema、新 createMovePagesTool、注册进 createAlbumTools)
- Test: `packages/design-agent/test/album-move-pages-tool.test.ts`

**Interfaces:**
- Consumes: `applyPageMoves` / `PageMoveOperation`(Task 1);既有 `PageRefSchema`、`resolveRefToInternal`、`pageLabelOf`、`pageRefRangeText`、`commitWrite`、`cloneAlbumBookState`、`pageUserRefs`、`formatPageUserRef`、`catalogCategoryOf`。
- Produces: 工具名 `move_pages`,label `挪动页面`;`AgentToolResult<AlbumWriteDetails>`,details.pageNo = 第一个源页内部位次。fixture 书页序 = 封面, 内页1(mag-05), 内页2(mag-10), 内页3(mag-05), 内页4(mag-30), 封尾。

- [ ] **Step 1: 写失败测试**

`album-move-pages-tool.test.ts`,harness 套路照抄 `album-skills-theme.test.ts` 顶部(loadTemplateCatalog + fixture + createAlbumTools):

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Page } from "@yujee/contracts";
import {
	type AlbumBookState,
	cloneAlbumBookState,
	parseAlbumBookInput,
} from "../src/core/album/book-state.ts";
import { loadTemplateCatalog } from "../src/core/album/templates-catalog.ts";
import { type AlbumToolsOptions, createAlbumTools } from "../src/core/album/tools.ts";

const fixturePath = fileURLToPath(new URL("../fixtures/sample-book.json", import.meta.url));

function createHarness() {
	const catalog = loadTemplateCatalog();
	let book: AlbumBookState = parseAlbumBookInput(JSON.parse(readFileSync(fixturePath, "utf8"))).book;
	const options: AlbumToolsOptions = {
		catalog,
		getBookState: () => cloneAlbumBookState(book),
		setBookState: (next) => {
			book = cloneAlbumBookState(next);
		},
	};
	const tools = new Map(createAlbumTools(options).map((tool) => [tool.name, tool]));
	return { tools, getBook: () => book };
}

function templateOrder(book: AlbumBookState): string {
	return book.pages.map((p) => p.templateId).join(",");
}

test("move_pages:内页 4 挪到内页 1 后面,页内容逐字段不动,version+1", async () => {
	const { tools, getBook } = createHarness();
	const tool = tools.get("move_pages");
	assert.ok(tool, "move_pages 工具必须注册");
	const before = getBook();
	const beforeJson = new Map(before.pages.map((p) => [p.pageIndex, JSON.stringify(p)]));

	const args = tool.prepareArguments({ operations: [{ type: "move", pageNo: 4, after: 1 }] });
	const result = await tool.execute("t1", args as never);
	assert.equal(result.terminate, true);

	const after = getBook();
	assert.equal(templateOrder(after), "mag-01,mag-05,mag-30,mag-10,mag-05,mag-22");
	assert.equal(after.version, before.version + 1);
	// 单纯挪位置:每页序列化后与挪动前逐字节一致(按 pageIndex 对上)。
	for (const page of after.pages) {
		assert.equal(JSON.stringify(page), beforeJson.get(page.pageIndex));
	}
	for (const page of after.pages) assert.ok(Page.safeParse(page).success, "挪后仍过 contracts Page 契约");
});

test("move_pages:swap 两内页 + after:'cover' 挪到最前(批量一次调用)", async () => {
	const { tools, getBook } = createHarness();
	const tool = tools.get("move_pages")!;
	const args = tool.prepareArguments({
		operations: [
			{ type: "swap", a: 1, b: 2 },
			{ type: "move", pageNo: 4, after: "cover" },
		],
	});
	await tool.execute("t2", args as never);
	// 原序 内页[05,10,05,30] → swap(1,2)=[10,05,05,30] → move 原内页4(mag-30) 到最前=[30,10,05,05]
	assert.equal(templateOrder(getBook()), "mag-01,mag-30,mag-10,mag-05,mag-05,mag-22");
});

test("move_pages:结果 notes 报新旧页码映射", async () => {
	const { tools } = createHarness();
	const tool = tools.get("move_pages")!;
	const args = tool.prepareArguments({ operations: [{ type: "move", pageNo: 4, after: 1 }] });
	const result = await tool.execute("t3", args as never);
	const details = result.details as { operations: string[]; notes?: string[] };
	assert.ok(details.operations.length === 1);
	assert.ok(details.notes?.some((n) => n.includes("第 4 页") && n.includes("第 2 页")), "notes 要有 原第4页→现第2页");
});

test("move_pages:拒绝封面作源/拒绝恒等净效果/拒绝未知引用,拒绝时书不变", async () => {
	const { tools, getBook } = createHarness();
	const tool = tools.get("move_pages")!;
	const before = templateOrder(getBook());
	const cases = [
		{ operations: [{ type: "move", pageNo: "cover", after: 2 }] },
		{ operations: [{ type: "swap", a: 1, b: 2 }, { type: "swap", a: 1, b: 2 }] },
		{ operations: [{ type: "move", pageNo: 99, after: 1 }] },
	];
	for (const input of cases) {
		const args = tool.prepareArguments(input);
		await assert.rejects(() => tool.execute("t4", args as never));
		assert.equal(templateOrder(getBook()), before, "拒绝后页序不变");
	}
	assert.equal(getBook().version, 1, "拒绝不涨版本");
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/design-agent && npx tsx --test test/album-move-pages-tool.test.ts`
Expected: FAIL,`move_pages 工具必须注册` 断言不成立。

- [ ] **Step 3: 实现工具**

`tools.ts` 四处改动:

(a) import 补 `applyPageMoves, type PageMoveOperation`(from `./page-move.ts`)。

(b) schema 区(setTextFontsSchema 之后)加:

```ts
const movePagesSchema = Type.Object({
	operations: Type.Array(
		Type.Union([
			Type.Object({
				type: Type.Literal("move"),
				pageNo: PageRefSchema,
				before: Type.Optional(PageRefSchema),
				after: Type.Optional(PageRefSchema),
			}),
			Type.Object({
				type: Type.Literal("swap"),
				a: PageRefSchema,
				b: PageRefSchema,
			}),
		]),
		{
			minItems: 1,
			description:
				"按序应用的页序操作。move = 把 pageNo 摘出、插到锚点页前(before)/后(after),二者恰好给一个,锚点可用 \"cover\"/\"toc\"/\"ending\";swap = 两内页对调。所有页码引用都按本次调用之前的页序解析,多步操作不用自己推算挪动后的新序号。",
		},
	),
});

interface MovePagesInput {
	operations: PageMoveOperation[];
}
```

(c) `createReadSkillTool` 前加工具工厂:

```ts
function createMovePagesTool(options: AlbumToolsOptions): AgentTool<typeof movePagesSchema, AlbumWriteDetails> {
	return {
		name: "move_pages",
		label: "挪动页面",
		description:
			"调整页面顺序(纯挪位置,页面内容一字不改):operations 数组按序应用,move 插入 / swap 对调。只能挪内页,封面/目录/封尾钉死。一次调用必须表达用户要的完整重排 —— 写入后本轮即结束,不能分多次挪。",
		parameters: movePagesSchema,
		prepareArguments(args: unknown): MovePagesInput {
			if (!isRecord(args) || !Array.isArray(args.operations)) return { operations: [] };
			const operations = args.operations.map((raw): PageMoveOperation => {
				const op = isRecord(raw) ? raw : {};
				if (op.type === "swap") {
					return { type: "swap", a: resolveRefToInternal(options, op.a), b: resolveRefToInternal(options, op.b) };
				}
				return {
					type: "move",
					page: resolveRefToInternal(options, op.pageNo),
					before: op.before === undefined ? undefined : resolveRefToInternal(options, op.before),
					after: op.after === undefined ? undefined : resolveRefToInternal(options, op.after),
				};
			});
			return { operations };
		},
		async execute(_toolCallId: string, params: MovePagesInput): Promise<AgentToolResult<AlbumWriteDetails>> {
			const state = options.getBookState();
			// 未解析成功的引用(-1)统一在这里报可用页码清单。
			for (const op of params.operations) {
				const refs = op.type === "swap" ? [op.a, op.b] : [op.page, op.before, op.after];
				if (refs.some((no) => no === -1))
					throw new Error(`页码引用无法解析。本书可用页码:${pageRefRangeText(options, state)}`);
			}
			const categoryOf = catalogCategoryOf(options.catalog);
			const isInterior = (page: AlbumPage) => {
				const category = categoryOf(page.templateId);
				return category === undefined || !NON_NUMBERED_PAGE_CATEGORIES.has(category);
			};
			const nextState = cloneAlbumBookState(state);
			const beforePages = nextState.pages;
			nextState.pages = applyPageMoves(beforePages, isInterior, params.operations, (no) =>
				pageLabelOf(options, state, no),
			);

			// 结果反馈:每步用户口径描述 + 源页新旧页码映射(模型同轮回话不说错页码)。
			const oldRefs = pageUserRefs(state, categoryOf);
			const newRefs = pageUserRefs(nextState, categoryOf);
			const sourceNos = params.operations.flatMap((op) => (op.type === "swap" ? [op.a, op.b] : [op.page]));
			const operations = params.operations.map((op) =>
				op.type === "swap"
					? `swap:${formatPageUserRef(oldRefs[op.a - 1])}<->${formatPageUserRef(oldRefs[op.b - 1])}`
					: `move:${formatPageUserRef(oldRefs[op.page - 1])}->${op.after !== undefined ? `${formatPageUserRef(oldRefs[op.after - 1])}后` : `${formatPageUserRef(oldRefs[op.before! - 1])}前`}`,
			);
			const notes = [...new Set(sourceNos)].map((no) => {
				const page = beforePages[no - 1];
				const newIndex = nextState.pages.indexOf(page);
				return `原${formatPageUserRef(oldRefs[no - 1])} → 现${formatPageUserRef(newRefs[newIndex])}`;
			});
			notes.push("其余内页页码相应顺延;页面内容全部原样未动");
			return commitWrite(options, nextState, { pageNo: sourceNos[0] ?? -1, operations, notes });
		},
	};
}
```

注意:`NON_NUMBERED_PAGE_CATEGORIES` 目前在 `book-state.ts` 是模块私有 —— 需要 export(一行改动),或在 tools.ts 里 `category === "cover" || category === "toc" || category === "ending"` 直写。选 export(单一真相)。`AlbumPage` 类型 import 已存在则复用。

(d) `createAlbumTools` 注册,插在 `createSetTextFontsTool(options),` 之后:

```ts
		createMovePagesTool(options),
```

- [ ] **Step 4: 跑测试确认全绿 + 全包回归**

Run: `cd packages/design-agent && npx tsx --test test/album-move-pages-tool.test.ts && pnpm --filter @smalldog/design-agent test`
Expected: 新文件 PASS;全包无回归(若有测试断言工具总数,按七个写工具更新它)。

- [ ] **Step 5: Commit**

```bash
git add packages/design-agent/src/core/album/tools.ts packages/design-agent/src/core/album/book-state.ts packages/design-agent/test/album-move-pages-tool.test.ts
git commit -m "feat(design-agent): move_pages 挪页工具 —— 批量 move/swap,单纯挪位置

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 3: Web 同步 —— 写工具集合与展示词

**Files:**
- Modify: `apps/web/src/app/api/v3/albums/[uuid]/design-chat/route.ts`(DESIGN_WRITE_TOOLS)
- Modify: `apps/web/src/components/album/editor-v2/chat-history.ts`(类别类型+映射+顺序)
- Modify: `apps/web/src/components/album/editor-v2/ChatPanel.tsx`(桌面 label)
- Modify: `apps/web/src/components/album/editor-v2/mobile/modals/AiChatSheet.tsx`(移动 label)
- Modify: `apps/web/src/components/album/editor-v2/mobile/use-design-chat.ts`(流式一句人话)
- Test: `apps/web/src/components/album/editor-v2/chat-history.test.ts`(存在则扩,不存在则建)

**Interfaces:**
- Consumes: 工具名字符串 `move_pages`(Task 2)。
- Produces: `DesignChangeCategory` 增 `'order'`;`designChangeCategoryOf('move_pages') === 'order'`;两端 label `['页序', 'Order']`。

- [ ] **Step 1: 写失败测试**

chat-history 若无测试文件则新建 `chat-history.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { designChangeCategoryOf, designOpCategories } from './chat-history';

test('move_pages 归入 order 类别,与其余写工具类别并存', () => {
  assert.equal(designChangeCategoryOf('move_pages'), 'order');
  assert.deepEqual(designOpCategories(['move_pages', 'set_text_fonts']), ['fonts', 'order']);
});
```

Run: `cd apps/web && pnpm test -- --test-name-pattern="move_pages"`(按仓内 web 测试跑法;若不支持过滤就整包跑)
Expected: FAIL。

- [ ] **Step 2: 五处同步**

route.ts:

```ts
const DESIGN_WRITE_TOOLS = new Set([
  'update_page_texts',
  'write_page_html',
  'swap_page_template',
  'update_page_images',
  'set_text_colors',
  'set_text_fonts',
  'move_pages',
]);
```

chat-history.ts(注释「六个写工具」同步改「七个写工具」):

```ts
export type DesignChangeCategory = 'fonts' | 'colors' | 'pages' | 'order';

const DESIGN_CHANGE_CATEGORY: Record<string, DesignChangeCategory> = {
  set_text_fonts: 'fonts',
  set_text_colors: 'colors',
  update_page_texts: 'pages',
  swap_page_template: 'pages',
  update_page_images: 'pages',
  write_page_html: 'pages',
  move_pages: 'order',
};

const DESIGN_CHANGE_ORDER: readonly DesignChangeCategory[] = ['fonts', 'colors', 'pages', 'order'];
```

ChatPanel.tsx `DESIGN_CHANGE_LABEL` 加 `order: ['页序', 'Order'],`;AiChatSheet.tsx 同款 label 表加同一行;use-design-chat.ts `TOOL_LABEL` 加 `move_pages: { zh: '正在挪页…', en: 'Reordering pages…' },`(注释「六个写工具」改「七个写工具」)。

- [ ] **Step 3: 跑 web 测试全绿**

Run: `cd apps/web && pnpm test`
Expected: PASS(含既有 chat-replay-wiring 守卫)。

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/api/v3/albums/[uuid]/design-chat/route.ts apps/web/src/components/album/editor-v2/chat-history.ts apps/web/src/components/album/editor-v2/chat-history.test.ts apps/web/src/components/album/editor-v2/ChatPanel.tsx apps/web/src/components/album/editor-v2/mobile/modals/AiChatSheet.tsx apps/web/src/components/album/editor-v2/mobile/use-design-chat.ts
git commit -m "feat(web): design chat 同步 move_pages —— 写工具集合 + 页序类别展示

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 4: 技能与文档同步 + 全量验证

**Files:**
- Modify: `packages/contracts/skills/album-layout/SKILL.md`(挪页规则)
- Modify: `packages/design-agent/src/core/album/skills.ts`(内置「相册排版」同步)
- Modify: `CLAUDE.md`(六个写工具 → 七个)
- Modify: `packages/design-agent/README.md`(「## 六个写工具」节 + doc-scope checked-at)
- Modify: 其他 doc-scope 覆盖到本次改动路径的文档(CLAUDE.md / 仓根 README.md / apps/web/README.md 的 checked-at,以 `pnpm docs:check` 输出为准)

- [ ] **Step 1: SKILL.md 文件版加「挪页」节**

`album-layout/SKILL.md` 的「换版之后」节后追加:

```markdown
## 挪页(调整页面顺序)

- 用 `move_pages` 一次调用表达完整重排:operations 数组按序给 move(插入)/swap(对调);写入后本轮即结束,**不能分多次挪**。
- 所有页码引用按调用前的页序写,多步操作不用自己推算挪动后的新序号;锚点可用 `"cover"`/`"toc"`/`"ending"`(挪到最前 = `after: "cover"` 或 `after: "toc"`,挪到最后 = `before: "ending"`)。
- 只能挪内页,封面/目录/封尾钉死;挪页**不改任何页面内容**,要连带改文字/换模板,写入完成后下一轮再做,并先征得用户同意。
- 工具结果会报挪动页的新旧页码映射,回复用户时按新页码说话。
```

- [ ] **Step 2: skills.ts 内置「相册排版」同步**

`createDefaultAlbumSkills` 的「相册排版」content 规则列表末尾加两行(与文件版口径一致的紧凑版):

```ts
					"- 挪页用 move_pages 一次调用表达完整重排(move 插入/swap 对调,引用按调用前页序);只能挪内页,封面/目录/封尾钉死。",
					"- 挪页不改任何页面内容;要连带改文字/换模板,下一轮征得用户同意再做。",
```

- [ ] **Step 3: CLAUDE.md 与 README 更新**

CLAUDE.md 52 行处改为:

```markdown
- 七个写工具:`update_page_texts` / `write_page_html` / `swap_page_template` /
  `update_page_images` / `set_text_colors` / `set_text_fonts` / `move_pages`。新增写工具时,
```

(后半句「`design-chat/route.ts` 的 `DESIGN_WRITE_TOOLS` 集合必须同步」保留原样。)

`packages/design-agent/README.md` 的「## 六个写工具」改「## 七个写工具」,清单里加一行 `move_pages`(挪动页面:批量 move/swap 重排页序,只动内页,不改内容)。核对全文其余描述是否仍准确。

- [ ] **Step 4: 守卫与全量验证**

Run(按序):

```bash
pnpm --filter @smalldog/design-agent test
cd apps/web && pnpm test && cd ../..
pnpm typecheck
```

Expected: 全绿。`pnpm typecheck` 内含 docs:check —— 若报 checked-at 落后,把对应文档(design-agent README / CLAUDE.md / 仓根 README / apps/web README)的 `checked-at` 推进到本次提交将产生的位置:做法是先提交代码,再按 docs:check 报错逐一核对文档内容、推进 checked-at、补一笔 docs 提交(仓内既有惯例,见 `git log --grep=checked-at`)。

- [ ] **Step 5: Commit(可能两笔:功能文档 + checked-at 推进)**

```bash
git add packages/contracts/skills/album-layout/SKILL.md packages/design-agent/src/core/album/skills.ts CLAUDE.md packages/design-agent/README.md
git commit -m "docs(design-agent): 排版技能与工具清单同步 move_pages(七个写工具)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
# 若 docs:check 要求,另补:
# git commit -m "docs: 核对 README/CLAUDE 后推进 checked-at ..."
```

---

## Self-Review 记录

- Spec 覆盖:§二(schema/寻址)→Task 2;§三(身份锚定语义)→Task 1;§四(红线)→Task 1 校验+Task 2 拒绝测试;§五(结果反馈)→Task 2 notes 测试;§六(同步义务六项)→Task 3(route/chat-history)+Task 4(SKILL/内置/CLAUDE/README);§七(测试矩阵)→Task 1/2/3 分摊;§八非目标未越界。
- 占位符:无 TBD/TODO;所有步骤带可执行代码或命令。
- 类型一致:`PageMoveOperation` 内部形态(`page`/`a`/`b` 为内部 1 基数)在 Task 1 定义、Task 2 消费一致;`NON_NUMBERED_PAGE_CATEGORIES` 需 export 已在 Task 2(c) 标注。
