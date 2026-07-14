import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
	type AlbumBookState,
	cloneAlbumBookState,
	parseAlbumBookInput,
	validateAlbumBook,
} from "../src/core/album/book-state.ts";
import { loadTemplateCatalog } from "../src/core/album/templates-catalog.ts";
import { type AlbumToolsOptions, createAlbumTools } from "../src/core/album/tools.ts";

const fixturePath = fileURLToPath(new URL("../fixtures/sample-book.json", import.meta.url));

function loadFixtureBook(): AlbumBookState {
	return parseAlbumBookInput(JSON.parse(readFileSync(fixturePath, "utf8"))).book;
}

function createHarness(): {
	tools: Map<string, AgentTool>;
	getBook: () => AlbumBookState;
} {
	const catalog = loadTemplateCatalog();
	let book = loadFixtureBook();
	const options: AlbumToolsOptions = {
		catalog,
		getBookState: () => cloneAlbumBookState(book),
		setBookState: (next) => {
			book = cloneAlbumBookState(next);
		},
		now: () => new Date("2026-07-07T00:00:00.000Z"),
	};
	const tools = new Map(createAlbumTools(options).map((tool) => [tool.name, tool as AgentTool]));
	return { tools, getBook: () => book };
}

async function run(tools: Map<string, AgentTool>, name: string, input: unknown): Promise<string> {
	const tool = tools.get(name);
	assert.ok(tool, `tool ${name} 不存在`);
	const params = tool.prepareArguments ? tool.prepareArguments(input) : input;
	const result = await tool.execute("test-call", params as never);
	const text = result.content
		.filter((block): block is { type: "text"; text: string } => block.type === "text")
		.map((block) => block.text)
		.join("\n");
	return text;
}

test("模板目录层加载全部模板并展开重复槽", () => {
	const catalog = loadTemplateCatalog();
	assert.ok(catalog.ids().length >= 40, `模板数量 ${catalog.ids().length} 少于预期`);

	const mag10 = catalog.get("mag-10");
	assert.ok(mag10);
	assert.deepEqual(mag10.imageSlotIds, ["image[0]", "image[1]", "image[2]", "image[3]"]);
	const explainDef = mag10.textDefsByBase.get("explain");
	assert.ok(explainDef, "items.texts 的 explain 定义应可查到");
	assert.equal(explainDef.role, "explain");

	const interiorSingles = catalog.list({ category: "interior", imageSlotCount: 1 });
	assert.ok(interiorSingles.length >= 2);
	assert.ok(interiorSingles.every((entry) => entry.category === "interior" && entry.imageSlotIds.length === 1));
});

test("样本书 fixture 契约合法", () => {
	const catalog = loadTemplateCatalog();
	const book = loadFixtureBook();
	assert.deepEqual(validateAlbumBook(book, catalog), []);
});

test("read_page 省略 pageNos 返回全书所有页", async () => {
	const { tools } = createHarness();
	const result = JSON.parse(await run(tools, "read_page", {}));
	assert.equal(result.pages.length, 6);
	assert.equal(result.pages[0].templateId, "mag-01");
	assert.equal(result.pages[0].category, "cover");
});

test("read_page 多页一次返回", async () => {
	const { tools } = createHarness();
	const result = JSON.parse(await run(tools, "read_page", { pageNos: [1, 3] }));
	assert.equal(result.pages.length, 2);
	assert.equal(result.pages[0].pageNo, 1);
	assert.equal(result.pages[1].pageNo, 3);
});

test("read_page 返回槽位定义,且不暴露 chapter 概念(AI 上下文去冗余)", async () => {
	const { tools } = createHarness();
	const page = JSON.parse(await run(tools, "read_page", { pageNo: 1 })).pages[0];
	assert.equal(page.templateId, "mag-05");
	// chapter 是分簇/写文案的内部工具,不进 AI 上下文(2026-07-11 拍板)。
	assert.equal(page.chapter, undefined);
	const titleDef = page.textSlotDefs.find((def: { slotId: string }) => def.slotId === "title");
	// 槽位定义只有角色和示范文案 —— 没有字数上限(模板已不声明)。
	assert.equal(titleDef.role, "title");
	assert.ok(!("maxChars" in titleDef), "不该再给 AI 发字数上限");
	assert.ok(page.images.image.sceneDescription.includes("海平线"));
});

