import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createDesignAgentWebServer } from "../src/web/server.ts";

async function withWebServer<T>(
	run: (baseUrl: string) => Promise<T>,
	env: Record<string, string | undefined> = {},
): Promise<T> {
	const cwd = await mkdtemp(join(tmpdir(), "design-agent-web-"));
	try {
		const server = await createDesignAgentWebServer({ cwd, env });
		await new Promise<void>((resolve) => {
			server.listen(0, "127.0.0.1", resolve);
		});
		const address = server.address() as AddressInfo;
		try {
			return await run(`http://127.0.0.1:${address.port}`);
		} finally {
			await new Promise<void>((resolve, reject) => {
				server.close((error) => {
					if (error) reject(error);
					else resolve();
				});
			});
		}
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
}

async function postChat(baseUrl: string, message: string): Promise<Record<string, unknown>> {
	const response = await fetch(`${baseUrl}/api/chat`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ message }),
	});
	assert.equal(response.status, 200);
	return (await response.json()) as Record<string, unknown>;
}

async function postChatStream(baseUrl: string, message: string): Promise<Array<Record<string, unknown>>> {
	const response = await fetch(`${baseUrl}/api/chat?stream=1`, {
		method: "POST",
		headers: { accept: "application/x-ndjson", "content-type": "application/json" },
		body: JSON.stringify({ message }),
	});
	assert.equal(response.status, 200);
	assert.match(response.headers.get("content-type") ?? "", /application\/x-ndjson/);
	const text = await response.text();
	return text
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function getState(baseUrl: string): Promise<Record<string, unknown>> {
	const response = await fetch(`${baseUrl}/api/state`);
	assert.equal(response.status, 200);
	return (await response.json()) as Record<string, unknown>;
}

test("web debug responses are not cached by the browser", async () => {
	await withWebServer(async (baseUrl) => {
		for (const pathname of ["/", "/app.js", "/trace-presenter.js", "/api/state"]) {
			const response = await fetch(`${baseUrl}${pathname}`);
			assert.equal(response.status, 200);
			assert.equal(response.headers.get("cache-control"), "no-store");
		}
	});
});

test("streaming chat emits progress events and final response", async () => {
	await withWebServer(async (baseUrl) => {
		const events = await postChatStream(baseUrl, "你好");
		const eventTypes = events.map((event) => event.type);
		const doneEvent = events.find((event) => event.type === "done");

		assert.equal(eventTypes[0], "started");
		assert.equal(eventTypes.at(-1), "done");
		assert.equal(eventTypes.includes("artifact_updated"), true);
		assert.equal(eventTypes.includes("assistant_final"), true);
		assert.equal(typeof doneEvent?.response, "object");
	});
});

test("initial state is a normal Chinese design preview", async () => {
	await withWebServer(async (baseUrl) => {
		const payload = await getState(baseUrl);
		const design = payload.design as { title?: unknown; body?: unknown; buttonLabel?: unknown };
		const artifact = payload.artifact as { kind?: unknown; content?: unknown };

		assert.equal(design.title, "设计工作室");
		assert.equal(design.body, "把想法整理成一个清晰、可展示、可继续迭代的页面。");
		assert.equal(design.buttonLabel, "开始设计");
		assert.equal(artifact.kind, "html");
		assert.match(String(artifact.content), /lang="zh-CN"/);
	});
});

test("chat greeting creates a visible HTML design artifact", async () => {
	await withWebServer(async (baseUrl) => {
		const payload = await postChat(baseUrl, "你好");
		const artifact = payload.artifact as { kind?: unknown; content?: unknown };
		const design = payload.design as { title?: unknown; version?: unknown };
		const traces = payload.traces as Array<{ requestPayloads?: Array<{ type?: string; operations?: string[] }> }>;
		const demoStateTrace = traces[0]?.requestPayloads?.find((item) => item.type === "design_demo_state");

		assert.equal(artifact.kind, "html");
		assert.equal(design.title, "设计工作室");
		assert.equal(design.version, 1);
		assert.deepEqual(demoStateTrace?.operations, []);
		assert.equal(typeof artifact.content, "string");
		assert.match(artifact.content, /<!doctype html>/i);
		assert.match(artifact.content, /设计工作室/);
	});
});

test("design instructions update the preview endpoint", async () => {
	await withWebServer(async (baseUrl) => {
		await postChat(baseUrl, "把标题改成 星河工作室，正文改成 用 AI 做网页，加一个按钮叫 立即开始，风格高级一点");

		const response = await fetch(`${baseUrl}/preview`);
		assert.equal(response.status, 200);
		assert.match(response.headers.get("content-type") ?? "", /text\/html/);
		const html = await response.text();
		assert.match(html, /星河工作室/);
		assert.match(html, /用 AI 做网页/);
		assert.match(html, /立即开始/);
	});
});

test("provider failure does not mutate the design preview", async () => {
	await withWebServer(
		async (baseUrl) => {
			const payload = await postChat(baseUrl, "把标题改成 错误状态不应该出现");
			const design = payload.design as { title?: unknown; version?: unknown };
			const assistant = payload.assistant as { message?: { stopReason?: unknown; errorMessage?: unknown } };

			assert.equal(assistant.message?.stopReason, "error");
			assert.equal(typeof assistant.message?.errorMessage, "string");
			assert.equal(design.title, "设计工作室");
			assert.equal(design.version, 1);

			const preview = await fetch(`${baseUrl}/preview`);
			const html = await preview.text();
			assert.match(html, /设计工作室/);
			assert.doesNotMatch(html, /错误状态不应该出现/);
		},
		{
			DESIGN_AGENT_PROVIDER: "deepseek",
			DESIGN_AGENT_MODEL: "deepseek-v4-flash",
		},
	);
});
