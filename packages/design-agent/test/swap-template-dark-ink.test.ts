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

/* swap_page_template 换深底模板时自动翻字色（2026-08-29 设计：.superpowers/sdd/
   2026-08-29-agent-style-understanding/task-8-brief.md）：这修的是 design-apply.ts:249-256
   注释点名、至今没修的坑 —— Agent 能把浅底书的封面换成 mag-62，carrier 仍是深字落在深底
   上约 1.3:1，整页读不了。fixture 同 set-page-background.test.ts：6 页，[0] mag-01（封
   面）、[1..4] 内页（mag-05/mag-10/mag-05/mag-30）、[5] mag-22（封尾）。

   注：brief 原稿的测试片段直接 `tool.execute(id, { pageNo: 'cover', ... })`，跳过了
   `prepareArguments`。但 swap_page_template 的用户口径页码解析（"cover"/内页数字 → 内部
   数组位置）发生在 `prepareArguments` 里（调 resolveRefToInternal），execute 内部只
   `Number(params.pageNo)` 直接用——不经 prepareArguments 时 pageNo:'cover' 会变成
   NaN，pageNo:1（用户口径内页 1）不经偏移直接当内部位置 1 会误中封面（fixture 封面在
   数组位置 0，内部页码 1）。跟 album-tools.test.ts 的 run() helper、set-page-background.
   test.ts 的写法一致，这里统一补上 `tool.prepareArguments(...)` 再 execute，不是改测试
   意图，只是照工具的真实调用契约走。 */

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

async function swapTemplate(
	tools: ReturnType<typeof createHarness>["tools"],
	pageNo: number | string,
	templateId: string,
) {
	const tool = tools.get("swap_page_template")!;
	const prepared = tool.prepareArguments!({ pageNo, templateId });
	return tool.execute("c1", prepared as never);
}

test("封面换成 mag-62（深底）后，文字 carrier 翻成浅字", async () => {
	const { tools, getBook } = createHarness(); // 封面 mag-01，字色默认（无 carrier）
	await swapTemplate(tools, "cover", "mag-62");
	const cover = getBook().pages[0]!;
	const accentKeys = Object.entries(cover.texts).filter(([key]) => key.endsWith("#accentColor"));
	assert.ok(accentKeys.length > 0, "换到深底模板后应写入 accentColor carrier");
	for (const [key, value] of accentKeys) {
		assert.equal(value, "#F5F2E8", `${key} 没翻成浅字`);
	}
});

test("从深底模板换回浅底模板时字色翻回深字", async () => {
	const { tools, getBook } = createHarness();
	await swapTemplate(tools, "cover", "mag-62");
	await swapTemplate(tools, "cover", "mag-01");
	const cover = getBook().pages[0]!;
	const accents = Object.entries(cover.texts).filter(([k]) => k.endsWith("#accentColor"));
	assert.ok(accents.length > 0, "应该有 carrier 键");
	for (const [key, value] of accents) assert.equal(value, "#1A1A14", `${key} 没翻回深字`);
});

test("页面已有 #pageBackground 时以它为准，不看模板自带底色", async () => {
	// 注：brief 原稿设浅黄底 #F3F0A8、断言配深字。但 mag-05/mag-13 都不在
	// TEMPLATE_OWN_BACKGROUND 表里（该表只收 cover/ending 类目的深底模板，内页模板没有
	// "自带深底"这回事）——不读 #pageBackground、直接假定模板默认白底，算出来也是深字，
	// 跟浅黄底该配的深字撞了同一个答案：读不读这条 carrier 结果都一样，测不出"以它为
	// 准"这回事，也测不出实现忘记读它的情况（原稿这个组合下，实现即便完全不读
	// #pageBackground，写入前也没有任何已存在的 accentColor 可比对，断言必然落空——已用
	// 上面实现过 Step 4 后重跑验证过，确实红）。
	// 改为:页面当前已经是"深底覆盖 + 配套浅字"（覆盖底色需要浅字才读得清），换到一个自己
	// 没有深底的模板(mag-13 默认白底)。正确实现要读出旧底色其实是深底,判定前后底色类别
	// 不一致,把陈旧的浅字翻回深字;如果实现忽略 #pageBackground、直接当模板默认白底处理,
	// 会误判"前后都是白底深字类"没有变化,把陈旧的浅字原样留在新的白底上——那才是真正会
	// 读不清的分岔点，也是这条测试要守住的行为。
	const { tools, getBook } = createHarness();
	const book = getBook();
	book.pages[1]!.texts["#pageBackground"] = "#2D6DB0"; // 深蓝底覆盖
	book.pages[1]!.texts["title#accentColor"] = "#F5F2E8"; // 配套的浅字（当前显示是对的）
	await swapTemplate(tools, 1, "mag-13");
	const page = getBook().pages[1]!;
	const accent = Object.entries(page.texts).find(([k]) => k.endsWith("#accentColor"))?.[1];
	assert.equal(accent, "#1A1A14", "换到默认白底模板后，陈旧的浅字应该翻回深字");
});

test("浅底换浅底时字色不动（不引入无谓改动）", async () => {
	const { tools, getBook } = createHarness();
	const before = { ...getBook().pages[1]!.texts };
	await swapTemplate(tools, 1, "mag-13");
	const after = getBook().pages[1]!.texts;
	for (const [k, v] of Object.entries(before)) {
		if (k.endsWith("#accentColor")) assert.equal(after[k], v, `${k} 不该变`);
	}
});
