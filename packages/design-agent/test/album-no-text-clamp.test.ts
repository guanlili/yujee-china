import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	type AlbumBookState,
	parseAlbumBookInput,
	validateAlbumBook,
	validateTextsPatch,
} from "../src/core/album/book-state.ts";
import { loadTemplateCatalog } from "../src/core/album/templates-catalog.ts";

// 【不做字数校验】模板已不声明任何字数上限:用户和 AI 写多长都照收,不拒收、不截断。
// 排版装不下由渲染层的 fit-text 解决(固定高度的文字框自动缩字号),而不是砍掉
// 已经写好的字。结构性错误(未知模板/未知槽/缺图槽)仍必须硬失败 —— 那不是字数问题。

const fixturePath = fileURLToPath(new URL("../fixtures/sample-book.json", import.meta.url));

function loadFixtureBook(): AlbumBookState {
	return parseAlbumBookInput(JSON.parse(readFileSync(fixturePath, "utf8"))).book;
}

test("超长文案:装书校验通过,内容一字不改", () => {
	const catalog = loadTemplateCatalog();
	const book = loadFixtureBook();
	// 写得又长又满 —— 过去会被拒收/截断。
	const long19 = "一二三四五六七八九十一二三四五六七八九"; // 19 字
	const long50 = "长".repeat(50);
	book.pages[0].texts.title = long19;
	book.pages[0].texts.body = long50;

	assert.deepEqual(validateAlbumBook(book, catalog), [], "超字数不该被判不合法");
	assert.equal(book.pages[0].texts.title, long19, "原文必须一字不动");
	assert.equal(book.pages[0].texts.body, long50);
});

test("set_page_texts 的校验器不拒收超长文案", () => {
	const catalog = loadTemplateCatalog();
	const template = catalog.get("mag-01");
	assert.ok(template);

	const errors = validateTextsPatch(template, {
		title: "这是一个远远超过十二个字上限的超长标题文案",
	});

	assert.deepEqual(errors, [], "字数不该成为拒收理由");
});

test("结构性错误仍硬失败(未知槽 / 未知模板)", () => {
	const catalog = loadTemplateCatalog();
	const template = catalog.get("mag-01");
	assert.ok(template);

	// 槽不存在 = 结构性错误,照样报。
	assert.ok(validateTextsPatch(template, { 不存在的槽: "x" }).length > 0);

	const book = loadFixtureBook();
	book.pages[0].templateId = "mag-does-not-exist";
	assert.ok(validateAlbumBook(book, catalog).length > 0);
});
