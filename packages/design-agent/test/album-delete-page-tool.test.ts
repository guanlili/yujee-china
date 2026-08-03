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

/* delete_page(2026-08-03 设计:docs/specs/2026-08-03-delete-page-design.md):
   只删内页,照片随页移除不回流,拒删封面/目录/封尾,拒删到内页数为 0。
   与 move_pages 同口径:只动 pages 数组,余页对象逐字节不变(pageIndex 不重写,
   落库行序由 web 侧 persistDesignChat 按数组位置重编号)。 */

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
	const isInterior = (templateId: string) => {
		const category = catalog.get(templateId)?.category;
		return category === undefined || !["cover", "toc", "ending"].includes(category);
	};
	return { tools, getBook: () => book, isInterior };
}

test("delete_page:删内页 2,页数-1,余页序列化逐字节不变(pageIndex 不重写),version+1,终结本轮", async () => {
	const { tools, getBook } = createHarness();
	const tool = tools.get("delete_page");
	assert.ok(tool, "delete_page 工具必须注册");
	const before = getBook();
	const beforeJsons = before.pages.map((p) => JSON.stringify(p));

	const args = tool.prepareArguments({ pageNo: 2 });
	const result = await tool.execute("t1", args as never);
	assert.equal(result.terminate, true, "写入后本轮即结束(commitWrite 口径)");

	const after = getBook();
	assert.equal(after.pages.length, before.pages.length - 1, "删一页,页数-1");
	assert.equal(after.version, before.version + 1);
	// 内页 2 = 数组里第 3 个元素(封面不占号):删除后其余页原样(逐字节)。
	const expected = beforeJsons.filter((_, index) => index !== 2);
	assert.deepEqual(
		after.pages.map((p) => JSON.stringify(p)),
		expected,
		"余页必须逐字节不变 —— 不重写 pageIndex,不碰 html",
	);
	for (const page of after.pages) assert.ok(Page.safeParse(page).success, "删后仍过 contracts Page 契约");
});

test("delete_page:照片随页移除,回执说明照片数与翻面效应", async () => {
	const { tools, getBook } = createHarness();
	const tool = tools.get("delete_page")!;
	const before = getBook();
	const target = before.pages[1]; // 内页 1
	const photoCount = Object.keys(target.images).length;

	const result = await tool.execute("t1", tool.prepareArguments({ pageNo: 1 }) as never);
	const text = result.content.map((c) => ("text" in c ? c.text : "")).join("");
	assert.match(text, new RegExp(`${photoCount} 张照片一并移除`), "回执要说清照片随页移除");
	assert.match(text, /左右位置|不移位|双宽/, "回执要说明翻面效应");

	// 不回流:余页与删除前逐字节一致(照片没有被挪进任何其他页),被删页整个消失。
	const after = getBook();
	assert.deepEqual(
		after.pages.map((p) => JSON.stringify(p)),
		before.pages.filter((p) => p !== target).map((p) => JSON.stringify(p)),
	);
});

test("delete_page:封面/封尾拒删,越界报可用页码,零写入", async () => {
	const { tools, getBook } = createHarness();
	const tool = tools.get("delete_page")!;
	const before = getBook();

	await assert.rejects(tool.execute("t1", tool.prepareArguments({ pageNo: "cover" }) as never), /不可删除/);
	await assert.rejects(tool.execute("t2", tool.prepareArguments({ pageNo: "ending" }) as never), /不可删除/);
	await assert.rejects(tool.execute("t3", tool.prepareArguments({ pageNo: 99 }) as never), /可用页码/);

	const after = getBook();
	assert.equal(after.version, before.version, "拒绝路径零写入");
	assert.equal(after.pages.length, before.pages.length);
});

test("delete_page:拒绝删掉最后一张内页", async () => {
	const { tools, getBook, isInterior } = createHarness();
	const tool = tools.get("delete_page")!;
	const interiorCount = getBook().pages.filter((p) => isInterior(p.templateId)).length;
	// 逐张删到只剩一张(每次都删「内页 1」,后续页码自动前移)。
	for (let i = 0; i < interiorCount - 1; i++) {
		await tool.execute(`t${i}`, tool.prepareArguments({ pageNo: 1 }) as never);
	}
	assert.equal(getBook().pages.filter((p) => isInterior(p.templateId)).length, 1);
	await assert.rejects(
		tool.execute("t-last", tool.prepareArguments({ pageNo: 1 }) as never),
		/最后一张内页/,
		"删到内页数为 0 必须拒绝",
	);
});
