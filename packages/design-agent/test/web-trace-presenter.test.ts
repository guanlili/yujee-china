import assert from "node:assert/strict";
import test from "node:test";
import {
	compactTraceValue,
	createChatFinalText,
	createConversationSteps,
	createLlmCallSummary,
	createLlmInputSections,
	createLlmTraceSections,
	createTimelineItem,
	createTokenSummary,
	createTraceEventSummaries,
} from "../src/web/static/trace-presenter.js";

test("createLlmInputSections extracts provider calls and message text", () => {
	const sections = createLlmInputSections({
		requestPayloads: [
			{ type: "design_demo_input", userMessage: "hello" },
			{
				model: "deepseek-v4-flash-260425",
				stream: true,
				max_completion_tokens: 9999,
				messages: [
					{ role: "system", content: "System instructions" },
					{
						role: "user",
						content: [{ type: "text", text: "User prompt" }],
					},
				],
			},
		],
		assistantMessage: {
			usage: {
				input: 12,
				output: 34,
				cacheRead: 2,
				cacheWrite: 3,
				totalTokens: 51,
			},
		},
	});

	assert.equal(sections.length, 1);
	assert.equal(sections[0]?.title, "LLM 调用 1 · deepseek-v4-flash-260425");
	assert.equal(sections[0]?.model, "deepseek-v4-flash-260425");
	assert.equal(sections[0]?.messages.length, 2);
	assert.deepEqual(
		sections[0]?.messages.map((message) => message.role),
		["system", "user"],
	);
	assert.equal(sections[0]?.messages[1]?.text, "User prompt");
	assert.equal(sections[0]?.meta.inputTokens, 12);
	assert.equal(sections[0]?.meta.outputTokens, 34);
	assert.equal(sections[0]?.meta.cacheReadTokens, 2);
	assert.equal(sections[0]?.meta.cacheWriteTokens, 3);
	assert.equal(sections[0]?.meta.totalTokens, 51);
	assert.equal(sections[0]?.meta.inputCost, "¥0.000144");
	assert.equal(sections[0]?.meta.outputCost, "¥0.000816");
	assert.equal(sections[0]?.meta.cacheReadCost, "¥0.000002");
	assert.equal(sections[0]?.meta.totalCost, "¥0.000962");
	assert.match(sections[0]?.meta.pricing ?? "", /输入 ¥0.012\/千 tokens/);
	assert.equal(sections[0]?.meta.maxCompletionTokens, undefined);
});

test("createLlmInputSections assigns per-call token cost from assistant messages", () => {
	const sections = createLlmInputSections({
		requestPayloads: [
			{
				model: "deepseek-v4-flash-260425",
				messages: [{ role: "user", content: "first" }],
			},
			{
				model: "deepseek-v4-flash-260425",
				messages: [{ role: "user", content: "second" }],
			},
		],
		assistantMessages: [
			{
				usage: {
					input: 1000,
					output: 500,
					cacheRead: 200,
					totalTokens: 1700,
				},
			},
			{
				usage: {
					input: 2000,
					output: 1000,
					cacheRead: 0,
					totalTokens: 3000,
				},
			},
		],
	});

	assert.equal(sections[0]?.meta.totalCost, "¥0.024200");
	assert.equal(sections[1]?.meta.totalCost, "¥0.048000");
});

test("createLlmCallSummary describes one provider call as a collapsed container label", () => {
	const sections = createLlmTraceSections({
		requestPayloads: [
			{
				model: "deepseek-v4-flash-260425",
				messages: [
					{ role: "system", content: "System prompt" },
					{ role: "user", content: "User prompt" },
					{
						role: "assistant",
						content: null,
						tool_calls: [{ function: { name: "read_artifact" } }],
					},
					{ role: "tool", content: "Tool result" },
				],
			},
		],
		assistantMessage: {
			role: "assistant",
			content: [{ type: "text", text: "Final answer" }],
			usage: {
				input: 120,
				output: 30,
				totalTokens: 150,
			},
		},
	});

	const summary = createLlmCallSummary(sections[0]);

	assert.equal(summary?.inputMessageCount, 4);
	assert.equal(summary?.outputMessageCount, 1);
	assert.deepEqual(summary?.roleCounts, {
		system: 1,
		user: 1,
		assistant: 1,
		tool: 1,
		other: 0,
	});
	assert.match(summary?.label ?? "", /LLM 调用 1/);
	assert.match(summary?.label ?? "", /System 1/);
	assert.match(summary?.label ?? "", /Task context 1/);
	assert.match(summary?.label ?? "", /Assistant 1/);
	assert.match(summary?.label ?? "", /Tools 1/);
	assert.match(summary?.label ?? "", /输入 120/);
	assert.match(summary?.label ?? "", /输出 30/);
	assert.match(summary?.label ?? "", /费用 ¥0.002160/);
});

