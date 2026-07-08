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

test("文件化 skills 从 skills/ 目录加载三个技能", () => {
	const skills = loadAlbumSkills();
	const names = skills.map((skill) => skill.name).sort();
	assert.deepEqual(names, ["相册排版", "相册文案", "相册配色"].sort());
	const color = skills.find((skill) => skill.name === "相册配色");
	assert.ok(color?.content.includes("set_chapter_theme"), "配色技能应指向 set_chapter_theme 工具");
	assert.ok(color?.filePath.endsWith("SKILL.md"));
});

test("SKILL.md frontmatter 解析：缺字段/无 frontmatter 返回 undefined", () => {
	assert.ok(parseSkillMarkdown("---\nname: A\ndescription: B\n---\n正文", "/x/SKILL.md"));
	assert.equal(parseSkillMarkdown("没有 frontmatter 的裸文本", "/x/SKILL.md"), undefined);
	assert.equal(parseSkillMarkdown("---\nname: A\n---\n正文", "/x/SKILL.md"), undefined);
});

test("set_chapter_theme：章节色散布到该章页面的 variableDecor 槽并保持契约合法", async () => {
	const { tools, getBook } = createHarness();
	const tool = tools.get("set_chapter_theme");
	assert.ok(tool);
	const result = await tool.execute("t1", { chapterId: "ch-seaside", accentColor: "#2c6e8f" } as never);
	assert.equal(result.terminate, true);

	const book = getBook();
	assert.equal(book.chapters.find((c) => c.chapterId === "ch-seaside")?.accentColor, "#2c6e8f");

	// 第 1 页（数组 pages[0]，mag-01：title/label 为 variableDecor）应带 carrier 键。
	const cover = book.pages[0]!;
	assert.equal(cover.texts["title#accentColor"], "#2c6e8f");
	assert.equal(cover.texts["label#accentColor"], "#2c6e8f");
	// 厨房章（ch-kitchen）的页面不应被波及。
	const kitchenPage = book.pages[3]!;
	assert.equal(kitchenPage.texts["title#accentColor"], undefined);

	for (const page of book.pages) {
		const parsed = Page.safeParse(page);
		assert.ok(parsed.success, JSON.stringify(parsed.success ? "" : parsed.error.issues));
	}
});

test("set_chapter_theme：非法颜色与未知章节被拒绝", async () => {
	const { tools } = createHarness();
	const tool = tools.get("set_chapter_theme");
	assert.ok(tool);
	await assert.rejects(
		tool.execute("t1", { chapterId: "ch-seaside", accentColor: "蓝色" } as never),
		/#RGB\/#RRGGBB/,
	);
	await assert.rejects(
		tool.execute("t2", { chapterId: "ch-nope", accentColor: "#123456" } as never),
		/现有章节/,
	);
});
