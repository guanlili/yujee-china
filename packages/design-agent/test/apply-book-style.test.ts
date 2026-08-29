import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { interiorInkSequence } from "@yujee/contracts/design";
import {
	type AlbumBookState,
	cloneAlbumBookState,
	parseAlbumBookInput,
} from "../src/core/album/book-state.ts";
import { loadTemplateCatalog } from "../src/core/album/templates-catalog.ts";
import { type AlbumToolsOptions, bookSeed, createAlbumTools } from "../src/core/album/tools.ts";

/* apply_book_style（2026-08-29 设计：.superpowers/sdd/2026-08-29-agent-style-understanding/
   task-6-brief.md）：整本刷 —— 换封面/封底模板 + 全书页底色 + 三个文字色。多巴胺走
   interiorInkSequence(seed, count) 确定性序列，不能用随机（追加照片只重刷新页，两次
   结果不一样就会让新页跟全书不同色）。fixture 同 set-page-background.test.ts /
   album-delete-page-tool.test.ts：6 页，[0] mag-01（封面→素白散文）、[1..4] 内页、
   [5] mag-22（封尾）。*/

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

test("换成多巴胺：封面变 mag-62、封底变 mag-63，内页底色走确定性序列", async () => {
	const { tools, getBook } = createHarness(); // fixture 封面 mag-01
	const tool = tools.get("apply_book_style")!;
	await tool.execute("c1", tool.prepareArguments({ styleId: "dopamine" }) as never);
	const book = getBook();
	assert.equal(book.pages[0]!.templateId, "mag-62");
	assert.equal(book.pages[book.pages.length - 1]!.templateId, "mag-63");
	const interiors = book.pages.slice(1, -1);
	const expected = interiorInkSequence(bookSeed(book), interiors.length);
	// 注：brief 原稿里这条断言写死查 "title#accentColor"，但 fixture 的 4 张内页模板
	// 并不都有 title 槽（mag-10 只有 explain[n]、mag-30 只有 body，两者都没有
	// "title"）—— 照抄会对着不存在的槽断言 undefined，是 brief 测试本身的缺陷，不是
	// 实现的问题。改成逐页检查该页**实际存在**的每个 accentColor carrier：槽基础名是
	// "title" 比 ink.accent，其余（body/explain 等）比 ink.body，和实现里
	// ROLE_TO_COLOR_KIND 的两档一致。
	interiors.forEach((page, i) => {
		assert.equal(page.texts["#pageBackground"], expected[i]!.bg);
		const accentKeys = Object.keys(page.texts).filter((k) => k.endsWith("#accentColor"));
		assert.ok(accentKeys.length > 0, `内页 ${i + 1}（${page.templateId}）应至少有一个可主题化的文字槽`);
		for (const key of accentKeys) {
			const base = key.slice(0, -"#accentColor".length).replace(/\[\d+\]/g, "");
			assert.equal(
				page.texts[key],
				base === "title" ? expected[i]!.accent : expected[i]!.body,
				`内页 ${i + 1} 的 ${key} 颜色不对`,
			);
		}
	});
});

test("同一本书连刷两次多巴胺，逐页颜色完全一致（确定性，不是随机）", async () => {
	const a = createHarness();
	const b = createHarness();
	for (const h of [a, b]) {
		await h.tools.get("apply_book_style")!.execute("c1", { styleId: "dopamine" } as never);
	}
	assert.deepEqual(
		a.getBook().pages.map((p) => p.texts["#pageBackground"]),
		b.getBook().pages.map((p) => p.texts["#pageBackground"]),
	);
});

test("换成杂志刊头：全书单一冷灰底 + 三个文字色", async () => {
	const { tools, getBook } = createHarness();
	await tools.get("apply_book_style")!.execute("c1", { styleId: "magazine" } as never);
	const book = getBook();
	assert.equal(book.pages[0]!.templateId, "mag-23");
	for (const page of book.pages) assert.equal(page.texts["#pageBackground"], "#E7EAE9");
	assert.equal(book.pages[1]!.texts["title#accentColor"], "#0F0F0F");
});

test("返回值报告封面文案迁移代价", async () => {
	const { tools } = createHarness();
	const result = await tools.get("apply_book_style")!.execute("c1", { styleId: "dopamine" } as never);
	assert.match(result.details!.notes!.join(" "), /封面/);
});

test("已经是该风格时打回，不空转", async () => {
	const { tools } = createHarness(); // 已是 editorial
	await assert.rejects(
		() => tools.get("apply_book_style")!.execute("c1", { styleId: "editorial" } as never),
		/已经是/,
	);
});

test("未知 styleId 打回并列出四个风格", async () => {
	const { tools } = createHarness();
	await assert.rejects(
		() => tools.get("apply_book_style")!.execute("c1", { styleId: "vaporwave" } as never),
		(err: Error) => {
			for (const id of ["editorial", "magazine", "dopamine", "postcard"]) assert.match(err.message, new RegExp(id));
			return true;
		},
	);
});