test("createLlmTraceSections pairs each provider input with its output", () => {
	const sections = createLlmTraceSections({
		requestPayloads: [
			{
				model: "deepseek-v4-flash-260425",
				stream: true,
				messages: [
					{ role: "system", content: "System instructions" },
					{ role: "user", content: "User prompt" },
				],
			},
			{ type: "tool_call", toolName: "get_artifact_summary" },
			{
				model: "deepseek-v4-flash-260425",
				stream: true,
				messages: [
					{ role: "system", content: "System instructions" },
					{ role: "user", content: "User prompt" },
					{
						role: "assistant",
						content: null,
						tool_calls: [{ function: { name: "get_artifact_summary" } }],
					},
					{ role: "tool", content: "summary result" },
				],
			},
		],
		assistantMessage: {
			role: "assistant",
			content: [{ type: "text", text: "done" }],
		},
	});

	assert.equal(sections.length, 2);
	assert.equal(sections[0]?.output?.role, "assistant");
	assert.match(sections[0]?.output?.text ?? "", /get_artifact_summary/);
	assert.equal(sections[1]?.output?.text, "done");
});

test("createTokenSummary extracts overall token usage", () => {
	const summary = createTokenSummary({
		assistantMessage: {
			usage: {
				input: 1200,
				output: 300,
				reasoning: 40,
				cacheRead: 80,
				cacheWrite: 20,
				totalTokens: 1640,
			},
		},
	});

	assert.deepEqual(summary, {
		inputTokens: 1200,
		outputTokens: 300,
		reasoningTokens: 40,
		cacheReadTokens: 80,
		cacheWriteTokens: 20,
		totalTokens: 1640,
		inputCost: "¥0.014400",
		outputCost: "¥0.007200",
		cacheReadCost: "¥0.000080",
		totalCost: "¥0.021680",
		pricing: "输入 ¥0.012/千 tokens · 输出 ¥0.024/千 tokens · 缓存命中 ¥0.001/千 tokens",
	});
});

test("createTokenSummary aggregates assistant message usage when multiple calls exist", () => {
	const summary = createTokenSummary({
		assistantMessages: [
			{ usage: { input: 1000, output: 500, cacheRead: 200, totalTokens: 1700 } },
			{ usage: { input: 2000, output: 1000, cacheRead: 0, totalTokens: 3000 } },
		],
	});

	assert.equal(summary?.inputTokens, 3000);
	assert.equal(summary?.outputTokens, 1500);
	assert.equal(summary?.cacheReadTokens, 200);
	assert.equal(summary?.totalCost, "¥0.072200");
});

test("createTokenSummary returns undefined when provider did not report usage", () => {
	assert.equal(createTokenSummary({ assistantMessage: {} }), undefined);
});

test("createConversationSteps exposes tool progress for the chat panel", () => {
	const steps = createConversationSteps({
		requestPayloads: [
			{ type: "tool_call", toolName: "get_artifact_summary" },
			{ type: "tool_result", toolName: "get_artifact_summary", isError: false },
			{ type: "tool_call", toolName: "replace_artifact" },
			{ type: "tool_result", toolName: "replace_artifact", isError: false, details: { version: 2 } },
			{
				type: "design_demo_state",
				committed: true,
				design: { version: 2, artifactHtml: "<!doctype html><html></html>" },
			},
		],
	});

	assert.deepEqual(steps, [
		"调用工具：get_artifact_summary",
		"工具完成：get_artifact_summary",
		"调用工具：replace_artifact",
		"工具完成：replace_artifact，版本 2",
		"画板已更新：版本 2",
	]);
});

