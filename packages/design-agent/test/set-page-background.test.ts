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

/* set_page_background:改页面底色，底色只能从当前风格(靠封面模板反推)的调色板里挑，
   改完底色的那一页文字色必须按两色规则跟着翻(深底浅字/浅底深字)，不留中间态。 */

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

// editorial：直接用 fixture（封面 mag-01 → 素白散文风格）。
function setupEditorialBook() {
	return createHarness();
}

// dopamine：把封面换成 mag-62，风格靠封面反推，改这一个字段就够。
function setupDopamineBook() {
	const h = createHarness();
	const book = cloneAlbumBookState(h.getBook());
	book.pages[0]!.templateId = "mag-62";
	h.setBook(book);
	return h;
}

test("把内页第 1 页刷成多巴胺的黄底，字色跟着翻成深字", async () => {
	const { tools, getBook } = setupDopamineBook();
	const tool = tools.get("set_page_background");
	assert.ok(tool, "set_page_background 工具必须注册");
	await tool!.execute("c1", tool!.prepareArguments({ pages: [1], colorId: "butter" }) as never);
	const page = getBook().pages[1]!; // 0 是封面
	assert.equal(page.texts["#pageBackground"], "#F3F0A8");
	// 浅底 → 深字
	assert.equal(page.texts["title#accentColor"], "#1A1A14");
	assert.ok(page.html!.includes("background-color:#F3F0A8"));
});

test("刷成蓝底时字色翻成浅字", async () => {
	const { tools, getBook } = setupDopamineBook();
	const tool = tools.get("set_page_background")!;
	await tool.execute("c1", tool.prepareArguments({ pages: [1], colorId: "blue" }) as never);
	assert.equal(getBook().pages[1]!.texts["title#accentColor"], "#F5F2E8");
});

test('pages 传 "all" 刷全书', async () => {
	const { tools, getBook } = setupDopamineBook();
	const tool = tools.get("set_page_background")!;
	const result = await tool.execute("c1", tool.prepareArguments({ pages: "all", colorId: "green" }) as never);
	for (const page of getBook().pages) assert.equal(page.texts["#pageBackground"], "#107E47");
	assert.ok(result.details!.notes!.join(" ").includes("全书"));
});

test("表外 colorId 被打回，且报错里列出可选值", async () => {
	const { tools } = setupDopamineBook();
	const tool = tools.get("set_page_background")!;
	await assert.rejects(
		() => tool.execute("c1", tool.prepareArguments({ pages: [1], colorId: "hotpink" }) as never),
		(err: Error) => {
			assert.match(err.message, /butter/);
			assert.match(err.message, /blue/);
			return true;
		},
	);
});

test("非多巴胺风格只能用该风格底色 + 四白，不能用五色", async () => {
	const { tools } = setupEditorialBook(); // 封面 mag-01
	const tool = tools.get("set_page_background")!;
	await assert.rejects(() => tool.execute("c1", tool.prepareArguments({ pages: [1], colorId: "violet" }) as never));
	await tool.execute("c1", tool.prepareArguments({ pages: [1], colorId: "ivory" }) as never);
});

test("封面/封尾用类别名指代", async () => {
	const { tools, getBook } = setupDopamineBook();
	const tool = tools.get("set_page_background")!;
	// 注：dopamine 的 styleBackgroundOptions 只暴露 THIRD_SET_INTERIOR 五色(butter/violet/
	// orange/green/blue)，THIRD_SET_COVERS 的 "red" 不在其中——这里用 orange 验证的是
	// "cover" 类别名能正确解析到内部页位，不是验证 red 这个具体色值。
	await tool.execute("c1", tool.prepareArguments({ pages: ["cover"], colorId: "orange" }) as never);
	assert.ok(getBook().pages[0]!.texts["#pageBackground"]);
});
