import type { AgentTool, Skill } from "@earendil-works/pi-agent-core";
import type { DesignSystemPromptContext } from "../system-prompt.ts";

/**
 * Album 模式系统提示词：画布是一本结构化的相册书（章节树 + 模板化页面），
 * 不是自由 HTML。所有修改必须通过写入工具落到书状态，由画布渲染。
 */
export function buildAlbumSystemPrompt(context: DesignSystemPromptContext): string {
	const toolsBlock = formatToolsBlock(context.activeTools);
	const skillBlock = formatSkillsBlock(context.resources.skills ?? []);

	const lines = [
		"## 角色",
		"你是 Yujee 的相册设计师，帮助用户把照片和故事做成书",
		"",
		"## 工作流程",
		"- 用户需求不明确时可询问，想改哪页，哪里不满意",
	    "- 分析用户意图，判断任务类型",
		"- 需要同时读取页面和 skill 时，在同一轮并行调用读取工具；不要拆成多轮读取。",
		"- 调用写入工具时，同时输出一句简短的用户可见回复，例如说明你改了什么。",
		"- 综合 tools和 skills 摘要决定决定工具调用/skills 加载",
		"- 完成任务并回复用户",
		"",
		"## 可用工具",
		toolsBlock,
		"",

		"## 输出协议",
		"- 回复保持简短：简要说明关键决策、需要用户确认的问题。",
		"- **禁止**把页面 JSON、槽位映射、末班 id等系统数据贴进给用户的回复。",
	];

	if (skillBlock) {
		lines.push("", skillBlock);
	}

	return lines.join("\n");
}

function formatToolsBlock(tools: readonly AgentTool[]): string {
	if (tools.length === 0) return "(无)";
	return tools.map((tool) => `- ${tool.name}：${tool.description}`).join("\n");
}

function formatSkillsBlock(skills: readonly Skill[]): string {
	const visibleSkills = skills.filter((skill) => !skill.disableModelInvocation);
	if (visibleSkills.length === 0) return "";
	const lines = [
		"以下技能会为特定任务提供专门指导。当任务与技能描述匹配时，先调用 read_skill 读取完整内容。",
		"",
		"<available_skills>",
	];
	for (const skill of visibleSkills) {
		lines.push(
			"  <skill>",
			`    <name>${escapeXml(skill.name)}</name>`,
			`    <description>${escapeXml(skill.description)}</description>`,
			"  </skill>",
		);
	}
	lines.push("</available_skills>");
	return lines.join("\n");
}

function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}
