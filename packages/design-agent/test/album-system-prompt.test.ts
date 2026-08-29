import assert from "node:assert/strict";
import test from "node:test";
import { buildAlbumSystemPrompt } from "../src/core/album/system-prompt.ts";

/* 系统提示词的两条产品约束(2026-08-08,用户反馈:回复里漏 mg01/字体 id,模糊反馈老追问):
   1) 模糊审美反馈直接动手换,不追问;
   2) 用户可见回复禁止任何内部标识,要说人话(中文字体名/版式变化描述)。
   本地 trace 实锤过字体 id 泄漏(playfair-display/noto-serif-sc 直接进回复),
   禁令必须逐类点名,只写「模板 id」拦不住。 */

function promptOf(): string {
	return buildAlbumSystemPrompt({
		activeTools: [],
		resources: { skills: [], promptTemplates: [] },
	} as never);
}

test("系统提示词:模糊审美反馈要求直接动手,不许追问哪里不好", () => {
	const prompt = promptOf();
	assert.match(prompt, /这页不好看/, "必须点名模糊反馈的典型句式,给模型可对照的触发例");
	assert.match(prompt, /不要追问/, "明确禁止反问");
	assert.match(prompt, /直接动手/, "明确要求直接行动");
});

test("系统提示词:内部标识禁令逐类点名(模板 id/字体 id/槽 id/photoId/风格 id)", () => {
	const prompt = promptOf();
	assert.match(prompt, /模板 id（如 mg01）/, "模板 id 要带实例");
	assert.match(prompt, /字体 id（如 noto-serif-sc）/, "字体 id 要带实例——2026-08-07 trace 里泄漏的就是它");
	assert.match(prompt, /槽 id/, "槽 id 在禁令内");
	assert.match(prompt, /photoId/, "photoId 在禁令内");
	assert.match(
		prompt,
		/风格 id（如 dopamine）/,
		"风格 id 要带实例——四风格新引入的标识，模型很可能直接对用户说「换成了 dopamine 风格」",
	);
});

test("系统提示词:给出说人话的替代口径(中文字体名/版式变化/风格中文名)", () => {
	const prompt = promptOf();
	assert.match(prompt, /思源宋体/, "字体的正确说法示例");
	assert.match(prompt, /版式/, "模板的正确说法是描述版式变化");
	assert.match(prompt, /多巴胺|素白散文/, "风格的正确说法是中文名，不说 id");
});