test("update_page_texts 合法写入并递增版本", async () => {
	const { tools, getBook } = createHarness();
	const before = getBook().version;
	const details = JSON.parse(
		await run(tools, "update_page_texts", {
			pageNo: 1,
			texts: { title: "海的那一边", explain: "爸爸在海边站了很久，什么也没说。" },
		}),
	);
	assert.equal(details.version, before + 1);
	const page = getBook().pages.find((candidate) => candidate.pageIndex === 1);
	assert.equal(page?.texts.title, "海的那一边");
});

test("update_page_texts 超长文案照收,一字不改(不做字数校验)", async () => {
	// 全链路无字数校验:写多长都不拒收、不截断,
	// 版面装不下由渲染层的 fit-text(固定高度文字框自动缩字号)解决。
	const { tools, getBook } = createHarness();
	const long = "这是一个远远超过二十四个字符上限的超长标题所以过去会被契约校验拒绝掉";

	await run(tools, "update_page_texts", { pageNo: 1, texts: { title: long } });

	assert.equal(getBook().pages[1].texts.title, long, "原文必须一字不动地存下来");
});

test("update_page_texts 未知槽被拒绝并列出可用槽", async () => {
	const { tools } = createHarness();
	await assert.rejects(run(tools, "update_page_texts", { pageNo: 4, texts: { headline: "x" } }), /没有文字槽 "headline"/);
});

test("update_page_texts 接受主题 carrier 键", async () => {
	const { tools, getBook } = createHarness();
	await run(tools, "update_page_texts", { pageNo: 1, texts: { "title#accentColor": "#2c6e8f" } });
	const page = getBook().pages.find((candidate) => candidate.pageIndex === 1);
	assert.equal(page?.texts["title#accentColor"], "#2c6e8f");
});

test("update_page_texts 一次改多页多槽", async () => {
	const { tools, getBook } = createHarness();
	const before = getBook().version;
	const details = JSON.parse(
		await run(tools, "update_page_texts", {
			updates: [
				{ pageNo: 1, texts: { title: "海的那一边" } },
				{ pageNo: 4, texts: { body: "奶奶在灶台边忙碌。" } },
			],
		}),
	);
	assert.equal(details.version, before + 1, "多页写入只递增一次版本");
	assert.equal(getBook().pages[1]?.texts.title, "海的那一边");
	assert.equal(getBook().pages[4]?.texts.body, "奶奶在灶台边忙碌。");
});

test("update_page_texts 批量中任一页非法则整批拒绝", async () => {
	// 原子性仍然守住。非法 = 结构性错误(槽不存在),不再是「字数超了」。
	const { tools, getBook } = createHarness();
	const before = getBook().version;
	await assert.rejects(
		run(tools, "update_page_texts", {
			updates: [
				{ pageNo: 1, texts: { title: "合法标题" } },
				{ pageNo: 1, texts: { headline: "这个槽在模板里不存在" } },
			],
		}),
		/没有文字槽 "headline"/,
	);
	assert.equal(getBook().version, before, "整批非法不改变状态");
});

test("swap_page_template 同类目同图槽数迁移，多余文字槽丢弃并报告", async () => {
	const { tools, getBook } = createHarness();
	await run(tools, "update_page_texts", { pageNo: 3, texts: { title: "灶台边", explain: "案板上的五花肉和冰糖。" } });
	const details = JSON.parse(await run(tools, "swap_page_template", { pageNo: 3, templateId: "mag-53" }));
	assert.deepEqual(details.operations, ["template:mag-05->mag-53"]);
	assert.ok(details.notes.some((note: string) => note.includes('"explain"')), "应报告 explain 被移除");
	const page = getBook().pages.find((candidate) => candidate.pageIndex === 3);
	assert.equal(page?.templateId, "mag-53");
	assert.equal(page?.texts.title, "灶台边");
	assert.equal(page?.texts.explain, undefined);
	assert.deepEqual(page?.images, { image: "p-kit-02" });
});

test("swap_page_template 拒绝跨类目与图槽数不匹配", async () => {
	const { tools } = createHarness();
	await assert.rejects(run(tools, "swap_page_template", { pageNo: 1, templateId: "mag-01" }), /类目不匹配/);
	await assert.rejects(run(tools, "swap_page_template", { pageNo: 1, templateId: "mag-10" }), /图槽数不匹配/);
});

