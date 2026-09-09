import assert from "node:assert/strict";
import test from "node:test";
import { createWebPhotoFetcher, resolveWebBridgeConfig } from "../src/web/photo-fetch.ts";

/**
 * look_at_photos 的取图通道:按需 POST 到 web 的 internal 端点拿字节。
 *
 * 为什么不是装书时把图一起传过来:一本书几十张,base64 全塞进装书请求太贵,而看图
 * 是兜底路径,绝大多数对话一张都不看。
 * 为什么不是签名 URL:SDK 的 ImageContent 只收 base64(data + mimeType),没有 URL
 * 变体 —— 图终究要经过 agent 进程。
 */

interface StubCall {
	url: string;
	init: RequestInit;
}

function stubFetch(
	respond: (call: StubCall) => { status?: number; body: unknown },
): { impl: typeof fetch; calls: StubCall[] } {
	const calls: StubCall[] = [];
	const impl = (async (input: string | URL | Request, init?: RequestInit) => {
		const call = { url: String(input), init: init ?? {} };
		calls.push(call);
		const { status = 200, body } = respond(call);
		return new Response(JSON.stringify(body), {
			status,
			headers: { "content-type": "application/json" },
		});
	}) as unknown as typeof fetch;
	return { impl, calls };
}

const okBody = (photoIds: string[]) => ({
	ok: true,
	data: {
		photos: photoIds.map((photoId) => ({ photoId, data: "aGVsbG8=", mimeType: "image/jpeg" })),
		skipped: [],
	},
});

test("按 albumId + photoIds POST 到 internal 端点", async () => {
	const { impl, calls } = stubFetch((call) => ({ body: okBody(JSON.parse(String(call.init.body)).photoIds) }));
	const fetcher = createWebPhotoFetcher({
		baseUrl: "https://web.example.com",
		secret: "s3cret",
		albumId: "album-1",
		fetchImpl: impl,
	});
	await fetcher(["p1", "p2"]);
	assert.equal(calls.length, 1);
	assert.equal(calls[0]?.url, "https://web.example.com/api/v3/internal/photo-bytes");
	assert.equal(calls[0]?.init.method, "POST");
	assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), { albumId: "album-1", photoIds: ["p1", "p2"] });
});

test("带 shared secret —— 与 job-progress / agent-data 同款鉴权", () => {
	const { impl, calls } = stubFetch(() => ({ body: okBody(["p1"]) }));
	const fetcher = createWebPhotoFetcher({
		baseUrl: "https://web.example.com",
		secret: "s3cret",
		albumId: "a",
		fetchImpl: impl,
	});
	return fetcher(["p1"]).then(() => {
		const headers = calls[0]?.init.headers as Record<string, string>;
		assert.equal(headers.authorization ?? headers.Authorization, "Bearer s3cret");
	});
});

test("baseUrl 末尾多余的斜杠不会拼出双斜杠", async () => {
	const { impl, calls } = stubFetch(() => ({ body: okBody(["p1"]) }));
	await createWebPhotoFetcher({ baseUrl: "https://web.example.com/", albumId: "a", fetchImpl: impl })(["p1"]);
	assert.equal(calls[0]?.url, "https://web.example.com/api/v3/internal/photo-bytes");
});

test("解出 { photoId, data, mimeType } 三元组", async () => {
	const { impl } = stubFetch(() => ({ body: okBody(["p1", "p2"]) }));
	const out = await createWebPhotoFetcher({ baseUrl: "https://w", albumId: "a", fetchImpl: impl })(["p1", "p2"]);
	assert.deepEqual(out, [
		{ photoId: "p1", data: "aGVsbG8=", mimeType: "image/jpeg" },
		{ photoId: "p2", data: "aGVsbG8=", mimeType: "image/jpeg" },
	]);
});

test("被跳过的照片不进结果，但要抛不出来 —— 少几张不该让整次调用失败", async () => {
	const { impl } = stubFetch(() => ({
		body: {
			ok: true,
			data: {
				photos: [{ photoId: "p1", data: "aGVsbG8=", mimeType: "image/jpeg" }],
				skipped: [{ photoId: "p2", reason: "missing" }],
			},
		},
	}));
	const out = await createWebPhotoFetcher({ baseUrl: "https://w", albumId: "a", fetchImpl: impl })(["p1", "p2"]);
	assert.deepEqual(out.map((entry) => entry.photoId), ["p1"]);
});

test("一张都取不到时抛错 —— 让模型知道它没看到图，别凭空编", async () => {
	const { impl } = stubFetch(() => ({ body: { ok: true, data: { photos: [], skipped: [] } } }));
	await assert.rejects(
		() => createWebPhotoFetcher({ baseUrl: "https://w", albumId: "a", fetchImpl: impl })(["p1"]),
		/取不到|没有/,
	);
});

test("非 2xx 抛错并带上状态码", async () => {
	const { impl } = stubFetch(() => ({ status: 401, body: { ok: false, error: { code: "AGENT_UNAUTHORIZED" } } }));
	await assert.rejects(
		() => createWebPhotoFetcher({ baseUrl: "https://w", albumId: "a", fetchImpl: impl })(["p1"]),
		/401/,
	);
});

test("响应形状不对时抛错，不返回半截数据", async () => {
	const { impl } = stubFetch(() => ({ body: { ok: true, data: { photos: "nope" } } }));
	await assert.rejects(() => createWebPhotoFetcher({ baseUrl: "https://w", albumId: "a", fetchImpl: impl })(["p1"]));
});

// ── 配置解析:没配 web 地址就不给 seam,工具因此不注册 ─────────────────────

test("配齐 WEB_BASE_URL + AGENT_SHARED_SECRET 才给出配置", () => {
	assert.deepEqual(
		resolveWebBridgeConfig({ WEB_BASE_URL: "https://web.example.com", AGENT_SHARED_SECRET: "s3cret" }),
		{ baseUrl: "https://web.example.com", secret: "s3cret" },
	);
});

test("缺 WEB_BASE_URL 返回 undefined —— 宁可不注册 look_at_photos", () => {
	assert.equal(resolveWebBridgeConfig({ AGENT_SHARED_SECRET: "s3cret" }), undefined);
	assert.equal(resolveWebBridgeConfig({ WEB_BASE_URL: "   ", AGENT_SHARED_SECRET: "s3cret" }), undefined);
});

test("缺 secret 也返回 undefined —— 无鉴权的取图调用一定被 401 打回", () => {
	assert.equal(resolveWebBridgeConfig({ WEB_BASE_URL: "https://web.example.com" }), undefined);
});
