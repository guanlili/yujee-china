import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { compactDesignContextMessages } from "../src/core/context-compression.ts";

const usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function user(text: string, timestamp: number): AgentMessage {
	return { role: "user", content: [{ type: "text", text }], timestamp };
}

function assistantText(text: string, timestamp: number): AgentMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "openai",
		provider: "openai",
		model: "test-model",
		stopReason: "stop",
		usage,
		timestamp,
	};
}

function assistantToolCall(toolCallId: string, toolName: string, timestamp: number): AgentMessage {
	return {
		role: "assistant",
		content: [{ type: "toolCall", id: toolCallId, name: toolName, arguments: { start: 0, length: 4000 } }],
		api: "openai",
		provider: "openai",
		model: "test-model",
		stopReason: "toolUse",
		usage,
		timestamp,
	};
}

function toolResult(toolCallId: string, toolName: string, text: string, timestamp: number): AgentMessage {
	return {
		role: "toolResult",
		toolCallId,
		toolName,
		content: [{ type: "text", text }],
		isError: false,
		timestamp,
	};
}

function textOf(message: AgentMessage): string {
	if (!("content" in message)) return "";
	const content = message.content;
	if (typeof content === "string") return content;
	return content
		.filter((block): block is { type: "text"; text: string } => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

test("compactDesignContextMessages replaces older full artifact turns with a short summary", () => {
	const oldHtml = [
		'<artifact type="html">',
		"<!doctype html>",
		"<html><body><main>旧页面大段内容</main></body></html>",
		"</artifact>",
	].join("\n");
	const messages = [
		user("生成一个 token 用量测试页面", 1),
		assistantText(oldHtml, 2),
		toolResult("tool-1", "replace_artifact", "<!doctype html><html><body>工具返回旧 HTML</body></html>", 3),
		user("帮我把标题改短一点", 4),
	];

	const compacted = compactDesignContextMessages(messages);
	const serialized = JSON.stringify(compacted);

	assert.equal(compacted.length, 2);
	assert.match(textOf(compacted[0]!), /之前对话摘要/);
	assert.match(textOf(compacted[0]!), /生成一个 token 用量测试页面/);
	assert.doesNotMatch(textOf(compacted[0]!), /工具结果/);
	assert.doesNotMatch(textOf(compacted[0]!), /AI 调用工具/);
	assert.doesNotMatch(serialized, /<artifact/i);
	assert.doesNotMatch(serialized, /<!doctype html/i);
	assert.doesNotMatch(serialized, /旧页面大段内容/);
	assert.deepEqual(compacted.at(-1), messages.at(-1));
});

test("compactDesignContextMessages keeps prior user inputs and final assistant text only", () => {
	const messages = [
		user("做一个三页说明书", 1),
		assistantToolCall("tool-1", "get_artifact_summary", 2),
		toolResult("tool-1", "get_artifact_summary", "当前页面摘要", 3),
		assistantText("画好了。", 4),
		user("把第二页标题改短", 5),
	];

	const compacted = compactDesignContextMessages(messages);
	const summaryText = textOf(compacted[0]!);

	assert.match(summaryText, /用户：做一个三页说明书/);
	assert.match(summaryText, /AI 最终回复：画好了。/);
	assert.doesNotMatch(summaryText, /get_artifact_summary/);
	assert.doesNotMatch(summaryText, /当前页面摘要/);
	assert.deepEqual(compacted.at(-1), messages.at(-1));
});

test("compactDesignContextMessages keeps the active tool loop intact", () => {
	const messages = [
		user("上一轮生成页面", 1),
		assistantText("<!doctype html><html><body>旧页面</body></html>", 2),
		user("把 hero 标题改成新的", 3),
		assistantToolCall("tool-current", "read_artifact", 4),
		toolResult("tool-current", "read_artifact", "<!doctype html><html><body>当前工具读取结果</body></html>", 5),
	];

	const compacted = compactDesignContextMessages(messages);

	assert.equal(compacted.length, 4);
	assert.match(textOf(compacted[0]!), /之前对话摘要/);
	assert.deepEqual(compacted.slice(1), messages.slice(2));
	assert.match(JSON.stringify(compacted.slice(1)), /当前工具读取结果/);
});
