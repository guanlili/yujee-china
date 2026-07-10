import assert from "node:assert/strict";
import test from "node:test";
import { composeChatTurn } from "../src/web/album-server.ts";

test("composeChatTurn:带当前页时前缀界面上下文,原话保留在正文", () => {
	const turn = composeChatTurn("这页的标题换个写法", 4);
	assert.ok(turn.startsWith("【界面上下文】"));
	assert.ok(turn.includes("pageIndex=4"));
	assert.ok(turn.includes("第 5 页"));
	assert.ok(turn.endsWith("这页的标题换个写法"));
});

test("composeChatTurn:未提供当前页时原样透传", () => {
	assert.equal(composeChatTurn("整本换个配色", undefined), "整本换个配色");
});
