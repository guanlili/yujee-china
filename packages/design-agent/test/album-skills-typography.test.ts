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
	const catalog = loadTemplateCatalog();
	// role → 字体的映射:title→标题字;body/explain→正文字;decoration→装饰字。
	// 【不写死哪个槽是什么 role】—— 模板台能改 role、槽 id 也按 role 派号,写死必烂。
	const fontForRole: Record<string, string> = {
		title: TITLE,
		body: BODY,
		explain: BODY,
		decoration: DECO,
	};
	const expectFontsByContractRole = (pageNo: number) => {
		const page = book.pages[pageNo]!;
		const template = catalog.get(page.templateId);
		assert.ok(template, `模板 ${page.templateId} 不在目录里`);
		for (const [slotId, def] of template.textDefsByBase) {
			for (const key of Object.keys(page.texts)) {
				if (!key.endsWith("#artFont")) continue;
				const base = key.slice(0, -"#artFont".length).replace(/\[\d+\]$/, "");
				if (base !== slotId) continue;
				assert.equal(
					page.texts[key],
					fontForRole[def.role],
					`page${pageNo} ${page.templateId}/${key}(${def.role}) 的字体不对`,
				);
			}
		}
	};
	expectFontsByContractRole(0);   // 封面:title/decoration/body/explain 四种 role 齐全
	expectFontsByContractRole(2);   // 重复槽页:explain[n] 每个都要刷到
	expectFontsByContractRole(5);

	// 文字内容本身不被动过。
	assert.equal(typeof book.pages[0]!.texts.title, "string");
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
	const catalog = loadTemplateCatalog();
	const cover = book.pages[0]!;
	// 只有 decoration 槽被改字体;其余 role 一律不动。从契约取 role,别写死槽 id。
	const template = catalog.get(cover.templateId);
	assert.ok(template);
	for (const [slotId, def] of template.textDefsByBase) {
		if (!(slotId in cover.texts)) continue;
		assert.equal(
			cover.texts[`${slotId}#artFont`],
			def.role === "decoration" ? "jetbrains-mono" : undefined,
			`${cover.templateId}/${slotId}(${def.role}) 的字体不该被动`,
		);
	}
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
