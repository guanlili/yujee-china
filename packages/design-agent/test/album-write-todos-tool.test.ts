import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	type AlbumBookState,
	cloneAlbumBookState,
	parseAlbumBookInput,
} from "../src/core/album/book-state.ts";
import { loadTemplateCatalog } from "../src/core/album/templates-catalog.ts";
import { type AlbumToolsOptions, createAlbumTools } from "../src/core/album/tools.ts";

/* write_todos(2026-08-05 设计:docs/specs/2026-08-05-write-todos-design.md):
   复诵式长任务计划工具,参考 deepagents TodoListMiddleware。整表覆盖、完全无状态、
   纯 no-op:不碰书状态、不 terminate;计划的唯一载体是对话历史里的参数与回执。 */

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

function textOf(result: { content: { type: string; text?: string }[] }): string {
	return result.content.map((c) => ("text" in c ? (c.text ?? "") : "")).join("");
}

test("write_todos:注册且为纯 no-op —— 书状态逐字节不动、version 不变、不 terminate", async () => {
	const { tools, getBook } = createHarness();
	const tool = tools.get("write_todos");
	assert.ok(tool, "write_todos 工具必须注册");
	const before = getBook();
	const beforeJson = JSON.stringify(before);

	const args = tool.prepareArguments({
		todos: [
			{ content: "把第 1-3 页换成新模板", status: "in_progress" },
			{ content: "逐页核对文字溢出", status: "pending" },
		],
	});
	const result = await tool.execute("t1", args as never);

	assert.notEqual(result.terminate, true, "计划工具不终结本轮");
	assert.equal(JSON.stringify(getBook()), beforeJson, "书状态必须逐字节不变");
	assert.equal(getBook().version, before.version, "version 不得自增(非写工具)");
});

test("write_todos:回执复诵整表 —— [→]/[ ]/[✓] 符号 + 全部条目内容", async () => {
	const { tools } = createHarness();
	const tool = tools.get("write_todos")!;
	const result = await tool.execute(
		"t1",
		tool.prepareArguments({
			todos: [
				{ content: "换封面模板", status: "completed" },
				{ content: "调整第 2 页配色", status: "in_progress" },
				{ content: "全书字体统一", status: "pending" },
			],
		}) as never,
	);
	const text = textOf(result);
	assert.match(text, /\[✓\] 换封面模板/, "completed 渲染为 [✓]");
	assert.match(text, /\[→\] 调整第 2 页配色/, "in_progress 渲染为 [→]");
	assert.match(text, /\[ \] 全书字体统一/, "pending 渲染为 [ ]");
	// 回执要能当复诵载体:三条全部在场,顺序与传入一致。
	assert.ok(
		text.indexOf("换封面模板") < text.indexOf("调整第 2 页配色") &&
			text.indexOf("调整第 2 页配色") < text.indexOf("全书字体统一"),
		"条目按传入顺序复诵",
	);
});

test("write_todos:details 带整表与状态计数(trace/事件流观测用)", async () => {
	const { tools } = createHarness();
	const tool = tools.get("write_todos")!;
	const result = await tool.execute(
		"t1",
		tool.prepareArguments({
			todos: [
				{ content: "a", status: "completed" },
				{ content: "b", status: "in_progress" },
				{ content: "c", status: "pending" },
				{ content: "d", status: "pending" },
			],
		}) as never,
	);
	const details = result.details as { todos: unknown[]; counts: Record<string, number> };
	assert.equal(details.todos.length, 4);
	assert.deepEqual(details.counts, { pending: 2, in_progress: 1, completed: 1 });
});

test("write_todos:空数组 = 清空计划,回执说明", async () => {
	const { tools } = createHarness();
	const tool = tools.get("write_todos")!;
	const result = await tool.execute("t1", tool.prepareArguments({ todos: [] }) as never);
	assert.match(textOf(result), /清空/, "清空要在回执里说清");
});

test("write_todos:校验 —— 非法 status、空 content、超 30 条、非数组都拒绝", async () => {
	const { tools } = createHarness();
	const tool = tools.get("write_todos")!;

	await assert.rejects(
		() => tool.execute("t1", tool.prepareArguments({ todos: [{ content: "x", status: "done" }] }) as never),
		/status/,
		"status 只认 pending/in_progress/completed",
	);
	await assert.rejects(
		() => tool.execute("t1", tool.prepareArguments({ todos: [{ content: "  ", status: "pending" }] }) as never),
		/content/,
		"content 不得为空",
	);
	await assert.rejects(
		() =>
			tool.execute(
				"t1",
				tool.prepareArguments({
					todos: Array.from({ length: 31 }, (_, i) => ({ content: `t${i}`, status: "pending" })),
				}) as never,
			),
		/30/,
		"最多 30 条",
	);
	await assert.rejects(
		() => tool.execute("t1", tool.prepareArguments({ todos: "not-a-list" }) as never),
		/todos/,
		"todos 必须是数组",
	);
});
