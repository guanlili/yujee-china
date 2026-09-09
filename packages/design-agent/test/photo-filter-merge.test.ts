import assert from "node:assert/strict";
import test from "node:test";
import {
	combinePhotoFilterPatches,
	mergePhotoFilterPatch,
	photoFilterStatesEqual,
	type PhotoFilterPatch,
	type PhotoFilterState,
} from "../src/core/album/photo-filter.ts";

/**
 * patch 合并 —— 与 web 侧 `agent-photo-filter.ts` 的 `mergePatch` **同语义**。
 * agent 侧合并只为「本轮内存里的书立刻反映改动」(read_page 要读得到新滤镜);
 * 落库的真相仍由 web 在 album 行锁内用同一份语义重算,两边算不出同一结果就是 bug。
 */

test("patch 是增量合并，没提到的维度原样保留", () => {
	const current: PhotoFilterState = {
		default: { lutId: "retro-film", strength: 40 },
		overrides: { p1: { lutId: "night-film", strength: 60 } },
		cutouts: { p2: true },
	};
	assert.deepEqual(mergePhotoFilterPatch(current, {}), current);
});

test("default 省略=不动，null=整本原片，ref=整本换", () => {
	const current: PhotoFilterState = { default: { lutId: "retro-film", strength: 40 } };
	assert.deepEqual(mergePhotoFilterPatch(current, {}).default, { lutId: "retro-film", strength: 40 });
	assert.equal(mergePhotoFilterPatch(current, { default: null }).default, null);
	assert.deepEqual(mergePhotoFilterPatch(current, { default: { lutId: "night-film", strength: 20 } }).default, {
		lutId: "night-film",
		strength: 20,
	});
});

test("overrides 逐 photoId 合并，null 是「这张显式用原片」而不是删键", () => {
	const current: PhotoFilterState = { default: null, overrides: { p1: { lutId: "retro-film", strength: 40 } } };
	const next = mergePhotoFilterPatch(current, { overrides: { p1: null, p2: { lutId: "night-film", strength: 30 } } });
	assert.ok(Object.hasOwn(next.overrides ?? {}, "p1"), "显式原片必须留着键，否则会退回全书默认");
	assert.equal(next.overrides?.p1, null);
	assert.deepEqual(next.overrides?.p2, { lutId: "night-film", strength: 30 });
});

test("cutouts 的 true 是开、null 是删键 —— 落地状态里绝不出现 false", () => {
	const current: PhotoFilterState = { default: null, cutouts: { p1: true, p2: true } };
	const next = mergePhotoFilterPatch(current, { cutouts: { p1: null, p3: true } });
	assert.deepEqual(next.cutouts, { p2: true, p3: true });
	assert.ok(!JSON.stringify(next).includes("false"));
});

test("cutouts 全关之后连壳一起删掉，不留空对象", () => {
	const current: PhotoFilterState = { default: null, cutouts: { p1: true } };
	const next = mergePhotoFilterPatch(current, { cutouts: { p1: null } });
	assert.equal(next.cutouts, undefined);
});

test("current 为 null 时从空状态起算", () => {
	assert.deepEqual(mergePhotoFilterPatch(null, { default: { lutId: "retro-film", strength: 40 } }), {
		default: { lutId: "retro-film", strength: 40 },
	});
});

test("strength 过 quantizeStrength 归到 5 的倍数", () => {
	const next = mergePhotoFilterPatch(null, { default: { lutId: "retro-film", strength: 63 } });
	assert.equal(next.default?.strength, 65);
});

// ── 累计 patch:一轮对话可能调好几次工具,落库只发一份 ─────────────────────

test("累计两份 patch，后来的覆盖先前的同名键", () => {
	const first: PhotoFilterPatch = { default: { lutId: "retro-film", strength: 40 } };
	const second: PhotoFilterPatch = { default: { lutId: "night-film", strength: 60 } };
	assert.deepEqual(combinePhotoFilterPatches(first, second), { default: { lutId: "night-film", strength: 60 } });
});

test("累计保留互不相干的维度", () => {
	const combined = combinePhotoFilterPatches(
		{ default: { lutId: "retro-film", strength: 40 } },
		{ cutouts: { p1: true } },
	);
	assert.deepEqual(combined, { default: { lutId: "retro-film", strength: 40 }, cutouts: { p1: true } });
});

test("累计里的 cutouts null 必须活到最后 —— 关抠图靠它才落得了库", () => {
	const combined = combinePhotoFilterPatches({ cutouts: { p1: true } }, { cutouts: { p1: null } });
	assert.equal(combined.cutouts?.p1, null);
	assert.ok(Object.hasOwn(combined.cutouts ?? {}, "p1"), "键被丢掉的话 web 侧合并时等于没提到，关不掉");
});

test("累计 default:null 与「没给 default」要能区分", () => {
	const withNull = combinePhotoFilterPatches({ default: { lutId: "retro-film", strength: 40 } }, { default: null });
	assert.equal(withNull.default, null);
	assert.ok(Object.hasOwn(withNull, "default"));
	const without = combinePhotoFilterPatches({ default: { lutId: "retro-film", strength: 40 } }, { cutouts: { p1: true } });
	assert.deepEqual(without.default, { lutId: "retro-film", strength: 40 });
});

// ── 状态比较:分享 warning 只在真的动了东西时才发 ──────────────────────────

test("同值重写不算变化 —— 不刷假警报", () => {
	const state: PhotoFilterState = { default: { lutId: "retro-film", strength: 40 } };
	assert.ok(photoFilterStatesEqual(state, mergePhotoFilterPatch(state, { default: { lutId: "retro-film", strength: 40 } })));
});

test("换了 LUT 算变化", () => {
	const state: PhotoFilterState = { default: { lutId: "retro-film", strength: 40 } };
	assert.ok(!photoFilterStatesEqual(state, mergePhotoFilterPatch(state, { default: { lutId: "night-film", strength: 40 } })));
});

test("开抠图算变化", () => {
	const state: PhotoFilterState = { default: null };
	assert.ok(!photoFilterStatesEqual(state, mergePhotoFilterPatch(state, { cutouts: { p1: true } })));
});

test("null 与空状态视作同一件事", () => {
	assert.ok(photoFilterStatesEqual(null, { default: null }));
	assert.ok(photoFilterStatesEqual(null, null));
});
