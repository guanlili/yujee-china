import type { Skill } from "@earendil-works/pi-agent-core";

export type DesignCoreSkill = Skill;

export function createDefaultDesignSkills(): DesignCoreSkill[] {
	return [
		{
			name: "设计颜色",
			description: "用于选择或调整调色板、对比度、色调、语义颜色或视觉层级。",
			filePath: "/virtual/design-agent/skills/design-color/SKILL.md",
			content: [
				"# 设计颜色",
				"",
				"颜色系统、调色板调整、对比度、品牌气质或视觉层级时，使用这个技能。",
				"",
				"规则：",
				"- 先从产品语境、目标用户和可读性出发，再考虑装饰效果。",
				"- 把背景、表面、正文、弱化文字、边框、强调色和状态色作为一套系统来定义。",
				"- 正文对比度必须足够支撑正常阅读。",
				"- 强调色用于主要操作和状态提示，不要铺满所有大面积区域。",
				"- 除非品牌明确要求，否则避免单一色相反复堆叠的配色。",
			].join("\n"),
		},
		{
			name: "设计布局",
			description: "用于安排页面结构、间距、响应式行为、层级结构或可复用区块。",
			filePath: "/virtual/design-agent/skills/design-layout/SKILL.md",
			content: [
				"# 设计布局",
				"",
				"当设计任务涉及布局、屏幕结构、间距、响应式约束或交互密度时，使用这个技能。",
				"",
				"规则：",
				"- 如果用户要的是应用或工具，第一屏就应该是实际可工作的体验。",
				"- 用层级、间距、对齐和约束让布局便于扫读。",
				"- 重复项目和控件在状态变化时要保持尺寸稳定。",
				"- 优先使用无外框页面区块和聚焦的工具表面，避免嵌套装饰卡片。",
				"- 在认为布局完成前，检查移动端和桌面端表现。",
			].join("\n"),
		},
		{
			name: "设计文案",
			description: "用于撰写或修改标题、正文、行动按钮标签、微文案或产品语言。",
			filePath: "/virtual/design-agent/skills/design-copywriting/SKILL.md",
			content: [
				"# 设计文案",
				"",
				"当设计任务涉及命名、标题、正文、行动按钮、空状态或产品微文案时，使用这个技能。",
				"",
				"规则：",
				"- 从用户真实的产品、受众和行动路径出发写文案。",
				"- 标题要具体，避免泛泛使用 AI、高级、现代、优雅之类的填充词。",
				"- 行动按钮标签要具体，并指向明确动作。",
				"- 正文要简洁，解释设计决策或用户收益，不要堆营销套话。",
				"- 如果用户原话已经符合设计方向，优先保留其中有价值的表达。",
			].join("\n"),
		},
	];
}
