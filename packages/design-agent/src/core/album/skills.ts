import type { Skill } from "@earendil-works/pi-agent-core";

/** Album 模式默认技能（v1 粗版，后续按实际效果雕琢）。 */
export function createDefaultAlbumSkills(): Skill[] {
	return [
		{
			name: "相册文案",
			description: "用于撰写或修改页面标题、正文、章节标签等文字槽内容。",
			filePath: "/virtual/design-agent/skills/album-copywriting/SKILL.md",
			content: [
				"# 相册文案",
				"",
				"为相册页面写文字槽内容时，使用这个技能。",
				"",
				"规则：",
				"- 先 read_page 拿到每个槽的角色、maxChars 和 sample 示范文案，再动笔；字数按 Unicode 字符计。",
				"- 以 sample 示范文案为范本：保留它的长度感和调性，换成贴合这本书真实故事的内容，别脱离示范另起炉灶、也别照抄 sample 具体内容。",
				"- 文案素材优先级：用户原话 > 章节背景（chapterContext）> 照片描述（sceneDescription）。",
				"- 标题要具体、有画面感，避免「美好回忆」「温馨时光」这类空话。",
				"- 正文用第一人称回忆的口吻，贴合照片拍摄的时间和场景；不确定的事实不要编造（人名、地点、日期）。",
				"- lang 为 en 的装饰槽（如章节标签、页码）保持英文，参考 sample 的格式。",
				"- 同一页的多个槽在一次 update_page_texts 调用里一起写。",
			].join("\n"),
		},
		{
			name: "相册排版",
			description: "用于更换页面模板、调整图片槽位或全书版式节奏。",
			filePath: "/virtual/design-agent/skills/album-layout/SKILL.md",
			content: [
				"# 相册排版",
				"",
				"当任务涉及换模板、调图片顺序或版式节奏时，使用这个技能。",
				"",
				"规则：",
				"- 换模板必须同类目（cover/toc/interior/ending）且图槽数一致；先 list_templates 过滤候选，再 swap_page_template。",
				"- 选模板时参考 structureDescription 与照片的朝向/构图匹配度：横图配横槽为主的模板，人像特写适合大图槽。",
				"- 换模板后检查文字槽迁移结果（工具会报告截断/丢弃），必要时补写。",
				"- 调整图片用 update_page_images 整页替换：模板所有图槽必须填满、同页照片不重复、照片必须来自本书章节。",
				"- 连续多页避免使用相同模板造成单调，但同章节内保持风格接近。",
			].join("\n"),
		},
		{
			name: "相册配色",
			description: "用于设定或调整章节主题色、装饰色，或用户提出「换个颜色/色调」类需求。",
			filePath: "/virtual/design-agent/skills/album-color/SKILL.md",
			content: [
				"# 相册配色",
				"",
				"为章节设定主题色时，使用这个技能。",
				"",
				"规则：",
				"- 颜色一律用 set_chapter_theme 写入：一章一个主色（accentColor），工具会自动散布到该章所有页面的装饰槽；不要用 update_page_texts 手工逐页写 carrier 键（会漏页漏槽）。",
				"- 从章节背景（chapterContext）和照片描述里找情绪线索取色：海边黄昏 → 暖橙/深海蓝，厨房烟火 → 陶土棕，雪天 → 青灰/冷蓝。",
				"- 装饰色是点缀：选中等饱和、偏深、白底上对比度足够的色值，避免荧光色和纯灰。",
				"- 相邻章节主色有可感知区分度，但同属一套气质（明度/饱和度接近），整本书才像一本书。",
				"- 用户给了明确颜色偏好时以用户为准，只做合法性把关（必须是 #RGB/#RRGGBB 十六进制）。",
				"- 写入后用一句话说明选色理由，不要罗列受影响的槽位。",
			].join("\n"),
		},
	];
}
