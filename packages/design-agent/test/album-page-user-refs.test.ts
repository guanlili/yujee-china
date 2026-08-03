import assert from "node:assert/strict";
import test from "node:test";
import {
	type AlbumBookState,
	formatPageUserRef,
	pageUserRefs,
	resolvePageUserRef,
} from "../src/core/album/book-state.ts";

/* 用户口径页码必须与画布 folio 完全一致(2026-08-03 线上「AI 和用户页码差 2」复盘):
   画布 pageFolioInfos 给双宽页(spread 模板)发**两个号**({left,right},计数 +2),
   Agent 侧此前每内页只 +1 —— 书里有几张双宽页,AI 与用户的页码就差几。
   对齐语义:双宽页 = 一个 spread ref(第 L-R 页),说 L 或 R 都指它,后续顺延。 */

const categoryOf = (templateId: string): string | undefined =>
	({ cov: "cover", toc: "toc", end: "ending" })[templateId] ?? "interior";
const isSpread = (templateId: string): boolean => templateId === "wide";

function book(...templateIds: string[]): AlbumBookState {
	return {
		pages: templateIds.map((templateId, i) => ({
			pageIndex: i,
			templateId,
			images: {},
			texts: {},
		})),
	} as unknown as AlbumBookState;
}

test("pageUserRefs:双宽页占两个页码(与画布 folio 同语义),后续内页顺延", () => {
	const state = book("cov", "a", "wide", "b", "end");
	assert.deepEqual(pageUserRefs(state, categoryOf, isSpread), [
		"cover",
		1,
		{ kind: "spread", left: 2, right: 3 },
		4,
		"ending",
	]);
});

test("formatPageUserRef:双宽页说成「第 L-R 页」", () => {
	assert.equal(formatPageUserRef({ kind: "spread", left: 2, right: 3 }), "第 2-3 页");
	assert.equal(formatPageUserRef(4), "第 4 页");
	assert.equal(formatPageUserRef("cover"), "封面");
});

test("resolvePageUserRef:双宽页的左右两个号都指它,后续页码解析不再偏移", () => {
	const state = book("cov", "a", "wide", "b", "end");
	assert.equal(resolvePageUserRef(state, categoryOf, 1, isSpread), 2, "内页 1 = 数组第 2 位");
	assert.equal(resolvePageUserRef(state, categoryOf, 2, isSpread), 3, "页码 2 = 双宽页(左半)");
	assert.equal(resolvePageUserRef(state, categoryOf, 3, isSpread), 3, "页码 3 = 同一张双宽页(右半)");
	assert.equal(resolvePageUserRef(state, categoryOf, 4, isSpread), 4, "双宽页之后顺延,不再差 2");
	assert.equal(resolvePageUserRef(state, categoryOf, "3", isSpread), 3, "字符串数字同样解析");
	assert.equal(resolvePageUserRef(state, categoryOf, 5, isSpread), undefined, "越界明确失败");
});

test("无双宽页的书行为不变(回归守卫)", () => {
	const state = book("cov", "a", "b", "end");
	assert.deepEqual(pageUserRefs(state, categoryOf, isSpread), ["cover", 1, 2, "ending"]);
	assert.equal(resolvePageUserRef(state, categoryOf, 2, isSpread), 3);
});
