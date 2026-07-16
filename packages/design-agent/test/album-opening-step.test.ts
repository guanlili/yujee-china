import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { InMemorySessionRepo } from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { cloneAlbumBookState, parseAlbumBookInput } from "../src/core/album/book-state.ts";
import { loadTemplateCatalog } from "../src/core/album/templates-catalog.ts";
import { createAlbumTools } from "../src/core/album/tools.ts";
import { createDesignAgentSession } from "../src/core/design-agent-session.ts";
import { ALBUM_WRITE_TOOL_NAMES, pickOpeningStepText } from "../src/web/album-server.ts";

// 开场白 = 工具循环里【第一条带 tool_call 的助手消息】的可见文本(AI 对用户说的那句
// “好,我来帮你…先看看…”)。写类工具会 terminate 本轮(commitWrite terminate:true),所以
// 带写类 tool_call 的消息其实是【终稿】那一步,不能当开场白(否则和终稿气泡重文)。
// 只有带【读类(非终止)tool_call】且有可见文本的中间步才算开场白。

test("pickOpeningStepText:读类步骤带文本 → 取该文本作开场白", () => {
	const message = fauxAssistantMessage(
		[fauxText("好,我先看看当前封面和字体菜单。"), fauxToolCall("read_page", {})],
		{ stopReason: "toolUse" },
	);
	assert.equal(pickOpeningStepText(message), "好,我先看看当前封面和字体菜单。");
});

test("pickOpeningStepText:写类步骤带文本 → 返回 null(那是终稿,不是开场白)", () => {
	// set_text_fonts 是写类工具,execute 走 commitWrite → terminate 本轮 → 这步就是终稿。
	const message = fauxAssistantMessage(
		[fauxText("我已经把字体换成古典衬线。"), fauxToolCall("set_text_fonts", { fonts: { body: "serif" } })],
		{ stopReason: "toolUse" },
	);
	assert.equal(pickOpeningStepText(message), null);
});

test("pickOpeningStepText:读类步骤但无可见文本 → 返回 null", () => {
	const message = fauxAssistantMessage([fauxToolCall("list_templates", {})], { stopReason: "toolUse" });
	assert.equal(pickOpeningStepText(message), null);
});

test("pickOpeningStepText:纯文本无 tool_call(终答) → 返回 null", () => {
	const message = fauxAssistantMessage([fauxText("这页写的是那年夏天的海边。")], { stopReason: "stop" });
	assert.equal(pickOpeningStepText(message), null);
});

test("pickOpeningStepText:空内容 → 返回 null", () => {
	const message = fauxAssistantMessage([], { stopReason: "stop" });
	assert.equal(pickOpeningStepText(message), null);
});

test("pickOpeningStepText:同一步并行读+写 → 返回 null(含终止写工具即为终稿)", () => {
	const message = fauxAssistantMessage(
		[
			fauxText("我看一眼再改。"),
			fauxToolCall("read_page", {}),
			fauxToolCall("set_text_colors", { colors: { body: "#333" } }),
		],
		{ stopReason: "toolUse" },
	);
	assert.equal(pickOpeningStepText(message), null);
});

test("pickOpeningStepText:文本首尾空白被裁剪,纯空白视为无文本", () => {
	const withPadding = fauxAssistantMessage([fauxText("  先看看。 "), fauxToolCall("search_book", {})], {
		stopReason: "toolUse",
	});
	assert.equal(pickOpeningStepText(withPadding), "先看看。");

	const blank = fauxAssistantMessage([fauxText("   \n  "), fauxToolCall("search_book", {})], {
		stopReason: "toolUse",
	});
	assert.equal(pickOpeningStepText(blank), null);
});

test("ALBUM_WRITE_TOOL_NAMES 覆盖全部 6 个终止写工具", () => {
	for (const name of [
		"update_page_texts",
		"write_page_html",
		"swap_page_template",
		"update_page_images",
		"set_text_colors",
		"set_text_fonts",
	]) {
		assert.equal(ALBUM_WRITE_TOOL_NAMES.has(name), true, `${name} 应在终止写工具集里`);
	}
	// 读类工具不应在集合里
	assert.equal(ALBUM_WRITE_TOOL_NAMES.has("read_page"), false);
});

