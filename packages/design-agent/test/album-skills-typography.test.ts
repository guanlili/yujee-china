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
import { fontsForRole, getFontEntry } from "../src/core/album/font-registry.ts";
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
	return { tools, getBook: () => book, catalog };
}

test("font-registry：角色菜单非空，且每款字体的 roles 与所在菜单一致", () => {
	for (const role of ["title", "body", "decoration"] as const) {
		const menu = fontsForRole(role);
		assert.ok(menu.length > 0, `${role} 菜单不应为空`);
		for (const f of menu) assert.ok(f.roles.includes(role));
	}
	assert.equal(getFontEntry("noto-serif-sc")?.lang, "zh");
	assert.equal(getFontEntry("playfair-display")?.lang, "en");
	assert.equal(getFontEntry("马善政楷书"), undefined, "已去掉的字体不应在库里");
});

test("set_text_fonts：三类字体按角色刷满全书，装饰独立于标题，图注跟正文，契约合法", async () => {
	const { tools, getBook } = createHarness();
	const tool = tools.get("set_text_fonts");
	assert.ok(tool);
	const TITLE = "playfair-display";
	const BODY = "eb-garamond";
	const DECO = "ibm-plex-mono";
	const result = await tool.execute("t1", {
		titleFont: TITLE,
		bodyFont: BODY,
		decorationFont: DECO,
	} as never);
	assert.equal(result.terminate, true);

	const book = getBook();
	// page0 mag-01：title(title)→标题；label/folio(decoration)→装饰；explain1/2(explain)→正文。
	const cover = book.pages[0]!;
	assert.equal(cover.texts["title#artFont"], TITLE);
	assert.equal(cover.texts["label#artFont"], DECO);
	assert.equal(cover.texts["folio#artFont"], DECO);
	assert.equal(cover.texts["explain1#artFont"], BODY);
	assert.equal(cover.texts["explain2#artFont"], BODY);
	// page2 mag-10：重复槽 explain[n]→正文；folio→装饰。
	const repeatPage = book.pages[2]!;
	assert.equal(repeatPage.texts["explain[0]#artFont"], BODY);
	assert.equal(repeatPage.texts["explain[3]#artFont"], BODY);
	assert.equal(repeatPage.texts["folio#artFont"], DECO);
	// page5 mag-25：body→正文；date(decoration)→装饰；title→标题；explain→正文。
	const richPage = book.pages[5]!;
	assert.equal(richPage.texts["body#artFont"], BODY);
	assert.equal(richPage.texts["date#artFont"], DECO);
	assert.equal(richPage.texts["title#artFont"], TITLE);
	assert.equal(richPage.texts["explain#artFont"], BODY);

	assert.equal(typeof cover.texts.title, "string");
	for (const page of book.pages) {
		const parsed = Page.safeParse(page);
		assert.ok(parsed.success, JSON.stringify(parsed.success ? "" : parsed.error.issues));
	}
});

test("set_text_fonts：只给装饰字体时，标题/正文槽不被改字体", async () => {
	const { tools, getBook } = createHarness();
	const tool = tools.get("set_text_fonts");
	assert.ok(tool);
	await tool.execute("t1", { decorationFont: "jetbrains-mono" } as never);

	const book = getBook();
	const cover = book.pages[0]!;
	assert.equal(cover.texts["label#artFont"], "jetbrains-mono");
	assert.equal(cover.texts["folio#artFont"], "jetbrains-mono");
	assert.equal(cover.texts["title#artFont"], undefined);
	assert.equal(cover.texts["explain1#artFont"], undefined);
});

test("set_text_fonts：配色与字体互不干扰，各写各的 carrier", async () => {
	const { tools, getBook } = createHarness();
	const fontTool = tools.get("set_text_fonts");
	const colorTool = tools.get("set_text_colors");
	assert.ok(fontTool);
	assert.ok(colorTool);
	await colorTool.execute("c1", { titleColor: "#2c6e8f" } as never);
	await fontTool.execute("f1", { titleFont: "playfair-display" } as never);

	const cover = getBook().pages[0]!;
	assert.equal(cover.texts["title#accentColor"], "#2c6e8f");
	assert.equal(cover.texts["title#artFont"], "playfair-display");
});

test("set_text_fonts：空、未知 id、角色不匹配都被拒绝", async () => {
	const { tools } = createHarness();
	const tool = tools.get("set_text_fonts");
	assert.ok(tool);
	await assert.rejects(tool.execute("t1", {} as never), /至少要给/);
	await assert.rejects(tool.execute("t2", { titleFont: "comic-sans" } as never), /不是合法字体 id/);
	// ibm-plex-mono 只属于装饰角色，用作标题应打回。
	await assert.rejects(tool.execute("t3", { titleFont: "ibm-plex-mono" } as never), /不适合标题角色/);
	// great-vibes 只属于装饰，用作正文应打回。
	await assert.rejects(tool.execute("t4", { bodyFont: "great-vibes" } as never), /不适合正文角色/);
});