test("update_page_images 整页替换并校验槽位齐全/照片存在/不重复", async () => {
	const { tools, getBook } = createHarness();
	await run(tools, "update_page_images", {
		pageNo: 2,
		images: { "image[0]": "p-sea-04", "image[1]": "p-sea-02", "image[2]": "p-sea-03", "image[3]": "p-sea-05" },
	});
	const page = getBook().pages.find((candidate) => candidate.pageIndex === 2);
	assert.equal(page?.images["image[0]"], "p-sea-04");

	await assert.rejects(
		run(tools, "update_page_images", { pageNo: 2, images: { "image[0]": "p-sea-04" } }),
		/缺少图片槽/,
	);
	await assert.rejects(
		run(tools, "update_page_images", {
			pageNo: 2,
			images: { "image[0]": "p-sea-04", "image[1]": "p-sea-04", "image[2]": "p-sea-03", "image[3]": "p-sea-05" },
		}),
		/同时出现在槽/,
	);
	await assert.rejects(
		run(tools, "update_page_images", {
			pageNo: 2,
			images: { "image[0]": "p-nope", "image[1]": "p-sea-02", "image[2]": "p-sea-03", "image[3]": "p-sea-05" },
		}),
		/不存在于这本书/,
	);
});

test("search_book 命中页文字与照片描述;章节背景不再进搜索面", async () => {
	const { tools } = createHarness();
	await run(tools, "update_page_texts", { pageNo: 4, texts: { body: "奶奶的手覆着我的手，锅铲一起一落。" } });
	const hits = (await run(tools, "search_book", { query: "奶奶" }))
		.split("\n")
		.map((line) => JSON.parse(line) as { where: string });
	assert.ok(hits.some((hit) => hit.where === "pageText"));
	assert.ok(hits.some((hit) => hit.where === "photo"));
	// chapter 概念不进 AI 上下文:章节背景不参与搜索,命中结果也不再带 chapter 项。
	assert.equal(hits.some((hit) => hit.where === "chapter"), false);
});

test("list_templates 按类目和图槽数过滤", async () => {
	const { tools } = createHarness();
	const lines = (await run(tools, "list_templates", { category: "interior", imageSlotCount: 1 }))
		.split("\n")
		.map((line) => JSON.parse(line) as { templateId: string; category: string; imageSlotCount: number });
	assert.ok(lines.length >= 2);
	assert.ok(lines.every((entry) => entry.category === "interior" && entry.imageSlotCount === 1));
});

test("写入工具带 terminate 语义", async () => {
	const { tools } = createHarness();
	const tool = tools.get("update_page_texts");
	assert.ok(tool);
	const result = await tool.execute("test-call", { updates: [{ pageNo: 4, texts: { body: "短句。" } }] } as never);
	assert.equal(result.terminate, true);
});

test("pageNo 寻址在 pageIndex 重复时仍然可用（真实管线按章节计数）", async () => {
	const catalog = loadTemplateCatalog();
	let book = parseAlbumBookInput({
		chapters: [
			{ chapterId: "c1", photos: [{ photoId: "pa", sceneDescription: "照片A" }] },
			{ chapterId: "c2", photos: [{ photoId: "pb", sceneDescription: "照片B" }] },
		],
		pages: [
			{ pageIndex: 0, templateId: "mag-30", images: { image: "pa" }, texts: { body: "" } },
			{ pageIndex: 0, templateId: "mag-30", images: { image: "pb" }, texts: { body: "" } },
		],
	}).book;
	const options: AlbumToolsOptions = {
		catalog,
		getBookState: () => cloneAlbumBookState(book),
		setBookState: (next) => {
			book = cloneAlbumBookState(next);
		},
	};
	const tools = new Map(createAlbumTools(options).map((tool) => [tool.name, tool as AgentTool]));

	const summary = JSON.parse(await run(tools, "read_page", {}));
	// 用户口径:两页都是内页 → 1、2;管线原始 pageIndex(重复的 0)不再喂给模型。
	assert.deepEqual(
		summary.pages.map((p: { pageNo: number; pageIndex?: number }) => [p.pageNo, p.pageIndex]),
		[
			[1, undefined],
			[2, undefined],
		],
	);

	const page1 = JSON.parse(await run(tools, "read_page", { pageNo: 2 })).pages[0];
	assert.equal(page1.images.image.photoId, "pb");

	await run(tools, "update_page_texts", { pageNo: 2, texts: { body: "第二本的图注。" } });
	assert.equal(book.pages[1]?.texts.body, "第二本的图注。");
	assert.equal(book.pages[0]?.texts.body, "");
	assert.equal(book.pages[1]?.pageIndex, 0, "原始 pageIndex 字段保持不变");

	await assert.rejects(run(tools, "read_page", { pageNo: 3 }), /内页 1\.\.2/);
});
