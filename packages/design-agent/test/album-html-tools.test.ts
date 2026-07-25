import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
	type AlbumBookState,
	cloneAlbumBookState,
	parseAlbumBookInput,
} from "../src/core/album/book-state.ts";
import { loadTemplateCatalog } from "../src/core/album/templates-catalog.ts";
import { type AlbumToolsOptions, createAlbumTools } from "../src/core/album/tools.ts";

// C 方案工具面:read_page 显式 includeHtml 才带 html(#307 默认不发,省 token)、
// write_page_html 守门写入、update_page_texts 原位 patch html、swap_page_template
// 重烘 html。本文件测的都是「确实要动 html」的链路,所以一律显式 includeHtml:true。

const fixturePath = fileURLToPath(new URL("../fixtures/sample-book.json", import.meta.url));

function createHarness(): { tools: Map<string, AgentTool>; getBook: () => AlbumBookState } {
	const catalog = loadTemplateCatalog();
	let book = parseAlbumBookInput(JSON.parse(readFileSync(fixturePath, "utf8"))).book;
	const options: AlbumToolsOptions = {
		catalog,
		getBookState: () => cloneAlbumBookState(book),
		setBookState: (next) => {
			book = cloneAlbumBookState(next);
		},
		now: () => new Date("2026-07-11T00:00:00.000Z"),
	};
	const tools = new Map(createAlbumTools(options).map((tool) => [tool.name, tool as AgentTool]));
	return { tools, getBook: () => book };
}

async function run(tools: Map<string, AgentTool>, name: string, input: unknown): Promise<string> {
	const tool = tools.get(name);
	assert.ok(tool, `tool ${name} 不存在`);
	const params = tool.prepareArguments ? tool.prepareArguments(input) : input;
	const result = await tool.execute("test-call", params as never);
	return result.content
		.filter((block): block is { type: "text"; text: string } => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

test("read_page 返回页面 html(存量页现场烘)", async () => {
	const { tools } = createHarness();
	const text = await run(tools, "read_page", { pageNos: ["cover"], includeHtml: true });
	const payload = JSON.parse(text) as { pages: Array<{ html?: string; templateId: string }> };
	const page = payload.pages[0]!;
	assert.equal(typeof page.html, "string");
	assert.ok(page.html!.includes(`data-template="${page.templateId}"`));
	assert.ok(page.html!.includes("{{IMG_SRC:"), "图片 src 应保持 token");
});

test("write_page_html:合法整页改写落库,texts 从 html 派生", async () => {
	const { tools, getBook } = createHarness();
	const read = JSON.parse(await run(tools, "read_page", { pageNos: ["cover"], includeHtml: true })) as {
		pages: Array<{ html: string }>;
	};
	const custom = read.pages[0]!.html
		.replace(/>([^<]*)<\/div>\s*$/, ">$1</div>")
		.replace("data-text-key=\"title\"", "data-text-key=\"title\" data-ai-touched=\"1\"");
	const withNewTitle = custom.replace(
		/(data-text-key="title"[^>]*>)[^<]*/,
		"$1盐与海风的下午",
	);

	await run(tools, "write_page_html", { pageNo: "cover", html: withNewTitle });

	const book = getBook();
	assert.ok(book.pages[0]!.html!.includes("data-ai-touched"));
	assert.equal(book.pages[0]!.texts.title, "盐与海风的下午", "texts 未从 html 派生");
});

test("write_page_html:删锚点被拒且不改状态", async () => {
	const { tools, getBook } = createHarness();
	const read = JSON.parse(await run(tools, "read_page", { pageNos: ["cover"], includeHtml: true })) as {
		pages: Array<{ html: string }>;
	};
	const before = JSON.stringify(getBook().pages[0]);
	const broken = read.pages[0]!.html.replace(/<[^>]*data-text-key="title"[^>]*>[^<]*<\/[a-z0-9]+>/, "");
	await assert.rejects(
		() => run(tools, "write_page_html", { pageNo: "cover", html: broken }),
		/title/,
	);
	assert.equal(JSON.stringify(getBook().pages[0]), before);
});

test("update_page_texts:原位 patch html,保留手工版面标记", async () => {
	const { tools, getBook } = createHarness();
	const read = JSON.parse(await run(tools, "read_page", { pageNos: ["cover"], includeHtml: true })) as {
		pages: Array<{ html: string }>;
	};
	const custom = read.pages[0]!.html.replace(
		'data-text-key="title"',
		'data-text-key="title" data-ai-touched="1"',
	);
	await run(tools, "write_page_html", { pageNo: "cover", html: custom });

	await run(tools, "update_page_texts", { updates: [{ pageNo: "cover", texts: { title: "改字不丢版面" } }] });

	const page = getBook().pages[0]!;
	assert.ok(page.html!.includes('data-ai-touched="1"'), "手工版面标记被丢了(不该重烘)");
	assert.ok(page.html!.includes("改字不丢版面"));
	assert.equal(page.texts.title, "改字不丢版面");
});

test("swap_page_template:html 按新模板重烘", async () => {
	const { tools, getBook } = createHarness();
	const page0 = getBook().pages[0]!;
	const catalog = loadTemplateCatalog();
	const current = catalog.get(page0.templateId)!;
	const alternative = catalog
		.list({ category: current.category, imageSlotCount: Object.keys(page0.images).length })
		.find((tpl) => tpl.id !== page0.templateId);
	if (!alternative) return; // fixture 无同类候选则跳过

	const text = await run(tools, "swap_page_template", { pageNo: "cover", templateId: alternative.id });
	assert.match(text, /重新生成/);
	const page = getBook().pages[0]!;
	assert.ok(page.html!.includes(`data-template="${alternative.id}"`));
});
