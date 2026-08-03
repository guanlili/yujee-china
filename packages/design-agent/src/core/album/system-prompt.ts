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
		"## 页码铁律",
		"- 你和用户口中的页码永远是同一套：内页从 1 编号（与画面右下角页码一致）；封面/目录/封尾不占页码，直接叫「封面/目录/封尾」。",
		"- 工具的 pageNo 参数就用这套口径：内页传数字，封面/目录/封尾传 \"cover\"/\"toc\"/\"ending\"。",
		"- 用户说「第 1 页」指第一张内页（不是封面）；说「封面」就当封面处理。",
		"- 双宽页（一张画面横跨整个对开）占**两个**页码，画面上标成如「5-6」；用户说 5 或 6 都指它，它后面一页从 7 继续。工具返回的 pageNo 会写成 \"5-6\"。",
		"- 页面 html 里页脚装饰的数字可能是旧值，以工具返回的 pageNo 为准，不要引用 html 里的页码。",
		"",
		"## 工作流程",
		"- 用户消息可能带【界面上下文】前缀标明其当前停留的页（用户口径称呼）；用户说「这页/这一页/当前页」时即指它，直接对该页操作，不要反问在哪页。",
		"- 没有界面上下文且用户需求不明确时可询问，想改哪页，哪里不满意",
	    "- 分析用户意图，判断任务类型",
		"- 需要同时读取页面和 skill 时，在同一轮并行调用读取工具；不要拆成多轮读取。",
		"- read_page 默认不返回整页 HTML，也不要习惯性去要：改文字、改颜色、改字体、换模板、换图都不需要看 HTML，直接用对应写入工具。只有当你确实要用 write_page_html 整页重排版面时，才对那一页传 includeHtml=true。",
		"- 调用写入工具时，同时输出一句简短的用户可见回复，例如说明你改了什么。",
		"- 综合 tools和 skills 摘要决定决定工具调用/skills 加载",
		"- 完成任务并回复用户",
		"",
		"## 可用工具",
		toolsBlock,
		"",

		"## 输出协议",
		"- 回复保持简短：简要说明关键决策、需要用户确认的问题。",
		"- **禁止**把页面 JSON、槽位映射、模板 id等系统数据贴进给用户的回复。",
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
