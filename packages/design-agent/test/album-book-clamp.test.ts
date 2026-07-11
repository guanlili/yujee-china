import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	type AlbumBookState,
	clampOverLimitTexts,
	parseAlbumBookInput,
	validateAlbumBook,
} from "../src/core/album/book-state.ts";
import { loadTemplateCatalog } from "../src/core/album/templates-catalog.ts";

// 装书容错:上游(AI 自然成文,不硬截断)可能落库超 maxChars 的文案。装书时把
// 超限文本截到 maxChars 并出警告,而不是 422 把整本书挡在设计对话外;
// 结构性错误(未知模板/缺图槽)仍必须硬失败。

const fixturePath = fileURLToPath(new URL("../fixtures/sample-book.json", import.meta.url));

function loadFixtureBook(): AlbumBookState {
	return parseAlbumBookInput(JSON.parse(readFileSync(fixturePath, "utf8"))).book;
}

test("clampOverLimitTexts 截断超限槽并出警告,使 validateAlbumBook 通过", () => {
	const catalog = loadTemplateCatalog();
	const book = loadFixtureBook();
	// mag-01: title maxChars=12, explain1 maxChars=40
	const long19 = "一二三四五六七八九十一二三四五六七八九"; // 19 字
	book.pages[0].texts.title = long19;
	book.pages[0].texts.explain1 = "长".repeat(50);

	assert.ok(validateAlbumBook(book, catalog).length > 0, "前置:超限时校验确实报错");

	const notes = clampOverLimitTexts(book, catalog);

	assert.equal(book.pages[0].texts.title, long19.slice(0, 12));
	assert.equal([...book.pages[0].texts.explain1].length, 40);
	assert.equal(notes.length, 2);
	assert.match(notes[0], /title/);
	assert.match(notes[0], /12/);
	assert.deepEqual(validateAlbumBook(book, catalog), []);
});

test("clampOverLimitTexts 按 Unicode 字符截断(代理对不撕半)", () => {
	const catalog = loadTemplateCatalog();
	const book = loadFixtureBook();
	const emoji = "😀".repeat(15); // 15 个字符,30 个 UTF-16 code unit
	book.pages[0].texts.title = emoji;

	clampOverLimitTexts(book, catalog);

	assert.equal([...book.pages[0].texts.title].length, 12);
	assert.equal(book.pages[0].texts.title, "😀".repeat(12));
});

test("clampOverLimitTexts 不动合法文本,也不掩盖结构性错误", () => {
	const catalog = loadTemplateCatalog();
	const book = loadFixtureBook();
	const before = JSON.stringify(book.pages.map((p) => p.texts));

	assert.deepEqual(clampOverLimitTexts(book, catalog), []);
	assert.equal(JSON.stringify(book.pages.map((p) => p.texts)), before);

	// 未知模板是结构性错误:clamp 不处理,validate 仍硬失败。
	book.pages[0].templateId = "mag-does-not-exist";
	clampOverLimitTexts(book, catalog);
	assert.ok(validateAlbumBook(book, catalog).length > 0);
});
