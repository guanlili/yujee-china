import assert from "node:assert/strict";
import test from "node:test";
import type { PhotoFilterState } from "../src/core/album/photo-filter.ts";
import { createPhotoFilterSeam } from "../src/web/album-photo-seams.ts";

/**
 * 滤镜/抠图的本地 seam。
 *
 * agent **不直接写库**(album-server 抬头的既有约定:写入后的书由响应带回,调用方
 * 负责持久化)。所以这个 seam 只做三件事:合进内存里的书、累计 patch 供响应带回、
 * 在书已分享时给出提醒。真正落库由 web 的 applyAgentPhotoFilter 在 album 行锁内做。
 */

function createHarness(options?: { initial?: PhotoFilterState | null; hasPublishedShare?: boolean }) {
	let state: PhotoFilterState | null = options?.initial ?? null;
	const seam = createPhotoFilterSeam({
		getState: () => state,
		setState: (next) => {
			state = next;
		},
		hasPublishedShare: () => options?.hasPublishedShare === true,
	});
	return { seam, getState: () => state };
}

test("patch 立刻合进内存的书 —— 同一轮里 read_page 要读得到新滤镜", async () => {
	const { seam, getState } = createHarness();
	await seam.apply({ default: { lutId: "travel-cinematic", strength: 60 } });
	assert.deepEqual(getState()?.default, { lutId: "travel-cinematic", strength: 60 });
});

test("累计 patch 供响应带回，多次调用合成一份", async () => {
	const { seam } = createHarness();
	await seam.apply({ default: { lutId: "travel-cinematic", strength: 60 } });
	await seam.apply({ cutouts: { p1: true } });
	assert.deepEqual(seam.pending(), {
		default: { lutId: "travel-cinematic", strength: 60 },
		cutouts: { p1: true },
	});
});

test("没动过时 pending 是 null —— web 据此决定要不要落库", () => {
	assert.equal(createHarness().seam.pending(), null);
});

test("关抠图的 null 必须活到 pending 里", async () => {
	const { seam, getState } = createHarness({ initial: { default: null, cutouts: { p1: true } } });
	await seam.apply({ cutouts: { p1: null } });
	assert.equal(seam.pending()?.cutouts?.p1, null);
	assert.equal(getState()?.cutouts, undefined, "内存状态里是删键，不留 false 也不留空壳");
	assert.ok(!JSON.stringify(seam.pending()).includes("false"));
});

test("reset 清空累计 —— 每次装书都从干净的账开始，不重复落已经落过的库", async () => {
	const { seam } = createHarness();
	await seam.apply({ default: null });
	seam.reset();
	assert.equal(seam.pending(), null);
});

test("没分享过的书不出警告", async () => {
	const { seam } = createHarness();
	const result = await seam.apply({ default: { lutId: "travel-cinematic", strength: 60 } });
	assert.deepEqual(result.warnings, []);
});

test("分享过的书改滤镜要出警告，让 Agent 转告用户", async () => {
	const { seam } = createHarness({ hasPublishedShare: true });
	const result = await seam.apply({ default: { lutId: "travel-cinematic", strength: 60 } });
	assert.equal(result.warnings.length, 1);
	assert.match(result.warnings[0] ?? "", /分享/);
	assert.match(result.warnings[0] ?? "", /重新备份|重新分享/);
});

test("分享过的书开抠图同样要出警告", async () => {
	const { seam } = createHarness({ hasPublishedShare: true });
	assert.equal((await seam.apply({ cutouts: { p1: true } })).warnings.length, 1);
});

test("同值重写不出警告 —— 什么都没变就别刷假警报", async () => {
	const { seam } = createHarness({
		initial: { default: { lutId: "travel-cinematic", strength: 60 } },
		hasPublishedShare: true,
	});
	const result = await seam.apply({ default: { lutId: "travel-cinematic", strength: 60 } });
	assert.deepEqual(result.warnings, []);
});

test("警告不点名具体 photoId —— 精确算 renderVersion 要镜像 web 的算法，白多一个漂移面", async () => {
	const { seam } = createHarness({ hasPublishedShare: true });
	const warning = (await seam.apply({ cutouts: { p1: true, p2: true } })).warnings[0] ?? "";
	assert.ok(!warning.includes("p1") && !warning.includes("p2"));
});

test("同值重写虽不警告，patch 仍要带回 —— 落库口径由 web 定，agent 不替它省这一笔", async () => {
	const { seam } = createHarness({ initial: { default: { lutId: "travel-cinematic", strength: 60 } } });
	await seam.apply({ default: { lutId: "travel-cinematic", strength: 60 } });
	assert.notEqual(seam.pending(), null);
});
