import assert from "node:assert/strict";
import test from "node:test";
import { composeChatTurn } from "../src/web/album-server.ts";

test("composeChatTurn:带当前页时前缀界面上下文,原话保留在正文", () => {
	// 用户口径:调用方传入按书状态换算好的称呼;上下文不再暴露内部 pageIndex。
	const turn = composeChatTurn("这页的标题换个写法", 4, undefined, "第 3 页");
	assert.ok(turn.startsWith("【界面上下文】"));
	assert.ok(turn.includes("第 3 页"));
	assert.equal(turn.includes("pageIndex"), true); // 仅出现在「不要提内部 pageIndex」的提醒里
	assert.equal(turn.includes("pageIndex=4"), false);
	assert.ok(turn.endsWith("这页的标题换个写法"));
});

test("composeChatTurn:未换算出称呼时退化为自然页序(兜底)", () => {
	const turn = composeChatTurn("这页的标题换个写法", 4);
	assert.ok(turn.includes("第 5 页"));
});

test("composeChatTurn:未提供当前页时原样透传", () => {
	assert.equal(composeChatTurn("整本换个配色", undefined), "整本换个配色");
});
