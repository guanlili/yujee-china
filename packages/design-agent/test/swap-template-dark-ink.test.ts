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
	// 注：这条测试的设计随评审要求的「Important 修复」（migratePageToTemplate 保留
	// #pageBackground carrier）改过一轮。
	//
	// 第一轮（brief 原稿浅黄底 #F3F0A8 + mag-05→mag-13）：两个都是纯内页模板，都不在
	// TEMPLATE_OWN_BACKGROUND 表里（该表只收 cover/ending 类目的深底模板），读不读这条
	// carrier 都会落到"默认白底"同一个答案，测不出"以它为准"；已验证过是简报本身的
	// 测试缺陷，一度改成深蓝底(#2D6DB0)+mag-13 让 before/after 分岔。
	//
	// 但评审要求的 Important 修复让 #pageBackground 本身会原样跟着迁移(见下面新增的
	// 「carrier 还在」测试)——这就让"深蓝底+mag-13"这版也失效了：迁移后 nextPage 照样
	// 带着 #2D6DB0，effectivePageBackground 前后都读到同一个深蓝，beforeInk===afterInk，
	// 不会触发翻转，也就验证不了"不看模板自带底色"这句话本身。
	//
	// 真正能测出"以它为准，不看模板自带底色"的场景，只能发生在 TEMPLATE_OWN_BACKGROUND
	// 真正有值的 cover/ending 类目：页面已经有显式的浅底覆盖，换到 mag-62（模板自己声明
	// 的默认底色是深底 #12363A）——如果实现看的是模板自己的默认底色而不是页面的显式
	// 覆盖，会把这页错判成深底、把字翻成浅字；只有真的"以显式覆盖为准"，才会维持深字
	// 不变。
	const { tools, getBook } = createHarness();
	const book = getBook();
	book.pages[0]!.texts["#pageBackground"] = "#F3F0A8"; // 显式浅黄覆盖
	book.pages[0]!.texts["title#accentColor"] = "#1A1A14"; // 配套的深字（当前显示是对的）
	await swapTemplate(tools, "cover", "mag-62");
	const cover = getBook().pages[0]!;
	assert.equal(cover.texts["#pageBackground"], "#F3F0A8", "显式覆盖应该跟着迁移原样带走");
	const accent = Object.entries(cover.texts).find(([k]) => k.endsWith("#accentColor"))?.[1];
	assert.equal(accent, "#1A1A14", "有显式浅底覆盖时不该被 mag-62 自带的深底带偏，字色应该保持深字");
});

test("浅底换浅底时字色不动（不引入无谓改动）", async () => {
	// 评审复盘（2026-08-29）：这条继承自 brief 原稿——before 快照里本来就没有任何
	// #accentColor 键，`for...if (k.endsWith('#accentColor'))` 循环永远不触发断言，
	// 测不出"是否凭空新增了不该有的 accentColor"。改法：先预置几个 carrier（title 和
	// body 都是 mag-05→mag-13 两个模板共有的槽，迁移不会被当未知槽丢），断言换模板后
	// 逐字不变，且没有凭空新增/减少。
	const { tools, getBook } = createHarness();
	const book = getBook();
	book.pages[1]!.texts["title#accentColor"] = "#2c6e8f";
	book.pages[1]!.texts["body#accentColor"] = "#7a4b2a";
	const before = { ...getBook().pages[1]!.texts };
	const beforeAccentKeys = Object.keys(before).filter((k) => k.endsWith("#accentColor"));
	assert.ok(beforeAccentKeys.length > 0, "预置的 accentColor 不能是空的，不然这条测试没有拦截力");

	await swapTemplate(tools, 1, "mag-13");
	const after = getBook().pages[1]!.texts;
	for (const key of beforeAccentKeys) assert.equal(after[key], before[key], `${key} 不该变`);
	const afterAccentKeys = Object.keys(after).filter((k) => k.endsWith("#accentColor"));
	assert.deepEqual(afterAccentKeys.sort(), beforeAccentKeys.sort(), "不该凭空新增/减少 accentColor 键");
});

test("换模板后 #pageBackground carrier 还在（不会被当成未知文字槽丢弃）", async () => {
	// 评审复盘（2026-08-29）：migratePageToTemplate 把每个文字槽逐个过
	// validateTextsPatch，"#pageBackground" 既不是任何模板声明的文字槽，也不匹配
	// parseThemeCarrierKey 的后缀模式（它只认 #accentColor/#artFont），落进"未知槽"
	// 分支被当垃圾清掉——用户自己设的页底色换模板后会静默复位成模板默认，Task 4
	// 「重烘后不再丢失」被这条迁移路径绕过去了。评审实测复现，修法是在
	// migratePageToTemplate 里特判这一个 key，原样带过去。
	const { tools, getBook } = createHarness();
	const book = getBook();
	book.pages[1]!.texts["#pageBackground"] = "#F3F0A8";
	await swapTemplate(tools, 1, "mag-13");
	assert.equal(getBook().pages[1]!.texts["#pageBackground"], "#F3F0A8", "页级底色 carrier 应该原样带过去，不能被当未知槽清掉");
});