// ───────── 集成:真实 album 工具循环里,读类步骤先出,开场白取第一条中间步文本 ─────────
// 用真实 createAlbumTools + 真实工具循环驱动 faux [读一步(带文本) → 终答一步(纯文本)]。
// read_page 非终止 → 循环继续到第二步 → message_end 对两步都触发,pickOpeningStepText
// 恰好选中读类中间步的开场白,而非终稿。这正是 album-server 里 subscribe 的接线逻辑。
const fixturePath = fileURLToPath(new URL("../fixtures/sample-book.json", import.meta.url));

test("集成:工具循环第一条读类步骤的文本被识别为开场白,终稿另算", async () => {
	const catalog = loadTemplateCatalog();
	let book = parseAlbumBookInput(JSON.parse(readFileSync(fixturePath, "utf8"))).book;

	const faux = fauxProviderWith([
		fauxAssistantMessage([fauxText("好,我先看看当前封面和字体菜单。"), fauxToolCall("read_page", {})], {
			stopReason: "toolUse",
		}),
		fauxAssistantMessage("已经按古典衬线的思路看过了,下一步我来改。", { stopReason: "stop" }),
	]);
	const models = createModels();
	models.setProvider(faux.provider);
	const harnessSession = await new InMemorySessionRepo().create();
	const session = createDesignAgentSession({
		env: new NodeExecutionEnv({ cwd: process.cwd() }),
		session: harnessSession,
		models,
		model: faux.getModel(),
		thinkingLevel: "off",
		tools: createAlbumTools({
			catalog,
			getBookState: () => cloneAlbumBookState(book),
			setBookState: (next) => {
				book = cloneAlbumBookState(next);
			},
		}),
	});

	// 复刻 album-server subscribe 的接线:message_end(assistant)→ 第一条命中的开场白。
	const openings: string[] = [];
	let emitted = false;
	session.subscribe((event) => {
		if (event.type === "message_end" && event.message.role === "assistant") {
			if (emitted) return;
			const opening = pickOpeningStepText(event.message);
			if (opening) {
				emitted = true;
				openings.push(opening);
			}
		}
	});

	const finalMessage = await session.prompt("把字体换成古典衬线");

	assert.equal(faux.state.callCount, 2); // 读一步 + 终答一步,证明读类不终止、循环继续
	assert.deepEqual(openings, ["好,我先看看当前封面和字体菜单。"]); // 只取第一条中间步
	const finalText = finalMessage.content.find((block) => block.type === "text");
	assert.equal(finalText?.type === "text" ? finalText.text : "", "已经按古典衬线的思路看过了,下一步我来改。");
	assert.notEqual(openings[0], finalText?.type === "text" ? finalText.text : ""); // 开场白 ≠ 终稿
});

// 接线守卫:album-server 的 subscribe(message_end)确实用 pickOpeningStepText 并发 assistant_step。
test("接线:album-server 在 message_end 里发 assistant_step 开场白事件", () => {
	const src = readFileSync(fileURLToPath(new URL("../src/web/album-server.ts", import.meta.url)), "utf8");
	assert.match(src, /message_end[\s\S]*?pickOpeningStepText\(event\.message\)/);
	assert.match(src, /type:\s*"assistant_step"/);
	// 每轮只发一条:openingStepEmitted 去重且在 setActiveTrace 重置。
	assert.match(src, /openingStepEmitted/);
});

// 本地小工具:直接建 faux 并注入脚本响应(design-agent-session.test.ts 同款)。
function fauxProviderWith(responses: Parameters<ReturnType<typeof fauxProvider>["setResponses"]>[0]) {
	const faux = fauxProvider();
	faux.setResponses(responses);
	return faux;
}
