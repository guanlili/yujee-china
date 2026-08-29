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
import { ALBUM_WRITE_TOOL_NAMES, pickStepText } from "../src/web/album-server.ts";

// 步骤叙述 = 工具循环里【每一条带读类 tool_call 的助手消息】的可见文本(AI 边做边说)。
// 写类工具会 terminate 本轮(commitWrite terminate:true),所以带写类 tool_call 的消息
// 其实是【终稿】那一步,不算中间步(否则和终稿气泡重文)。2026-08-08 起逐条流出,不再只取第一条。

test("pickStepText:读类步骤带文本 → 取该文本作步骤叙述", () => {
	const message = fauxAssistantMessage(
		[fauxText("好,我先看看当前封面和字体菜单。"), fauxToolCall("read_page", {})],
		{ stopReason: "toolUse" },
	);
	assert.equal(pickStepText(message), "好,我先看看当前封面和字体菜单。");
});

test("pickStepText:写类步骤带文本 → 返回 null(那是终稿,不是中间步)", () => {
	// set_text_fonts 是写类工具,execute 走 commitWrite → terminate 本轮 → 这步就是终稿。
	const message = fauxAssistantMessage(
		[fauxText("我已经把字体换成古典衬线。"), fauxToolCall("set_text_fonts", { fonts: { body: "serif" } })],
		{ stopReason: "toolUse" },
	);
	assert.equal(pickStepText(message), null);
});

test("pickStepText:读类步骤但无可见文本 → 返回 null", () => {
	const message = fauxAssistantMessage([fauxToolCall("list_templates", {})], { stopReason: "toolUse" });
	assert.equal(pickStepText(message), null);
});

test("pickStepText:纯文本无 tool_call(终答) → 返回 null", () => {
	const message = fauxAssistantMessage([fauxText("这页写的是那年夏天的海边。")], { stopReason: "stop" });
	assert.equal(pickStepText(message), null);
});

test("pickStepText:空内容 → 返回 null", () => {
	const message = fauxAssistantMessage([], { stopReason: "stop" });
	assert.equal(pickStepText(message), null);
});

test("pickStepText:同一步并行读+写 → 返回 null(含终止写工具即为终稿)", () => {
	const message = fauxAssistantMessage(
		[
			fauxText("我看一眼再改。"),
			fauxToolCall("read_page", {}),
			fauxToolCall("set_text_colors", { colors: { body: "#333" } }),
		],
		{ stopReason: "toolUse" },
	);
	assert.equal(pickStepText(message), null);
});

test("pickStepText:文本首尾空白被裁剪,纯空白视为无文本", () => {
	const withPadding = fauxAssistantMessage([fauxText("  先看看。 "), fauxToolCall("search_book", {})], {
		stopReason: "toolUse",
	});
	assert.equal(pickStepText(withPadding), "先看看。");

	const blank = fauxAssistantMessage([fauxText("   \n  "), fauxToolCall("search_book", {})], {
		stopReason: "toolUse",
	});
	assert.equal(pickStepText(blank), null);
});

test("ALBUM_WRITE_TOOL_NAMES 覆盖全部 10 个终止写工具", () => {
	for (const name of [
		"update_page_texts",
		"write_page_html",
		"swap_page_template",
		"update_page_images",
		"set_text_colors",
		"set_text_fonts",
		"move_pages",
		"delete_page",
		"set_page_background",
		"apply_book_style",
	]) {
		assert.equal(ALBUM_WRITE_TOOL_NAMES.has(name), true, `${name} 应在终止写工具集里`);
	}
	// 读类工具不应在集合里
	assert.equal(ALBUM_WRITE_TOOL_NAMES.has("read_page"), false);
});

// ───────── 集成:真实 album 工具循环里,每条读类中间步的文本都逐条流出 ─────────
// 用真实 createAlbumTools + 真实工具循环驱动 faux [读一步(带文本) → 再读一步(带文本) →
// 终答一步(纯文本)]。读类非终止 → 循环走满三步 → message_end 对每步都触发,pickStepText
// 对两条中间步都命中、对终稿返回 null。这正是 album-server 里 subscribe 的接线逻辑。
const fixturePath = fileURLToPath(new URL("../fixtures/sample-book.json", import.meta.url));

test("集成:工具循环里每条读类步骤的文本都被逐条捕获,终稿另算", async () => {
	const catalog = loadTemplateCatalog();
	let book = parseAlbumBookInput(JSON.parse(readFileSync(fixturePath, "utf8"))).book;

	const faux = fauxProviderWith([
		fauxAssistantMessage([fauxText("好,我先看看当前封面和字体菜单。"), fauxToolCall("read_page", {})], {
			stopReason: "toolUse",
		}),
		fauxAssistantMessage([fauxText("再对比一下同类目的模板。"), fauxToolCall("list_templates", {})], {
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

	// 复刻 album-server subscribe 的接线:message_end(assistant)→ 每条命中的步骤叙述都收集。
	const steps: string[] = [];
	session.subscribe((event) => {
		if (event.type === "message_end" && event.message.role === "assistant") {
			const step = pickStepText(event.message);
			if (step) steps.push(step);
		}
	});

	const finalMessage = await session.prompt("把字体换成古典衬线");

	assert.equal(faux.state.callCount, 3); // 读两步 + 终答一步,证明读类不终止、循环继续
	assert.deepEqual(steps, ["好,我先看看当前封面和字体菜单。", "再对比一下同类目的模板。"]); // 逐条、按序
	const finalText = finalMessage.content.find((block) => block.type === "text");
	assert.equal(finalText?.type === "text" ? finalText.text : "", "已经按古典衬线的思路看过了,下一步我来改。");
	assert.equal(steps.includes(finalText?.type === "text" ? finalText.text : ""), false); // 终稿不混入步骤
});

// 接线守卫:album-server 的 subscribe(message_end)确实用 pickStepText 并发 assistant_step,
// 且没有「每轮只发一条」的旧闸门(openingStepEmitted 已删,逐条流出)。
test("接线:album-server 在 message_end 里逐条发 assistant_step 步骤事件", () => {
	const src = readFileSync(fileURLToPath(new URL("../src/web/album-server.ts", import.meta.url)), "utf8");
	assert.match(src, /message_end[\s\S]*?pickStepText\(event\.message\)/);
	assert.match(src, /type:\s*"assistant_step"/);
	assert.doesNotMatch(src, /openingStepEmitted/, "一次性闸门必须保持拆除");
});

// 本地小工具:直接建 faux 并注入脚本响应(design-agent-session.test.ts 同款)。
function fauxProviderWith(responses: Parameters<ReturnType<typeof fauxProvider>["setResponses"]>[0]) {
	const faux = fauxProvider();
	faux.setResponses(responses);
	return faux;
}
