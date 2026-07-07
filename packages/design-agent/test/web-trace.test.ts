import assert from "node:assert/strict";
import test from "node:test";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { createInitialDesignDemoState, renderDesignPreviewHtml } from "../src/core/artifacts/design-demo.ts";
import { buildChatResponse } from "../src/web/chat-response.ts";
import { TraceStore } from "../src/web/traces.ts";

const assistantMessage: AssistantMessage = {
	role: "assistant",
	content: [{ type: "text", text: "# Landing Page\n\nUse a focused hero and one primary action." }],
	api: "faux",
	provider: "faux",
	model: "faux-1",
	usage: {
		input: 10,
		output: 20,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 30,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	},
	stopReason: "stop",
	timestamp: 1,
};

test("TraceStore records provider payload and assistant output", () => {
	const traces = new TraceStore();
	const trace = traces.startTrace({ prompt: "Design a landing page" });

	traces.recordProviderPayload(trace.id, { model: "faux-1", messages: [{ role: "user", content: "hello" }] });
	traces.recordProviderResponse(trace.id, { status: 200, headers: { "x-test": "ok" } });
	traces.recordAssistantMessage(trace.id, assistantMessage);
	traces.finishTrace(trace.id);

	const [recorded] = traces.list();
	assert.equal(recorded?.prompt, "Design a landing page");
	assert.equal(recorded?.requestPayloads.length, 1);
	assert.deepEqual(recorded?.providerResponses[0], { status: 200, headers: { "x-test": "ok" } });
	assert.equal(recorded?.assistantMessage, assistantMessage);
	assert.deepEqual(recorded?.assistantMessages, [assistantMessage]);
	assert.ok(recorded?.endedAt);
});

test("TraceStore records every assistant message usage once", () => {
	const traces = new TraceStore();
	const trace = traces.startTrace({ prompt: "Design a landing page" });
	const secondMessage: AssistantMessage = {
		...assistantMessage,
		content: [{ type: "text", text: "second" }],
		usage: {
			input: 30,
			output: 40,
			cacheRead: 5,
			cacheWrite: 0,
			totalTokens: 75,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		timestamp: 2,
	};

	traces.recordAssistantMessage(trace.id, assistantMessage);
	traces.recordAssistantMessage(trace.id, assistantMessage);
	traces.recordAssistantMessage(trace.id, secondMessage);

	const [recorded] = traces.list();
	assert.equal(recorded?.assistantMessage, secondMessage);
	assert.deepEqual(recorded?.assistantMessages, [assistantMessage, secondMessage]);
});

test("buildChatResponse returns assistant text, artifact, and traces", () => {
	const traces = new TraceStore();
	const trace = traces.startTrace({ prompt: "Design a landing page" });
	traces.recordAssistantMessage(trace.id, assistantMessage);
	traces.finishTrace(trace.id);

	const response = buildChatResponse({
		prompt: "Design a landing page",
		assistantMessage,
		design: createInitialDesignDemoState(),
		artifactHtml: renderDesignPreviewHtml(createInitialDesignDemoState()),
		traces: traces.list(),
	});

	assert.equal(response.assistant.text, "# Landing Page\n\nUse a focused hero and one primary action.");
	assert.equal(response.artifact.kind, "html");
	assert.match(response.artifact.content, /<!doctype html>/i);
	assert.equal(response.design.title, "设计工作室");
	assert.equal(response.traces.length, 1);
});
