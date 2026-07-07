import assert from "node:assert/strict";
import test from "node:test";
import { createInitialDesignDemoState } from "../src/core/artifacts/design-demo.ts";
import type { DesignCoreSkill } from "../src/core/skills/index.ts";
import { createDesignTools } from "../src/core/tools/index.ts";

test("design tools expose artifact summary and bounded read access", async () => {
	let state = {
		...createInitialDesignDemoState(new Date("2026-07-06T00:00:00.000Z")),
		artifactHtml: "",
	};
	const html = [
		"<!doctype html>",
		"<html><body>",
		'<section id="hero"><h1>设计工具测试</h1><p>这里只是一小段。</p></section>',
		"</body></html>",
	].join("");
	state = { ...state, artifactHtml: html };
	const tools = createDesignTools({
		getDesignState: () => state,
		setDesignState: (nextState) => {
			state = nextState;
		},
		now: () => new Date("2026-07-06T01:00:00.000Z"),
	});

	assert.deepEqual(
		tools.map((tool) => tool.name),
		[
			"get_artifact_summary",
			"read_artifact",
			"read_full_artifact",
			"search_artifact",
			"replace_artifact",
			"replace_artifact_range",
			"read_skill",
		],
	);

	const summaryResult = await tools[0]?.execute("tool-call-1", {}, undefined);
	const readResult = await tools[1]?.execute("tool-call-2", { start: 0, length: 80 }, undefined);
	const searchResult = await tools[3]?.execute("tool-call-3", { query: "设计工具测试" }, undefined);
	const replaceStart = html.indexOf("设计工具测试");
	const replaceRangeTool = tools.find((tool) => tool.name === "replace_artifact_range");
	const replaceResult = await replaceRangeTool?.execute(
		"tool-call-4",
		{ start: replaceStart, length: "设计工具测试".length, replacementHtml: "局部替换成功" },
		undefined,
	);

	assert.match(summaryResult?.content[0]?.text ?? "", /设计工具测试/);
	assert.match(readResult?.content[0]?.text ?? "", /<!doctype html>/);
	assert.equal(readResult?.details?.truncated, true);
	assert.match(searchResult?.content[0]?.text ?? "", /start=/);
	assert.equal(searchResult?.details?.totalMatches, 1);
	assert.match(replaceResult?.content[0]?.text ?? "", /局部替换成功/);
	assert.equal(replaceResult?.terminate, true);
	assert.match(state.artifactHtml, /局部替换成功/);
	assert.equal(state.version, 2);
	assert.equal(state.updatedAt, "2026-07-06T01:00:00.000Z");
});

test("replace_artifact replaces the whole HTML without leaving old trailing content", async () => {
	const oldHtml = "<!doctype html><html><body><main>旧页面尾巴</main></body></html>";
	let state = {
		...createInitialDesignDemoState(new Date("2026-07-06T00:00:00.000Z")),
		artifactHtml: oldHtml,
	};
	const tools = createDesignTools({
		getDesignState: () => state,
		setDesignState: (nextState) => {
			state = nextState;
		},
		now: () => new Date("2026-07-06T01:00:00.000Z"),
	});
	const replaceArtifactTool = tools.find((tool) => tool.name === "replace_artifact");
	const nextHtml = "<!doctype html><html><body><main>全新页面</main></body></html>";

	const result = await replaceArtifactTool?.execute("tool-call-1", { html: nextHtml }, undefined);

	assert.equal(state.artifactHtml, nextHtml);
	assert.doesNotMatch(state.artifactHtml, /旧页面尾巴/);
	assert.equal(state.version, 2);
	assert.equal(state.updatedAt, "2026-07-06T01:00:00.000Z");
	assert.equal(result?.details?.previousLength, oldHtml.length);
	assert.equal(result?.details?.totalLength, nextHtml.length);
	assert.equal(result?.terminate, true);
	assert.match(result?.content[0]?.text ?? "", /"version": 2/);
	assert.match(result?.content[0]?.text ?? "", /"htmlLength"/);
	assert.doesNotMatch(result?.content[0]?.text ?? "", /全新页面/);
});

test("read_full_artifact returns the full artifact in one call", async () => {
	const html = `<!doctype html><html><body><main>${"长页面内容".repeat(900)}</main></body></html>`;
	const state = {
		...createInitialDesignDemoState(new Date("2026-07-06T00:00:00.000Z")),
		artifactHtml: html,
	};
	const tools = createDesignTools({
		getDesignState: () => state,
	});
	const readTool = tools.find((tool) => tool.name === "read_full_artifact");

	const result = await readTool?.execute("tool-call-1", {}, undefined);

	assert.equal(result?.content[0]?.text, html);
	assert.equal(result?.details?.start, 0);
	assert.equal(result?.details?.length, html.length);
	assert.equal(result?.details?.totalLength, html.length);
	assert.equal(result?.details?.truncated, false);
});

test("artifact tool descriptions keep read_artifact as an inspection tool", () => {
	const tools = createDesignTools();
	const getSummaryTool = tools.find((tool) => tool.name === "get_artifact_summary");
	const readTool = tools.find((tool) => tool.name === "read_artifact");
	const readFullTool = tools.find((tool) => tool.name === "read_full_artifact");
	const replaceTool = tools.find((tool) => tool.name === "replace_artifact");

	assert.match(getSummaryTool?.description ?? "", /当前 artifact 概览/);
	assert.doesNotMatch(getSummaryTool?.description ?? "", /before reading full HTML/);
	assert.match(readTool?.description ?? "", /查看现有 HTML 的局部区域/);
	assert.match(readTool?.description ?? "", /不要用它重建整个页面/);
	assert.doesNotMatch(readTool?.description ?? "", /full=true/);
	assert.match(readFullTool?.description ?? "", /完整 HTML artifact/);
	assert.match(replaceTool?.description ?? "", /格式转换/);
});

test("read_skill tool returns full skill instructions by skill name", async () => {
	const skills: DesignCoreSkill[] = [
		{
			name: "设计布局",
			description: "用于安排页面结构。",
			content: "# 设计布局\n\n完整布局规则。",
			filePath: "/virtual/design-agent/skills/design-layout/SKILL.md",
		},
	];
	const tools = createDesignTools({ skills });
	const readSkillTool = tools.find((tool) => tool.name === "read_skill");

	const result = await readSkillTool?.execute("tool-call-1", { name: "设计布局" }, undefined);

	assert.match(result?.content[0]?.text ?? "", /<skill name="设计布局"/);
	assert.match(result?.content[0]?.text ?? "", /完整布局规则/);
	assert.equal(result?.details?.name, "设计布局");
});
