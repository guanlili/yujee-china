import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { contrastRatio, interiorInkSequence } from "@yujee/contracts/design";
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

/* ───────── 页根字色必须跟着底色翻（最终评审 Important 2）─────────
   apply_book_style / set_page_background 都只写 background-color，页根 color 留着
   模板写死的 #1c1b18 —— 评审实测多巴胺的橙底 3.41、绿底 3.36、蓝底 3.22，全都低于
   本分支自己定的 4.5 硬线。受害者是**不带 carrier** 的静态装饰：mag-10 的 1/2/3/4
   序号用的正是 color:currentColor，只认页根 color。
   修在 carrier 一处（contracts/render/page-background.applyPageBackground），所以
   这里断言的是「工具跑完之后页面 html 的实际观感」，不是某个函数的返回值。 */

/** 页根 [data-template] 开标签里的某条 style 声明（不能用 includes('color:')，会被 background-color 喂饱）。 */
function rootDecl(html: string, prop: string): string | undefined {
	const openTag = /<[a-z0-9]+\b[^>]*\bdata-template="[^"]*"[^>]*>/i.exec(html)?.[0] ?? "";
	const style = /style="([^"]*)"/.exec(openTag)?.[1] ?? "";
	for (const d of style.split(";")) {
		const at = d.indexOf(":");
		if (at >= 0 && d.slice(0, at).trim().toLowerCase() === prop) return d.slice(at + 1).trim();
	}
	return undefined;
}

test("换成多巴胺后，每一页的页根字色压在该页底色上都过 4.5:1（静态装饰不至于同色相压）", async () => {
	const { tools, getBook } = createHarness();
	await tools.get("apply_book_style")!.execute("c1", { styleId: "dopamine" } as never);
	for (const [i, page] of getBook().pages.entries()) {
		const bg = rootDecl(page.html!, "background-color");
		const ink = rootDecl(page.html!, "color");
		assert.ok(bg, `第 ${i} 页页根没写底色`);
		assert.ok(ink, `第 ${i} 页页根没写成对的字色`);
		const ratio = contrastRatio(bg!, ink!);
		assert.ok(ratio >= 4.5, `第 ${i} 页（${page.templateId}）底色 ${bg} 配页根字色 ${ink} 只有 ${ratio.toFixed(2)}:1`);
	}
});

test("set_page_background 刷深底时，页根字色也跟着翻（不只是带 carrier 的文字槽）", async () => {
	const { tools, getBook } = createHarness(); // fixture 是 editorial，先换到多巴胺才有深底可挑
	await tools.get("apply_book_style")!.execute("c0", { styleId: "dopamine" } as never);
	const tool = tools.get("set_page_background")!;
	await tool.execute("c1", tool.prepareArguments({ pages: [1], colorId: "blue" }) as never);
	const page = getBook().pages[1]!;
	assert.equal(rootDecl(page.html!, "background-color"), "#2D6DB0");
	assert.equal(rootDecl(page.html!, "color"), "#F5F2E8", "蓝底必须配浅字，否则 mag-10 的序号黑压蓝");
});
