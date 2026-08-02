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
	return { tools, getBook: () => book };
}

function templateOrder(book: AlbumBookState): string {
	return book.pages.map((p) => p.templateId).join(",");
}

test("move_pages:内页 4 挪到内页 1 后面,页内容逐字段不动,version+1", async () => {
	const { tools, getBook } = createHarness();
	const tool = tools.get("move_pages");
	assert.ok(tool, "move_pages 工具必须注册");
	const before = getBook();
	const beforeJson = new Map(before.pages.map((p) => [p.pageIndex, JSON.stringify(p)]));

	const args = tool.prepareArguments({ operations: [{ type: "move", pageNo: 4, after: 1 }] });
	const result = await tool.execute("t1", args as never);
	assert.equal(result.terminate, true);

	const after = getBook();
	assert.equal(templateOrder(after), "mag-01,mag-05,mag-30,mag-10,mag-05,mag-22");
	assert.equal(after.version, before.version + 1);
	// 单纯挪位置:每页序列化后与挪动前逐字节一致(按 pageIndex 对上)。
	for (const page of after.pages) {
		assert.equal(JSON.stringify(page), beforeJson.get(page.pageIndex));
	}
	for (const page of after.pages) assert.ok(Page.safeParse(page).success, "挪后仍过 contracts Page 契约");
});

test("move_pages:swap 两内页 + after:'cover' 挪到最前(批量一次调用)", async () => {
	const { tools, getBook } = createHarness();
	const tool = tools.get("move_pages")!;
	const args = tool.prepareArguments({
		operations: [
			{ type: "swap", a: 1, b: 2 },
			{ type: "move", pageNo: 4, after: "cover" },
		],
	});
	await tool.execute("t2", args as never);
	// 原序 内页[05,10,05,30] → swap(1,2)=[10,05,05,30] → move 原内页4(mag-30) 到最前=[30,10,05,05]
	assert.equal(templateOrder(getBook()), "mag-01,mag-30,mag-10,mag-05,mag-05,mag-22");
});

test("move_pages:结果 notes 报新旧页码映射", async () => {
	const { tools } = createHarness();
	const tool = tools.get("move_pages")!;
	const args = tool.prepareArguments({ operations: [{ type: "move", pageNo: 4, after: 1 }] });
	const result = await tool.execute("t3", args as never);
	const details = result.details as { operations: string[]; notes?: string[] };
	assert.ok(details.operations.length === 1);
	assert.ok(details.notes?.some((n) => n.includes("第 4 页") && n.includes("第 2 页")), "notes 要有 原第4页→现第2页");
});

test("move_pages:拒绝封面作源/拒绝恒等净效果/拒绝未知引用,拒绝时书不变", async () => {
	const { tools, getBook } = createHarness();
	const tool = tools.get("move_pages")!;
	const before = templateOrder(getBook());
	const cases = [
		{ operations: [{ type: "move", pageNo: "cover", after: 2 }] },
		{ operations: [{ type: "swap", a: 1, b: 2 }, { type: "swap", a: 1, b: 2 }] },
		{ operations: [{ type: "move", pageNo: 99, after: 1 }] },
	];
	for (const input of cases) {
		const args = tool.prepareArguments(input);
		await assert.rejects(() => tool.execute("t4", args as never));
		assert.equal(templateOrder(getBook()), before, "拒绝后页序不变");
	}
	assert.equal(getBook().version, 1, "拒绝不涨版本");
});
