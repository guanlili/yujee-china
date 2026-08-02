import assert from "node:assert/strict";
import test from "node:test";
import type { AlbumPage } from "../src/core/album/book-state.ts";
import { applyPageMoves, type PageMoveOperation } from "../src/core/album/page-move.ts";

// 6 页假书:cover + 内页A..D + ending。对象身份即页身份。
function makeBook(): AlbumPage[] {
	return ["cover", "A", "B", "C", "D", "ending"].map((id, i) => ({
		pageIndex: i,
		templateId: id,
		images: {},
		texts: { name: id },
	}));
}
const isInterior = (p: AlbumPage) => p.templateId !== "cover" && p.templateId !== "ending";
const labelOf = (no: number) => `第${no}位`;
const names = (pages: AlbumPage[]) => pages.map((p) => p.templateId).join(",");
const apply = (pages: AlbumPage[], ops: PageMoveOperation[]) =>
	applyPageMoves(pages, isInterior, ops, labelOf);

test("move after:把 D 挪到 A 后面", () => {
	const book = makeBook();
	const out = apply(book, [{ type: "move", pageNo: 5, after: 2 }]);
	assert.equal(names(out), "cover,A,D,B,C,ending");
	assert.equal(out[2], book[4], "必须是同一个对象,不是副本");
	assert.equal(names(book), "cover,A,B,C,D,ending", "输入数组不被改动");
});

test("move before:把 A 挪到 D 前面", () => {
	const out = apply(makeBook(), [{ type: "move", pageNo: 2, before: 5 }]);
	assert.equal(names(out), "cover,B,C,A,D,ending");
});

test("锚点可以是封面/封尾:after 封面=挪到最前,before 封尾=挪到最后", () => {
	assert.equal(names(apply(makeBook(), [{ type: "move", pageNo: 4, after: 1 }])), "cover,C,A,B,D,ending");
	assert.equal(names(apply(makeBook(), [{ type: "move", pageNo: 2, before: 6 }])), "cover,B,C,D,A,ending");
});

test("swap:远距两页对调", () => {
	const out = apply(makeBook(), [{ type: "swap", a: 2, b: 5 }]);
	assert.equal(names(out), "cover,D,B,C,A,ending");
});

test("多步复合:引用全按调用前页序,锚点自己被挪过也不错位", () => {
	// 先把 A 挪到 D 后,再把 B 挪到 A(原第 2 位那页)后 —— 第二步的锚点 A 已经换过位置。
	const out = apply(makeBook(), [
		{ type: "move", pageNo: 2, after: 5 },
		{ type: "move", pageNo: 3, after: 2 },
	]);
	assert.equal(names(out), "cover,C,D,A,B,ending");
});

test("拒绝:封面/目录/封尾作源", () => {
	assert.throws(() => apply(makeBook(), [{ type: "move", pageNo: 1, after: 3 }]), /只能挪内页/);
	assert.throws(() => apply(makeBook(), [{ type: "swap", a: 6, b: 2 }]), /只能挪内页/);
});

test("拒绝:锚定页被平移(before 封面)", () => {
	assert.throws(() => apply(makeBook(), [{ type: "move", pageNo: 3, before: 1 }]), /封面|封尾|目录|位置不能/);
});

test("拒绝:swap 两页相同 / move 锚点是自己 / before-after 同给或都不给", () => {
	assert.throws(() => apply(makeBook(), [{ type: "swap", a: 3, b: 3 }]), /不能相同/);
	assert.throws(() => apply(makeBook(), [{ type: "move", pageNo: 3, after: 3 }]), /自己/);
	assert.throws(() => apply(makeBook(), [{ type: "move", pageNo: 3, before: 2, after: 4 }]), /恰好/);
	assert.throws(() => apply(makeBook(), [{ type: "move", pageNo: 3 }]), /恰好/);
});

test("拒绝:恒等净效果(挪了又挪回去)", () => {
	assert.throws(
		() => apply(makeBook(), [{ type: "swap", a: 2, b: 3 }, { type: "swap", a: 2, b: 3 }]),
		/没有改变页序/,
	);
});

test("拒绝:位置越界/空操作数组", () => {
	assert.throws(() => apply(makeBook(), [{ type: "move", pageNo: 99, after: 2 }]), /不存在/);
	assert.throws(() => apply(makeBook(), []), /至少/);
});

test("不变量:任何合法结果都是同一批对象的排列", () => {
	const book = makeBook();
	const out = apply(book, [{ type: "move", pageNo: 5, after: 2 }, { type: "swap", a: 3, b: 4 }]);
	assert.deepEqual(new Set(out), new Set(book));
	assert.equal(out.length, book.length);
});
