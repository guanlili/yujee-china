import assert from "node:assert/strict";
import test from "node:test";
import {
	applyDesignModelOutput,
	createInitialDesignDemoState,
	summarizeDesignDemoState,
	summarizeDesignTaskContext,
} from "../src/core/artifacts/design-demo.ts";
import { buildDesignModelPrompt } from "../src/core/prompts/design-artifact-prompt.ts";

test("design task prompt only includes per-turn context", () => {
	const prompt = buildDesignModelPrompt(createInitialDesignDemoState(), "设计一个完整的活动页");

	assert.doesNotMatch(prompt, /只返回 JSON/);
	assert.doesNotMatch(prompt, /直接产出完整 HTML artifact/);
	assert.doesNotMatch(prompt, /<artifact type="html">/);
	assert.doesNotMatch(prompt, /你是一个设计 Agent/);
	assert.doesNotMatch(prompt, /规则：/);
	assert.doesNotMatch(prompt, /replace_artifact/);
	assert.match(prompt, /<task_context>/);
	assert.match(prompt, /<current_artifact_summary>/);
	assert.match(prompt, /<user_request>\n设计一个完整的活动页\n<\/user_request>/);
	assert.match(prompt, /<\/task_context>/);
});

test("model output can replace the preview with a complete HTML artifact", () => {
	const current = createInitialDesignDemoState(new Date("2026-07-06T00:00:00.000Z"));
	const html = [
		"<!doctype html>",
		'<html lang="zh-CN">',
		"<body>",
		"<main>",
		"<h1>自由生成的活动页</h1>",
		"<p>这不是 title/body/button 配置拼出来的页面。</p>",
		"</main>",
		"</body>",
		"</html>",
	].join("");
	const output = ["已经直接生成完整页面。", '<artifact type="html">', html, "</artifact>"].join("\n");

	const result = applyDesignModelOutput(current, output, new Date("2026-07-06T01:00:00.000Z"));

	assert.deepEqual(result.operations, ["artifact"]);
	assert.equal(result.state.version, 2);
	assert.equal(result.state.updatedAt, "2026-07-06T01:00:00.000Z");
	assert.equal(result.assistantText, "已经直接生成完整页面。");
	assert.equal(result.html, html);
});

test("design prompt summarizes existing artifact without embedding full HTML", () => {
	const current = {
		...createInitialDesignDemoState(new Date("2026-07-06T00:00:00.000Z")),
		artifactHtml: [
			"<!doctype html>",
			'<html lang="zh-CN">',
			"<body>",
			'<section id="hero"><h1>DeepSeek 说明书</h1><p>核心说明。</p></section>',
			'<section id="features"><h2>能力</h2><p>推理、生成、协作。</p></section>',
			"</body>",
			"</html>",
		].join(""),
	};

	const prompt = buildDesignModelPrompt(current, "把 hero 的标题改短一点");

	assert.match(prompt, /artifact/);
	assert.match(prompt, /htmlLength/);
	assert.match(prompt, /sections/);
	assert.match(prompt, /hero/);
	assert.doesNotMatch(prompt, /textPreview/);
	assert.doesNotMatch(prompt, /buttonLabel/);
	assert.doesNotMatch(prompt, /updatedAt/);
	assert.doesNotMatch(prompt, /核心说明/);
	assert.doesNotMatch(prompt, /推理、生成、协作/);
	assert.doesNotMatch(prompt, /<section id="features">/);
	assert.doesNotMatch(prompt, /artifactHtml/);
});

test("summarizeDesignTaskContext exposes a compact page index", () => {
	const state = {
		...createInitialDesignDemoState(new Date("2026-07-06T00:00:00.000Z")),
		artifactHtml: [
			"<!doctype html>",
			'<html lang="zh-CN">',
			"<body>",
			'<section id="hero"><h1>DeepSeek 说明书</h1><p>核心说明。</p></section>',
			'<section id="details"><h2>细节</h2><p>长正文不应该进入摘要。</p></section>',
			"</body>",
			"</html>",
		].join(""),
	};

	const summary = summarizeDesignTaskContext(state);
	const serialized = JSON.stringify(summary);

	assert.equal(summary.version, 1);
	assert.equal(summary.artifact.kind, "html");
	assert.equal(summary.artifact.sections[0]?.id, "hero");
	assert.equal(summary.artifact.sections[0]?.heading, "DeepSeek 说明书");
	assert.equal(typeof summary.artifact.sections[0]?.start, "number");
	assert.equal(typeof summary.artifact.sections[0]?.length, "number");
	assert.doesNotMatch(serialized, /textPreview/);
	assert.doesNotMatch(serialized, /buttonLabel/);
	assert.doesNotMatch(serialized, /updatedAt/);
	assert.doesNotMatch(serialized, /核心说明/);
	assert.doesNotMatch(serialized, /长正文不应该进入摘要/);
});

test("summarizeDesignDemoState exposes section summaries instead of full artifact HTML", () => {
	const state = {
		...createInitialDesignDemoState(new Date("2026-07-06T00:00:00.000Z")),
		artifactHtml: [
			"<!doctype html>",
			'<html lang="zh-CN">',
			"<body>",
			'<main><section id="hero"><h1>DeepSeek 说明书</h1><p>核心说明。</p></section></main>',
			"</body>",
			"</html>",
		].join(""),
	};

	const summary = summarizeDesignDemoState(state);

	assert.equal(summary.version, 1);
	assert.equal(summary.artifactSummary?.htmlLength, state.artifactHtml.length);
	assert.equal(summary.artifactSummary?.sections[0]?.id, "hero");
	assert.equal(summary.artifactSummary?.sections[0]?.heading, "DeepSeek 说明书");
	assert.equal(typeof summary.artifactSummary?.sections[0]?.start, "number");
	assert.equal(typeof summary.artifactSummary?.sections[0]?.length, "number");
	assert.equal("artifactHtml" in summary, false);
});
