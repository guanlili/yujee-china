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
import { loadAlbumSkills, parseSkillMarkdown } from "../src/core/album/skills-loader.ts";
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

test("文件化 skills 从 skills/ 目录加载四个技能", () => {
	const skills = loadAlbumSkills();
	const names = skills.map((skill) => skill.name).sort();
	assert.deepEqual(names, ["相册字体", "相册排版", "相册文案", "相册配色"].sort());
	const color = skills.find((skill) => skill.name === "相册配色");
	assert.ok(color?.content.includes("set_text_colors"), "配色技能应指向 set_text_colors 工具");
	assert.ok(color?.filePath.endsWith("SKILL.md"));
	const font = skills.find((skill) => skill.name === "相册字体");
	assert.ok(font?.content.includes("set_text_fonts"), "字体技能应指向 set_text_fonts 工具");
	assert.ok(font?.filePath.endsWith("SKILL.md"));
});

test("SKILL.md frontmatter 解析：缺字段/无 frontmatter 返回 undefined", () => {
	assert.ok(parseSkillMarkdown("---\nname: A\ndescription: B\n---\n正文", "/x/SKILL.md"));
	assert.equal(parseSkillMarkdown("没有 frontmatter 的裸文本", "/x/SKILL.md"), undefined);
	assert.equal(parseSkillMarkdown("---\nname: A\n---\n正文", "/x/SKILL.md"), undefined);
});

test("set_text_colors：三类颜色按角色刷满全书，decoration 跟标题，重复槽也覆盖，契约合法", async () => {
	const { tools, getBook } = createHarness();
	const tool = tools.get("set_text_colors");
	assert.ok(tool);
	const TITLE = "#2c6e8f";
	const BODY = "#7a4b2a";
	const CAPTION = "#8a8577";
	const result = await tool.execute("t1", {
		titleColor: TITLE,
		bodyColor: BODY,
		captionColor: CAPTION,
	} as never);
	assert.equal(result.terminate, true);

	const book = getBook();
	// page0 mag-01：title(title)/label(decoration)/folio(decoration) → 标题色；explain1/2(explain) → 注释色。
	const cover = book.pages[0]!;
	assert.equal(cover.texts["title#accentColor"], TITLE);
	assert.equal(cover.texts["label#accentColor"], TITLE);
	assert.equal(cover.texts["folio#accentColor"], TITLE);
	assert.equal(cover.texts["explain1#accentColor"], CAPTION);
	assert.equal(cover.texts["explain2#accentColor"], CAPTION);
	// page2 mag-10：重复槽 explain[n] 每个都要上注释色。
	const repeatPage = book.pages[2]!;
	assert.equal(repeatPage.texts["explain[0]#accentColor"], CAPTION);
	assert.equal(repeatPage.texts["explain[3]#accentColor"], CAPTION);
	assert.equal(repeatPage.texts["folio#accentColor"], TITLE);
	// page5 mag-25：body(body) → 正文色；date(decoration) → 标题色。
	const richPage = book.pages[5]!;
	assert.equal(richPage.texts["body#accentColor"], BODY);
	assert.equal(richPage.texts["date#accentColor"], TITLE);
	assert.equal(richPage.texts["title#accentColor"], TITLE);
	assert.equal(richPage.texts["explain#accentColor"], CAPTION);

	// 文字内容本身不被动过。
	assert.equal(typeof cover.texts.title, "string");
	assert.ok(!("蓝色" in cover.texts));

	for (const page of book.pages) {
		const parsed = Page.safeParse(page);
		assert.ok(parsed.success, JSON.stringify(parsed.success ? "" : parsed.error.issues));
	}
});

test("set_text_colors：只给注释色时，标题/正文/装饰槽不被染色", async () => {
	const { tools, getBook } = createHarness();
	const tool = tools.get("set_text_colors");
	assert.ok(tool);
	await tool.execute("t1", { captionColor: "#8a8577" } as never);

	const book = getBook();
	const cover = book.pages[0]!;
	assert.equal(cover.texts["explain1#accentColor"], "#8a8577");
	assert.equal(cover.texts["title#accentColor"], undefined);
	assert.equal(cover.texts["label#accentColor"], undefined);
	const richPage = book.pages[5]!;
	assert.equal(richPage.texts["body#accentColor"], undefined);
	assert.equal(richPage.texts["explain#accentColor"], "#8a8577");
});

test("set_text_colors：一个颜色都不给 / 非法十六进制被拒绝", async () => {
	const { tools } = createHarness();
	const tool = tools.get("set_text_colors");
	assert.ok(tool);
	await assert.rejects(tool.execute("t1", {} as never), /至少要给/);
	await assert.rejects(
		tool.execute("t2", { titleColor: "蓝色" } as never),
		/#RGB\/#RRGGBB/,
	);
});
