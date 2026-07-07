import type { AgentHarnessOptions, AgentTool, PromptTemplate, Skill } from "@earendil-works/pi-agent-core";

type DesignSystemPromptFactory = Exclude<
	AgentHarnessOptions<Skill, PromptTemplate, AgentTool>["systemPrompt"],
	string | undefined
>;

export type DesignSystemPromptContext = Parameters<DesignSystemPromptFactory>[0];

export function buildDesignSystemPrompt(context: DesignSystemPromptContext): string {
	const promptTemplateNames = context.resources.promptTemplates?.map((template) => template.name).join(", ") || "无";
	const toolsBlock = formatDesignToolsForSystemPrompt(context.activeTools);
	const skillBlock = formatDesignSkillsForSystemPrompt(context.resources.skills ?? []);

	const lines = [
		"## 角色",
		"你是设计助手 Yujee，根据用户需求进行设计任务",
		"",
		"## 可用工具",
		toolsBlock,
		"## 行为准则",
		"- 回复保持简洁，重点说明结果和必要的下一步。",
		"- 画板内容必须保持为完整 HTML 文档，不要只输出局部配置片段。",
		"",
		"## 工作流程",
		"- 分析用户意图，判断任务类型",
		"- 需要同时读取页面和 skill 时，在同一轮并行调用读取工具；不要拆成多轮读取。",
		"- 调用写入工具时，同时输出一句简短的用户可见回复，例如说明你改了什么。",
		"- 综合 tools和 skills 摘要决定决定工具调用/skills 加载",
		"- 完成任务并回复用户",
		"",
		"",
		"## 输出协议",
		"- 回复用户内容保持简短；回复内容主要是完成情况，关键设计决策或需要用户确认的问题",
		"- 设计结果**必须**写入 artifact 存储，并由画板渲染。",
		"- **禁止**把 HTML 放入给用户的回复",
		"",
		`可用提示模板：${promptTemplateNames}`,
	];

	if (skillBlock) {
		lines.push("", skillBlock);
	}

	return lines.join("\n");
}

function formatDesignToolsForSystemPrompt(tools: readonly AgentTool[]): string {
	if (tools.length === 0) return "(无)";
	return tools.map((tool) => `- ${tool.name}：${tool.description}`).join("\n");
}

function formatDesignSkillsForSystemPrompt(skills: readonly Skill[]): string {
	const visibleSkills = skills.filter((skill) => !skill.disableModelInvocation);
	if (visibleSkills.length === 0) return "";
	const lines = [
		"以下技能会为特定任务提供专门指导。",
		"当任务与技能描述匹配时，请调用 read_skill 读取完整 skill 内容。",
		"如果技能文件引用相对路径，请以技能目录（SKILL.md 的父目录）为基准解析路径。",
		"",
		"<available_skills>",
	];
	for (const skill of visibleSkills) {
		lines.push(
			"  <skill>",
			`    <name>${escapeXml(skill.name)}</name>`,
			`    <description>${escapeXml(skill.description)}</description>`,
			`    <location>${escapeXml(skill.filePath)}</location>`,
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
