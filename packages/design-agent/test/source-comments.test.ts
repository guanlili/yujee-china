import assert from "node:assert/strict";
import test from "node:test";
import { stripComments } from "./helpers/source-comments.ts";

/**
 * 剥注释工具的自测。
 *
 * 这个函数是本包所有源码正则守卫的地基:它要是漏剥,底下每一道守卫都变成假绿
 * (注释里提一句标识符就把断言喂饱);它要是多剥(误伤字符串字面量),守卫又会假红。
 * 所以它自己必须有测试 —— 本仓已经栽过三次假绿。
 */

test("行注释被剥掉", () => {
	assert.equal(stripComments("a // applyPhotoFilter\nb").includes("applyPhotoFilter"), false);
});

test("块注释被剥掉", () => {
	assert.equal(stripComments("a /* lookAtPhotos */ b").includes("lookAtPhotos"), false);
});

test("跨行块注释被剥掉", () => {
	const source = ["const a = 1;", "/*", " * LUT_DEFINITIONS 里的 { id: 'ghost-lut' }", " */", "const b = 2;"].join("\n");
	const stripped = stripComments(source);
	assert.equal(stripped.includes("ghost-lut"), false);
	assert.match(stripped, /const a = 1;/);
	assert.match(stripped, /const b = 2;/);
});

test("被注释掉的代码行不再命中清单正则", () => {
	// 这是这个函数存在的全部理由:注释掉一条 LUT,清单守卫不该还数它。
	const source = "const LUT = [\n  { id: 'a' },\n  // { id: 'b' },\n  { id: 'c' },\n];";
	const ids = [...stripComments(source).matchAll(/\{\s*id:\s*'([^']+)'/g)].map((match) => match[1]);
	assert.deepEqual(ids, ["a", "c"]);
});

test("字符串字面量里的 // 不误伤", () => {
	assert.equal(stripComments('const x = "// not a comment";').includes("not a comment"), true);
	assert.equal(stripComments("const u = 'https://x';").includes("https://x"), true);
});

test("字符串里的块注释起止符不误伤", () => {
	assert.equal(stripComments('const s = "/* still text */";').includes("still text"), true);
});

test("模板字面量里的 // 不误伤", () => {
	assert.equal(stripComments("const t = `https://y ${a} // keep`;").includes("// keep"), true);
});

test("转义引号不会让状态机把字符串当成结束", () => {
	const source = 'const s = "a \\" // still inside";\nconst after = 1; // gone';
	const stripped = stripComments(source);
	assert.equal(stripped.includes("still inside"), true);
	assert.equal(stripped.includes("gone"), false);
	assert.match(stripped, /const after = 1;/);
});

test("行注释里的 /* 不会吃掉后面的代码", () => {
	const stripped = stripComments("// a /* b\nconst keep = 1;");
	assert.match(stripped, /const keep = 1;/);
});

test("非注释的除号原样保留", () => {
	assert.match(stripComments("const half = total / 2;"), /total \/ 2/);
});
