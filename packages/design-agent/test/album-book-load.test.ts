import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createAlbumAgentWebServer } from "../src/web/album-server.ts";

// 装书入口(/api/book)对「目录漂移」必须宽容:Web/Postgres 是书的唯一真相,模板目录
// 演进(删槽/改槽名/退役模板)后,存量书带着旧键装书不能被整本 422 挡在门外 ——
// 2026-08-02 线上事故:mag-33 哑槽清除后,老书 texts 里的 body/label/title 触发
// validateAlbumBook 硬拒,设计对话对这些册子永久 400。结构体检结果降级进 warnings,
// 严格校验只留在写工具层(AI 写错槽仍会被拦、可自我纠正)。

async function withAlbumServer<T>(run: (baseUrl: string) => Promise<T>): Promise<T> {
	const server = await createAlbumAgentWebServer({ env: {} });
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
}

test("装书:存量书带过期文字键/退役模板 → 200 + warnings,不再 422 硬拒", async () => {
	await withAlbumServer(async (baseUrl) => {
		const legacyBook = {
			chapters: [{ chapterId: "ch-1", photos: [{ photoId: "p-1" }, { photoId: "p-2" }] }],
			pages: [
				{
					// 线上事故原型:mag-33 的 body/label/title 槽已被哑槽清除,老书还带着。
					pageIndex: 5,
					templateId: "mag-33",
					images: { image1: "p-1", image2: "p-2", image3: "p-1" },
					texts: { body: "旧正文", label: "旧标签", title: "旧标题" },
				},
				{
					// 退役模板(mag-52 已被 mag-55 取代):同属目录漂移,同样只警告。
					pageIndex: 6,
					templateId: "mag-52",
					images: {},
					texts: {},
				},
			],
		};
		const response = await fetch(`${baseUrl}/api/book`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ albumId: "legacy-album", book: legacyBook }),
		});
		assert.equal(response.status, 200);
		const payload = (await response.json()) as { ok?: boolean; warnings?: string[] };
		assert.equal(payload.ok, true);
		assert.ok(Array.isArray(payload.warnings));
		assert.ok(
			(payload.warnings ?? []).length >= 2,
			`目录漂移应以 warnings 呈现,收到:${JSON.stringify(payload.warnings)}`,
		);

		// 书确实装进画布了:state 可读、页数一致。
		const state = await fetch(`${baseUrl}/api/state?albumId=legacy-album`);
		assert.equal(state.status, 200);
		const stateJson = (await state.json()) as { book?: { pages?: unknown[] } };
		assert.equal(stateJson.book?.pages?.length, 2);
	});
});

test("装书:结构性损坏(pages 不是数组)仍然 400 硬失败", async () => {
	await withAlbumServer(async (baseUrl) => {
		const response = await fetch(`${baseUrl}/api/book`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ albumId: "broken", book: { chapters: [], pages: "not-an-array" } }),
		});
		assert.equal(response.status, 400);
	});
});
