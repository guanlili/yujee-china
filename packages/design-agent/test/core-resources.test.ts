import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultDesignResources } from "../src/core/resources/index.ts";
import type { DesignCoreSkill } from "../src/core/skills/index.ts";
import { buildDesignSystemPrompt } from "../src/core/system-prompt.ts";
import { createDesignTools } from "../src/core/tools/index.ts";

test("default design resources expose production design skills", () => {
	const resources = createDefaultDesignResources();
	const skillNames = resources.skills?.map((skill) => skill.name) ?? [];

	assert.deepEqual(skillNames, ["设计颜色", "设计布局", "设计文案"]);
	for (const skill of resources.skills ?? []) {
		assert.equal(skill.filePath.startsWith("/"), true);
		assert.equal(skill.content.includes("# "), true);
		assert.doesNotMatch(skill.description, /\bUse when\b/);
		assert.doesNotMatch(skill.content, /\bRules:\b/);
	}
});

test("design system prompt includes model-visible skill metadata", async () => {
	const resources = createDefaultDesignResources();
	const prompt = await buildDesignSystemPrompt({
		env: {},
		session: {},
		model: { provider: "faux", api: "faux", id: "faux-1" },
		thinkingLevel: "off",
		activeTools: [],
		resources,
	});

	assert.match(prompt, /<available_skills>/);
	assert.match(prompt, /<name>设计颜色<\/name>/);
	assert.match(prompt, /<name>设计布局<\/name>/);
	assert.match(prompt, /<name>设计文案<\/name>/);
	assert.match(prompt, /用于选择或调整调色板/);
	assert.match(prompt, /以下技能会为特定任务提供专门指导/);
	assert.match(prompt, /请调用 read_skill 读取完整 skill 内容/);
	assert.doesNotMatch(prompt, /The following skills provide specialized instructions/);
});

test("design system prompt owns stable artifact rules", async () => {
	const prompt = await buildDesignSystemPrompt({
		env: {},
		session: {},
		model: { provider: "faux", api: "faux", id: "faux-1" },
		thinkingLevel: "off",
		activeTools: [],
		resources: {},
	});

	assert.match(prompt, /画板内容必须保持为完整 HTML 文档/);
	assert.match(prompt, /设计结果\*\*必须\*\*写入 artifact 存储/);
	assert.match(prompt, /\*\*禁止\*\*把 HTML 放入给用户的回复/);
	assert.doesNotMatch(prompt, /\bYou are a design-focused agent\b/);
	assert.doesNotMatch(prompt, /\bArtifact workflow\b/);
});

test("design system prompt keeps the compact production sections", async () => {
	const prompt = await buildDesignSystemPrompt({
		env: {},
		session: {},
		model: { provider: "faux", api: "faux", id: "faux-1" },
		thinkingLevel: "off",
		activeTools: createDesignTools(),
		resources: {},
	});

	assert.match(prompt, /## 角色/);
	assert.match(prompt, /## 可用工具/);
	assert.match(prompt, /- read_artifact：查看现有 HTML 的局部区域/);
	assert.match(prompt, /- read_full_artifact：完整 HTML artifact/);
	assert.match(prompt, /- read_skill：读取指定设计 skill 的完整说明/);
	assert.match(prompt, /## 行为准则/);
	assert.match(prompt, /## 工作流程/);
	assert.match(prompt, /## 输出协议/);
	assert.equal(prompt.match(/<available_skills>/g)?.length ?? 0, 0);
	assert.doesNotMatch(prompt, /Artifact 工作流程：/);
});

test("design system prompt does not make local reads the default workflow", async () => {
	const prompt = await buildDesignSystemPrompt({
		env: {},
		session: {},
		model: { provider: "faux", api: "faux", id: "faux-1" },
		thinkingLevel: "off",
		activeTools: createDesignTools(),
		resources: {},
	});

	assert.match(prompt, /分析用户意图，判断任务类型/);
	assert.match(prompt, /需要同时读取页面和 skill 时，在同一轮并行调用读取工具/);
	assert.match(prompt, /调用写入工具时，同时输出一句简短的用户可见回复/);
	assert.match(prompt, /read_artifact：查看现有 HTML 的局部区域/);
	assert.match(prompt, /read_full_artifact：完整 HTML artifact/);
	assert.doesNotMatch(prompt, /full=true/);
	assert.match(prompt, /不要用它重建整个页面/);
	assert.match(prompt, /replace_artifact：用完整 HTML 文档替换当前整个 HTML artifact/);
	assert.doesNotMatch(prompt, /Prefer bounded reads over reading the whole page/);
});

test("design system prompt escapes skill XML and hides disabled skills", async () => {
	const skills: DesignCoreSkill[] = [
		{
			name: "设计&颜色",
			description: '用于 <颜色> 与 "层级"',
			content: "# 设计&颜色",
			filePath: "/virtual/design-agent/skills/<color>&tone/SKILL.md",
		},
		{
			name: "隐藏技能",
			description: "不应该进入 prompt",
			content: "# 隐藏技能",
			filePath: "/virtual/design-agent/skills/hidden/SKILL.md",
			disableModelInvocation: true,
		},
	];

	const prompt = await buildDesignSystemPrompt({
		env: {},
		session: {},
		model: { provider: "faux", api: "faux", id: "faux-1" },
		thinkingLevel: "off",
		activeTools: [],
		resources: { skills },
	});

	assert.match(prompt, /<name>设计&amp;颜色<\/name>/);
	assert.match(prompt, /<description>用于 &lt;颜色&gt; 与 &quot;层级&quot;<\/description>/);
	assert.match(prompt, /<location>\/virtual\/design-agent\/skills\/&lt;color&gt;&amp;tone\/SKILL.md<\/location>/);
	assert.doesNotMatch(prompt, /隐藏技能/);
});
