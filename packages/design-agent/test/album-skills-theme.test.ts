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
import { createDefaultAlbumSkills } from "../src/core/album/skills.ts";
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

test("文件化 skills 从 skills/ 目录加载七个技能", () => {
	const skills = loadAlbumSkills();
	const names = skills.map((skill) => skill.name).sort();
	assert.deepEqual(
		names,
		["页面HTML编辑", "照片处理", "相册字体", "相册排版", "相册文案", "相册配色", "风格理解"].sort(),
	);
	const photos = skills.find((skill) => skill.name === "照片处理");
	assert.ok(photos?.content.includes("set_image_pos"), "照片技能应指向 set_image_pos 工具");
	assert.ok(photos?.filePath.endsWith("SKILL.md"));
	const pageHtml = skills.find((skill) => skill.name === "页面HTML编辑");
	assert.ok(pageHtml?.content.includes("write_page_html"), "HTML 编辑技能应指向 write_page_html 工具");
	assert.ok(pageHtml?.filePath.endsWith("SKILL.md"));
	const color = skills.find((skill) => skill.name === "相册配色");
	assert.ok(color?.content.includes("set_text_colors"), "配色技能应指向 set_text_colors 工具");
	assert.ok(color?.filePath.endsWith("SKILL.md"));
	const font = skills.find((skill) => skill.name === "相册字体");
	assert.ok(font?.content.includes("set_text_fonts"), "字体技能应指向 set_text_fonts 工具");
	assert.ok(font?.filePath.endsWith("SKILL.md"));
});

test("内置兜底技能在 skills/ 目录都有对应文件(防止代码加技能漏建 SKILL.md)", () => {
	const fileSkillNames = new Set(loadAlbumSkills().map((skill) => skill.name));
	for (const fallback of createDefaultAlbumSkills()) {
		assert.ok(
			fileSkillNames.has(fallback.name),
			`内置技能「${fallback.name}」缺少 contracts/skills/<name>/SKILL.md,生产环境永远加载不到它`,
		);
	}
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
	const CAPTION = "#6b6658"; // 对白底对比度 5.73:1（原 #8a8577 只有 3.68:1，被 set_text_colors 的对比度硬校验打回）
	const result = await tool.execute("t1", {
		titleColor: TITLE,
		bodyColor: BODY,
		captionColor: CAPTION,
	} as never);
	assert.equal(result.terminate, true);

	const book = getBook();
	// role → 色的映射:title/decoration → 标题色;body → 正文色;explain → 注释色。
	// 【不写死哪个槽是什么 role】—— 模板台能改 role,写死会烂成假前提。从契约取。
	const catalog = loadTemplateCatalog();
	const colorForRole: Record<string, string> = {
		title: TITLE,
		decoration: TITLE,
		body: BODY,
		explain: CAPTION,
	};
	const expectColorsByContractRole = (pageNo: number) => {
		const page = book.pages[pageNo]!;
		const template = catalog.get(page.templateId);
		assert.ok(template, `模板 ${page.templateId} 不在目录里`);
		for (const [slotId, def] of template.textDefsByBase) {
			const key = `${slotId}#accentColor`;
			if (!(key in page.texts)) continue; // 该页没渲染这个槽
			assert.equal(
				page.texts[key],
				colorForRole[def.role],
				`page${pageNo} ${page.templateId}/${slotId}(${def.role}) 的强调色不对`,
			);
		}
	};
	expectColorsByContractRole(0);
	expectColorsByContractRole(5);
	const cover = book.pages[0]!;
	assert.equal(cover.texts["title#accentColor"], TITLE);
	assert.equal(cover.texts["label#accentColor"], TITLE);
	// page2 mag-10：重复槽 explain[n] 每个都要上注释色。
	const repeatPage = book.pages[2]!;
	assert.equal(repeatPage.texts["explain[0]#accentColor"], CAPTION);
	assert.equal(repeatPage.texts["explain[3]#accentColor"], CAPTION);
	// page5 的逐槽核对已由上面的 expectColorsByContractRole(5) 覆盖。

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
	await tool.execute("t1", { captionColor: "#6b6658" } as never);

	const book = getBook();
	const catalog = loadTemplateCatalog();
	const cover = book.pages[0]!;
	// 只有 explain 槽被染色;title/body/decoration 一律不动。从契约取 role,别写死。
	const coverTemplate = catalog.get(cover.templateId);
	assert.ok(coverTemplate);
	for (const [slotId, def] of coverTemplate.textDefsByBase) {
		const key = `${slotId}#accentColor`;
		if (!(slotId in cover.texts)) continue;
		assert.equal(
			cover.texts[key],
			def.role === "explain" ? "#6b6658" : undefined,
			`${cover.templateId}/${slotId}(${def.role}) 的染色不对`,
		);
	}
	// page5 同样逐槽核对（explain 槽染色，其余不动）。
	const richPage = book.pages[5]!;
	const richTemplate = catalog.get(richPage.templateId);
	assert.ok(richTemplate);
	for (const [slotId, def] of richTemplate.textDefsByBase) {
		if (!(slotId in richPage.texts)) continue;
		assert.equal(
			richPage.texts[`${slotId}#accentColor`],
			def.role === "explain" ? "#6b6658" : undefined,
			`${richPage.templateId}/${slotId}(${def.role}) 的染色不对`,
		);
	}
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
