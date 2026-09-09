import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ALBUM_WRITE_TOOL_NAMES, createAlbumAgentWebServer } from "../src/web/album-server.ts";

/**
 * 三个 seam 的接线:滤镜/抠图走「响应带回」,look_at_photos 走 internal 端点取图。
 *
 * 接线不通 = 三个工具在线上根本不注册,功能等于没通电 —— 单测全绿也照样是死的。
 */

async function withAlbumServer<T>(
	run: (baseUrl: string) => Promise<T>,
	env: Record<string, string | undefined> = {},
): Promise<T> {
	const server = await createAlbumAgentWebServer({ env });
	await new Promise<void>((resolve) => {
		server.listen(0, "127.0.0.1", resolve);
	});
	const address = server.address() as AddressInfo;
	try {
		return await run(`http://127.0.0.1:${address.port}`);
	} finally {
		await new Promise<void>((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()));
		});
	}
}

const BOOK = {
	version: 1,
	chapters: [{ chapterId: "c1", photos: [{ photoId: "p1" }, { photoId: "p2" }] }],
	pages: [{ pageIndex: 0, templateId: "mag-05", images: { image: "p1" }, texts: {} }],
	photoFilter: { default: { lutId: "travel-cinematic", strength: 60 } },
};

async function loadBook(baseUrl: string, body: Record<string, unknown>): Promise<Response> {
	return fetch(`${baseUrl}/api/book`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

async function readState(baseUrl: string, albumId: string): Promise<Record<string, any>> {
	const response = await fetch(`${baseUrl}/api/state?albumId=${albumId}`);
	return (await response.json()) as Record<string, any>;
}

test("装书带回相册语境:hasPublishedShare + viewablePhotoIds", async () => {
	await withAlbumServer(async (baseUrl) => {
		const response = await loadBook(baseUrl, {
			albumId: "a1",
			book: BOOK,
			hasPublishedShare: true,
			viewablePhotoIds: ["p1", "p2"],
		});
		assert.equal(response.status, 200);
		const state = await readState(baseUrl, "a1");
		assert.equal(state.context.hasPublishedShare, true);
		assert.deepEqual(state.context.viewablePhotoIds, ["p1", "p2"]);
		assert.deepEqual(state.book.photoFilter.default, { lutId: "travel-cinematic", strength: 60 });
	});
});

test("没传相册语境时取保守默认 —— 不假设书没分享过就乱改也不假装有图可看", async () => {
	await withAlbumServer(async (baseUrl) => {
		await loadBook(baseUrl, { albumId: "a2", book: BOOK });
		const state = await readState(baseUrl, "a2");
		assert.equal(state.context.hasPublishedShare, false);
		assert.deepEqual(state.context.viewablePhotoIds, []);
	});
});

test("每轮重新装书都会刷新相册语境 —— 分享状态在两轮之间会变", async () => {
	await withAlbumServer(async (baseUrl) => {
		await loadBook(baseUrl, { albumId: "a3", book: BOOK, hasPublishedShare: false });
		await loadBook(baseUrl, { albumId: "a3", book: BOOK, hasPublishedShare: true, viewablePhotoIds: ["p1"] });
		const state = await readState(baseUrl, "a3");
		assert.equal(state.context.hasPublishedShare, true);
		assert.deepEqual(state.context.viewablePhotoIds, ["p1"]);
	});
});

test("装书后累计 patch 是空的 —— 上一轮的改动已经由 web 落过库", async () => {
	await withAlbumServer(async (baseUrl) => {
		await loadBook(baseUrl, { albumId: "a4", book: BOOK });
		assert.equal((await readState(baseUrl, "a4")).photoFilterPatch, null);
	});
});

// ── 终止写工具集合:漏一个,终稿那步的文本会被当成中间步重复冒泡 ───────────

test("三个新写工具都在 ALBUM_WRITE_TOOL_NAMES 里", () => {
	for (const name of ["set_image_pos", "set_photo_filter", "set_photo_cutout"]) {
		assert.ok(ALBUM_WRITE_TOOL_NAMES.has(name), `${name} 走 terminate,漏在集合外会让终稿气泡重文`);
	}
});

// ── 接线守卫 ────────────────────────────────────────────────────────────
// ⚠️ 源码正则守卫必须**先剥注释**再断言 —— 否则注释里提一句工具名就把断言喂饱,
// 假绿。本仓踩过这个坑(2026-09-09 web 侧 DESIGN_WRITE_TOOLS 那次)。

function albumServerCode(): string {
	const source = readFileSync(fileURLToPath(new URL("../src/web/album-server.ts", import.meta.url)), "utf8");
	return stripComments(source);
}

/** 去掉 // 行注释与 /* *\/ 块注释;字符串字面量里的 // 不误伤(用最朴素的状态机)。 */
export function stripComments(source: string): string {
	let out = "";
	let index = 0;
	let quote: string | null = null;
	while (index < source.length) {
		const char = source[index]!;
		const next = source[index + 1];
		if (quote) {
			if (char === "\\") {
				out += char + (next ?? "");
				index += 2;
				continue;
			}
			if (char === quote) quote = null;
			out += char;
			index += 1;
			continue;
		}
		if (char === '"' || char === "'" || char === "`") {
			quote = char;
			out += char;
			index += 1;
			continue;
		}
		if (char === "/" && next === "/") {
			while (index < source.length && source[index] !== "\n") index += 1;
			continue;
		}
		if (char === "/" && next === "*") {
			index += 2;
			while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) index += 1;
			index += 2;
			continue;
		}
		out += char;
		index += 1;
	}
	return out;
}

test("剥注释的小工具本身是对的（否则守卫全是假绿）", () => {
	assert.equal(stripComments("a // applyPhotoFilter\nb").includes("applyPhotoFilter"), false);
	assert.equal(stripComments("a /* lookAtPhotos */ b").includes("lookAtPhotos"), false);
	assert.equal(stripComments('const x = "// not a comment";').includes("not a comment"), true);
	assert.equal(stripComments("const u = 'https://x';").includes("https://x"), true);
});

test("接线:createAlbumTools 真的收到了 applyPhotoFilter 与 lookAtPhotos", () => {
	const code = albumServerCode();
	assert.match(code, /createAlbumTools\(\{[\s\S]*?applyPhotoFilter:/);
	assert.match(code, /createAlbumTools\(\{[\s\S]*?lookAtPhotos:/);
});

test("接线:滤镜 seam 用的是 createPhotoFilterSeam，不是就地手写一份合并", () => {
	assert.match(albumServerCode(), /createPhotoFilterSeam\(/);
});

test("接线:取图用的是 createWebPhotoFetcher + resolveWebBridgeConfig", () => {
	const code = albumServerCode();
	assert.match(code, /resolveWebBridgeConfig\(/);
	assert.match(code, /createWebPhotoFetcher\(/);
});

test("接线:/api/chat 响应带回 photoFilter 与累计的 photoFilterPatch", () => {
	const code = albumServerCode();
	assert.match(code, /photoFilter:/);
	assert.match(code, /photoFilterPatch:/);
});

test("接线:装书时 reset 累计 patch —— 不重复落已经落过的库", () => {
	assert.match(albumServerCode(), /\.reset\(\)/);
});

// ── 真的注册上了吗 ──────────────────────────────────────────────────────
// 源码正则只能证明「代码里写了这一笔」,证明不了「工具真的出现在模型的菜单里」。
// /api/state 把 runtime 实际注册的工具名吐出来,接线通没通一眼可见(也是线上排查
// 「Agent 怎么不给我调色」的第一手证据)。

test("滤镜/抠图工具在 seam 接通后真的注册了", async () => {
	await withAlbumServer(async (baseUrl) => {
		await loadBook(baseUrl, { albumId: "t1", book: BOOK });
		const names: string[] = (await readState(baseUrl, "t1")).toolNames;
		assert.ok(names.includes("set_photo_filter"), names.join(","));
		assert.ok(names.includes("set_photo_cutout"), names.join(","));
		assert.ok(names.includes("set_image_pos"), names.join(","));
	});
});

test("没配 WEB_BASE_URL/AGENT_SHARED_SECRET 时 look_at_photos 不注册", async () => {
	await withAlbumServer(async (baseUrl) => {
		await loadBook(baseUrl, { albumId: "t2", book: BOOK });
		assert.ok(!((await readState(baseUrl, "t2")).toolNames as string[]).includes("look_at_photos"));
	});
});

test("配齐取图桥之后 look_at_photos 就注册了", async () => {
	await withAlbumServer(
		async (baseUrl) => {
			await loadBook(baseUrl, { albumId: "t3", book: BOOK });
			const names: string[] = (await readState(baseUrl, "t3")).toolNames;
			assert.ok(names.includes("look_at_photos"), names.join(","));
		},
		{ WEB_BASE_URL: "https://web.example.com", AGENT_SHARED_SECRET: "s3cret" },
	);
});
