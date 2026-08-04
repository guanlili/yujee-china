import assert from "node:assert/strict";
import test from "node:test";
import type { AlbumBookState } from "../src/core/album/book-state.ts";
import type { TemplateCatalog } from "../src/core/album/templates-catalog.ts";
import { composeChatTurn, currentPageLabelFor } from "../src/web/album-server.ts";

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

/* currentPageLabelFor:界面上下文标签必须与画布 folio 同口径(含双宽页占两个号)。
   2026-08-04 线上复盘:这里此前没接双宽判定,书里有几张双宽页,标签就比画布少几号
   (实测 Page 130 被说成第 110 页);AI 顺着错标签再用工具寻址,读的还是别人家的页。 */

const catalog = {
	get: (templateId: string) =>
		({
			cov: { category: "cover" },
			pg: { category: "interior" },
			wide: { category: "interior", spread: true },
		})[templateId],
	list: () => [],
	ids: () => [],
} as unknown as TemplateCatalog;

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

test("currentPageLabelFor:双宽页占两个号,标签与画布 folio 一致", () => {
	const state = book("cov", "pg", "wide", "pg");
	assert.equal(currentPageLabelFor(state, catalog, 1), "第 1 页");
	assert.equal(currentPageLabelFor(state, catalog, 2), "第 2-3 页", "双宽页本身是 spread ref");
	assert.equal(currentPageLabelFor(state, catalog, 3), "第 4 页", "双宽页之后顺延,不再少号");
});

test("currentPageLabelFor:封面用类别名,越界回 undefined(交给自然页序兜底)", () => {
	const state = book("cov", "pg", "wide", "pg");
	assert.equal(currentPageLabelFor(state, catalog, 0), "封面");
	assert.equal(currentPageLabelFor(state, catalog, 99), undefined);
});
