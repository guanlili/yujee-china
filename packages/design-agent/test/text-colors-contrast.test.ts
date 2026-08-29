import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	type AlbumBookState,
	cloneAlbumBookState,
	parseAlbumBookInput,
} from "../src/core/album/book-state.ts";
import { loadTemplateCatalog } from "../src/core/album/templates-catalog.ts";
import { type AlbumToolsOptions, createAlbumTools } from "../src/core/album/tools.ts";

/* set_text_colors 对比度硬校验（2026-08-29 设计：.superpowers/sdd/2026-08-29-
   agent-style-understanding/task-7-brief.md）：这个工具能把字刷成任意色，深底书上刷
   深字就整页读不了，而 AI 看不见渲染结果、不会自己发现。写入前必须对每页「实际底色 vs
   拟写入字色」做 WCAG 对比度体检，不达 4.5:1 就整批拒绝并报出哪几页、实测多少。 */

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
	return {
		tools,
		getBook: () => book,
		setBook: (next: AlbumBookState) => {
			book = cloneAlbumBookState(next);
		},
	};
}

test("在深底页上刷深字被打回，报错说清哪几页、实测多少", async () => {
	const { tools, getBook } = createHarness();
	// 先把第 1 页刷成蓝底
	await tools.get("set_page_background")!.execute("c1", { pages: [1], colorId: "ivory" } as never);
	const book = getBook();
	book.pages[1]!.texts["#pageBackground"] = "#2D6DB0"; // 深蓝底
	// 再刷深字
	await assert.rejects(
		() => tools.get("set_text_colors")!.execute("c2", { titleColor: "#1A1A14" } as never),
		(err: Error) => {
			assert.match(err.message, /对比度/);
			assert.match(err.message, /1\.\d\d|2\.\d\d|3\.\d\d/); // 报出实测值
			return true;
		},
	);
});

test("浅底页上刷深字正常通过", async () => {
	const { tools, getBook } = createHarness();
	await tools.get("set_text_colors")!.execute("c1", { titleColor: "#1C1B18" } as never);
	assert.equal(getBook().pages[1]!.texts["title#accentColor"], "#1C1B18");
});

test("没有页底色的页按纯白判定（模板默认 background:#fff）", async () => {
	const { tools } = createHarness();
	await assert.rejects(
		() => tools.get("set_text_colors")!.execute("c1", { bodyColor: "#F5F2E8" } as never), // 白底浅字
		/对比度/,
	);
});

test("换到 mag-62（模板自带深底，未经过 set_page_background）后刷深字必须被打回", async () => {
	// 评审复盘（2026-08-29）：Task 7 的对比度体检只查 page.texts[PAGE_BACKGROUND_
	// CARRIER_KEY]，没有查 Task 8 引入的 TEMPLATE_OWN_BACKGROUND。mag-62/mag-63/p01
	// 这几个模板自带深底，页面只要没走过 set_page_background（没有显式 #pageBackground
	// carrier），旧实现会把它当白底放行——评审用这条路径实测复现了 1.343:1。
	// 修法：改用 effectivePageBackground（Task 8 已经写好「carrier 优先 → 模板自带
	// 深底 → 白底」的正确优先级），这里补一条测试钉住。
	const { tools, getBook } = createHarness(); // 封面 mag-01（editorial），1 图槽
	const swapTool = tools.get("swap_page_template")!;
	// 封面换成 mag-62：category 都是 cover、图槽数都是 1，可以直接换。
	await swapTool.execute("s1", swapTool.prepareArguments!({ pageNo: "cover", templateId: "mag-62" }) as never);
	assert.equal(getBook().pages[0]!.templateId, "mag-62");
	assert.equal(getBook().pages[0]!.texts["#pageBackground"], undefined, "没有显式 carrier 才是这个缺口的真实场景");

	await assert.rejects(
		() => tools.get("set_text_colors")!.execute("c1", { titleColor: "#1A1A14" } as never),
		(err: Error) => {
			assert.match(err.message, /对比度/);
			assert.match(err.message, /1\.\d\d/); // #12363A 配 #1A1A14 实测约 1.34:1
			return true;
		},
	);
});
