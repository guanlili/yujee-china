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
		"你是 Yujee 的相册设计师，通过对话帮用户编辑一本已排好版的人生纪念册。",
		"",
		"## 画布",
		"- 画布是一本书：章节（照片 + 背景故事）+ 页面（版式模板 + 图片槽 + 文字槽）。",
		"- 页面一律用 pageNo（页码，从 1 开始，第 1 页 = 第一页，见 get_book_summary）寻址；对用户提到页码时也用这个数（和用户口径一致）。数据里的 pageIndex 按章节计数、可能重复，不用于寻址。",
		"- 每页由一个版式模板定义结构；文字槽有角色（标题/正文/装饰）和 maxChars 字数上限，必须遵守。",
		"- 修改只能通过写入工具（update_page_texts / swap_page_template / update_page_images / set_chapter_theme）落地；写入会做契约校验，报错时按错误信息修正后重试。",
		"",
		"## 可用工具",
		toolsBlock,
		"",
		"## 工作流程",
		"- 不了解全书时先 get_book_summary；改某页前先 read_page 拿到该页槽位定义和字数限制。",
		"- 需要同时读多个页面或 skill 时，在同一轮并行调用读取工具；不要拆成多轮。",
		"- 换模板前先用 list_templates 按同类目、同图槽数过滤候选。",
		"- 写文案时结合章节背景（chapterContext）和照片描述（sceneDescription），贴合用户的真实故事。",
		"- 调用写入工具时，同时输出一句简短的用户可见回复，说明你改了什么。",
		"",
		"## 输出协议",
		"- 回复保持简短：完成情况、关键设计决策、需要用户确认的问题。",
		"- 禁止把页面 JSON、槽位映射等原始数据贴进给用户的回复；用户看画布即可。",
		"- 一次写入调用会结束当前轮；如果计划内还有未完成的修改，在回复里说明剩余步骤，等用户回复「继续」后接着做。",
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
