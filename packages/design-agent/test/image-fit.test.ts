import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { PhotoProfile } from "@yujee/contracts";
import { resolveImagePos } from "../src/core/album/image-fit.ts";

const profile = (over: Partial<PhotoProfile> = {}): PhotoProfile =>
	({
		v: 1,
		subjectBox: { x: 10, y: 20, w: 40, h: 40 },
		faceBoxes: [],
		maskKey: null,
		colorTemp: "warm",
		brightness: "mid",
		saturation: "normal",
		dominantColors: [],
		composition: "focal",
		scene: "outdoor",
		peopleCount: "1",
		mood: "warm",
		description: "",
		...over,
	}) as PhotoProfile;

test("center-subject 把 object-position 落在主体中心", () => {
	// subjectBox x=10 w=40 => 中心 30；y=20 h=40 => 中心 40
	assert.deepEqual(resolveImagePos("center-subject", profile()), { x: 30, y: 40, scale: 1 });
});

test("没有档案时退回默认，绝不瞎猜", () => {
	assert.deepEqual(resolveImagePos("center-subject", undefined), { x: 50, y: 50, scale: 1 });
});

test("subjectBox 为 null（纯风景）时退回默认", () => {
	assert.deepEqual(resolveImagePos("center-subject", profile({ subjectBox: null })), { x: 50, y: 50, scale: 1 });
});

test("fill 永远是 50/50/1，不看档案", () => {
	assert.deepEqual(resolveImagePos("fill", profile()), { x: 50, y: 50, scale: 1 });
	assert.deepEqual(
		resolveImagePos("fill", profile({ faceBoxes: [{ x: 80, y: 80, w: 10, h: 10 }] })),
		{ x: 50, y: 50, scale: 1 },
	);
});

test("avoid-face-crop 用所有人脸的并集中心", () => {
	const p = profile({
		faceBoxes: [
			{ x: 10, y: 10, w: 10, h: 10 },
			{ x: 50, y: 30, w: 10, h: 10 },
		],
	});
	// 并集 x:10..60 => 中心 35；y:10..40 => 中心 25
	assert.deepEqual(resolveImagePos("avoid-face-crop", p), { x: 35, y: 25, scale: 1 });
});

test("avoid-face-crop 没有脸时退回 center-subject", () => {
	// 没检测到脸不等于没主体。
	assert.deepEqual(resolveImagePos("avoid-face-crop", profile()), { x: 30, y: 40, scale: 1 });
});

test("avoid-face-crop 既没脸也没主体时退回默认", () => {
	assert.deepEqual(resolveImagePos("avoid-face-crop", profile({ subjectBox: null })), {
		x: 50,
		y: 50,
		scale: 1,
	});
});

test("结果永远被夹在 0-100，且 scale 不小于 1", () => {
	const p = profile({ subjectBox: { x: 95, y: 95, w: 20, h: 20 } });
	const out = resolveImagePos("center-subject", p);
	assert.ok(out.x >= 0 && out.x <= 100 && out.y >= 0 && out.y <= 100);
	assert.ok(out.scale >= 1);
});

test("坐标口径是 0-100，不是 0-1", () => {
	// 铁律:与 imagePos 的 objectPosition 同口径。返回 0-1 会让整条链路静默错位。
	const out = resolveImagePos("center-subject", profile({ subjectBox: { x: 60, y: 60, w: 20, h: 20 } }));
	assert.deepEqual(out, { x: 70, y: 70, scale: 1 });
});

// ── 人脸框现在恒空(A 线拍板不接 YuNet)────────────────────────────────────
// PhotoProfile.faceBoxes 在生产恒返回 [],所以 avoid-face-crop **必然**退化成
// center-subject。这不是 bug,是当下的既定事实 —— 下面两条钉住退化路径是对的,
// 免得后人看到「avoid-face-crop 和 center-subject 结果一样」以为坏了就去乱改。

test("生产现状:faceBoxes 恒空时 avoid-face-crop 等同于 center-subject", () => {
	const p = profile({ faceBoxes: [] });
	assert.deepEqual(resolveImagePos("avoid-face-crop", p), resolveImagePos("center-subject", p));
});

test("image-fit 顶部注释写明人脸框恒空这件事", () => {
	const source = readFileSync(fileURLToPath(new URL("../src/core/album/image-fit.ts", import.meta.url)), "utf8");
	assert.match(source, /faceBoxes/);
	assert.match(source, /恒空|恒为空|一直是空/);
});