test("createTimelineItem formats stream events as compact timeline rows", () => {
	assert.deepEqual(createTimelineItem({ type: "llm_start", callIndex: 1 }), {
		id: "llm:1",
		kind: "llm",
		status: "running",
		text: "AI 正在分析",
	});
	assert.deepEqual(createTimelineItem({ type: "llm_done", callIndex: 1 }), {
		id: "llm:1",
		kind: "llm",
		status: "done",
		text: "AI 完成分析",
	});
	assert.deepEqual(createTimelineItem({ type: "tool_call", toolCallId: "a", toolName: "read_artifact" }), {
		id: "tool:a",
		kind: "read",
		status: "running",
		text: "读取画板内容",
	});
	assert.deepEqual(createTimelineItem({ type: "tool_call", toolCallId: "full", toolName: "read_full_artifact" }), {
		id: "tool:full",
		kind: "read",
		status: "running",
		text: "读取完整画板",
	});
	assert.deepEqual(
		createTimelineItem({
			type: "tool_result",
			toolCallId: "b",
			toolName: "replace_artifact",
			isError: false,
			details: { version: 2 },
		}),
		{
			id: "tool:b",
			kind: "write",
			status: "done",
			text: "更新画板 · Replace all",
		},
	);
	assert.deepEqual(createTimelineItem({ type: "artifact_updated", version: 2 }), {
		id: "artifact:2",
		kind: "artifact",
		status: "done",
		text: "画板已更新 · 版本 2",
	});
});

test("createChatFinalText keeps the assistant final reply in the chat panel", () => {
	const text = createChatFinalText({
		assistant: {
			text: '社媒推广卡片已生成。\n\n<artifact type="html"><!doctype html><html></html></artifact>',
		},
		traces: [
			{
				requestPayloads: [
					{ type: "tool_call", toolName: "replace_artifact" },
					{
						type: "design_demo_state",
						committed: true,
						design: { version: 2, artifactHtml: "<!doctype html><html></html>" },
					},
				],
			},
		],
	});

	assert.equal(text, "社媒推广卡片已生成。");
});

test("createChatFinalText falls back to concise completion text when assistant reply is empty", () => {
	const text = createChatFinalText({
		assistant: { text: "" },
		traces: [
			{
				requestPayloads: [
					{ type: "tool_call", toolName: "replace_artifact_range" },
					{
						type: "design_demo_state",
						committed: true,
						design: { version: 2, artifactHtml: "<!doctype html><html></html>" },
					},
				],
			},
		],
	});

	assert.equal(text, "这个部分已经做好了。");
});

test("compactTraceValue truncates large raw artifact strings", () => {
	const compacted = compactTraceValue({
		design: {
			artifactHtml: `<html>${"x".repeat(9000)}</html>`,
		},
	});

	assert.equal(typeof compacted.design.artifactHtml, "string");
	assert.match(compacted.design.artifactHtml, /truncated/);
	assert.equal(compacted.design.artifactHtml.length < 2500, true);
});

test("createTraceEventSummaries turns raw runtime events into readable rows", () => {
	const events = createTraceEventSummaries({
		requestPayloads: [
			{ type: "design_demo_input", userMessage: "做一个页面" },
			{ type: "tool_call", toolName: "replace_artifact_range", input: { start: 10 } },
			{
				type: "tool_result",
				toolName: "replace_artifact_range",
				isError: false,
				details: { version: 3 },
			},
			{
				type: "design_demo_state",
				operations: ["artifact"],
				committed: true,
				design: { version: 4, artifactHtml: "<html>ok</html>" },
			},
		],
	});

	assert.deepEqual(
		events.map((event) => event.kind),
		["input", "tool_call", "tool_result", "artifact"],
	);
	assert.match(events[2]?.label ?? "", /replace_artifact_range/);
	assert.match(events[3]?.detail ?? "", /version 4/);
});

test("createTraceEventSummaries handles tool results without details", () => {
	const events = createTraceEventSummaries({
		requestPayloads: [
			{
				type: "tool_result",
				toolName: "get_artifact_summary",
				isError: false,
				content: [{ type: "text", text: "ok" }],
			},
		],
	});

	assert.equal(events.length, 1);
	assert.equal(events[0]?.kind, "tool_result");
	assert.match(events[0]?.detail ?? "", /ok/);
});
