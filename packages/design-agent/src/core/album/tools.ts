import type { AgentTool, AgentToolResult, Skill } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "typebox";
import { createDefaultDesignSkills } from "../skills/index.ts";
import {
	type AlbumBookState,
	type AlbumPage,
	buildPhotoToChapterMap,
	cloneAlbumBookState,
	clonePage,
	derivePageChapterId,
	findAlbumPageByNo,
	findAlbumPhoto,
	summarizeAlbumBook,
	validateImagesMap,
	validateTextsPatch,
} from "./book-state.ts";
import { parseThemeCarrierKey, type TemplateCatalog, type TemplateCatalogEntry } from "./templates-catalog.ts";

export interface AlbumToolsOptions {
	catalog: TemplateCatalog;
	getBookState: () => AlbumBookState;
	setBookState: (state: AlbumBookState) => void;
	now?: () => Date;
	skills?: Skill[];
}

const getBookSummarySchema = Type.Object({});

const readPageSchema = Type.Object({
	pageNo: Type.Number({ description: "页码（从 1 开始，第 1 页 = 第一页；见 get_book_summary）。" }),
});

const searchBookSchema = Type.Object({
	query: Type.String({ description: "在全书文字槽、照片描述和章节背景中搜索的文本，大小写不敏感。" }),
	limit: Type.Optional(Type.Number({ description: "最多返回的匹配数。默认 10，最大 30。" })),
});

const updatePageTextsSchema = Type.Object({
	pageNo: Type.Number({ description: "要修改的页码（从 1 开始）。" }),
	texts: Type.Record(Type.String(), Type.String(), {
		description: "槽 id → 新文字内容。只需给出要修改的槽；每个槽必须遵守模板的 maxChars 限制。",
	}),
});

const swapPageTemplateSchema = Type.Object({
	pageNo: Type.Number({ description: "要换模板的页码（从 1 开始）。" }),
	templateId: Type.String({ description: "新模板 id（用 list_templates 查询同类目、同图槽数的候选）。" }),
});

const updatePageImagesSchema = Type.Object({
	pageNo: Type.Number({ description: "要调整图片的页码（从 1 开始）。" }),
	images: Type.Record(Type.String(), Type.String(), {
		description: "完整的槽 id → photoId 映射（整页替换）：模板所有图槽都要填，照片必须存在于本书章节。",
	}),
});

const setChapterThemeSchema = Type.Object({
	chapterId: Type.String({ description: "要设定主题色的章节 id（从 get_book_summary 获得）。" }),
	accentColor: Type.String({ description: "章节主题色，#RGB 或 #RRGGBB 十六进制。" }),
	artFont: Type.Optional(Type.String({ description: "可选的艺术字体包名；不确定时不要传。" })),
});

const listTemplatesSchema = Type.Object({
	category: Type.Optional(Type.String({ description: "按类目过滤：cover / toc / interior / ending。" })),
	imageSlotCount: Type.Optional(Type.Number({ description: "按图槽数量过滤。" })),
});

const readSkillSchema = Type.Object({
	name: Type.String({ description: "需要读取完整内容的 skill 名称。" }),
});

type ReadPageInput = Static<typeof readPageSchema>;
type SearchBookInput = Static<typeof searchBookSchema>;
type UpdatePageTextsInput = Static<typeof updatePageTextsSchema>;
type SwapPageTemplateInput = Static<typeof swapPageTemplateSchema>;
type UpdatePageImagesInput = Static<typeof updatePageImagesSchema>;
type SetChapterThemeInput = Static<typeof setChapterThemeSchema>;
type ListTemplatesInput = Static<typeof listTemplatesSchema>;
type ReadSkillInput = Static<typeof readSkillSchema>;

const DEFAULT_SEARCH_LIMIT = 10;
const MAX_SEARCH_LIMIT = 30;

export function createAlbumTools(options: AlbumToolsOptions): AgentTool[] {
	return [
		createGetBookSummaryTool(options),
		createReadPageTool(options),
		createSearchBookTool(options),
		createListTemplatesTool(options),
		createUpdatePageTextsTool(options),
		createSwapPageTemplateTool(options),
		createUpdatePageImagesTool(options),
		createSetChapterThemeTool(options),
		createReadSkillTool(options),
	];
}

function createGetBookSummaryTool(options: AlbumToolsOptions): AgentTool<typeof getBookSummarySchema> {
	return {
		name: "get_book_summary",
		label: "获取书摘要",
		description: "返回整本书概览：版本、章节（照片数/主题色）、每页的模板/类目/图文槽填充情况。开始任何任务前先用它了解全书。",
		parameters: getBookSummarySchema,
		async execute(): Promise<AgentToolResult<undefined>> {
			const state = options.getBookState();
			return {
				content: [{ type: "text", text: JSON.stringify(summarizeAlbumBook(state, options.catalog), null, 1) }],
				details: undefined,
			};
		},
	};
}

function createReadPageTool(options: AlbumToolsOptions): AgentTool<typeof readPageSchema, { pageNo: number }> {
	return {
		name: "read_page",
		label: "读取单页",
		description: "读取指定页的完整内容：图片槽（含照片描述）、文字槽（含模板对每个槽的角色/字数限制/提示），以及该页所属章节的背景信息。",
		parameters: readPageSchema,
		prepareArguments(args: unknown): ReadPageInput {
			return { pageNo: isRecord(args) ? (readNumber(args.pageNo) ?? readNumber(args.pageIndex) ?? -1) : -1 };
		},
		async execute(_toolCallId: string, params: ReadPageInput): Promise<AgentToolResult<{ pageNo: number }>> {
			const state = options.getBookState();
			const page = requirePage(state, params.pageNo);
			const template = requireTemplate(options.catalog, page.templateId);
			const photoToChapter = buildPhotoToChapterMap(state);
			const chapterId = derivePageChapterId(page, photoToChapter);
			const chapter = state.chapters.find((candidate) => candidate.chapterId === chapterId);
			const payload = {
				pageNo: params.pageNo,
				pageIndex: page.pageIndex,
				templateId: page.templateId,
				category: template.category,
				chapter: chapter
					? {
							chapterId: chapter.chapterId,
							chapterContext: chapter.chapterContext ?? "",
							accentColor: chapter.accentColor,
						}
					: undefined,
				images: Object.fromEntries(
					Object.entries(page.images).map(([slotId, photoId]) => {
						const photo = findAlbumPhoto(state, photoId);
						return [
							slotId,
							{
								photoId,
								sceneDescription: photo?.sceneDescription ?? "",
								orientation: photo?.orientation,
								takenAt: photo?.takenAt ?? undefined,
							},
						];
					}),
				),
				texts: page.texts,
				textSlotDefs: template.textSlotIds.map((slotId) => describeTextSlot(template, slotId)),
				repeatTextSlotBases: template.repeatTextSlotBases.map((base) => `${base}[n]`),
			};
			return {
				content: [{ type: "text", text: JSON.stringify(payload, null, 1) }],
				details: { pageNo: params.pageNo },
			};
		},
	};
}

function createSearchBookTool(
	options: AlbumToolsOptions,
): AgentTool<typeof searchBookSchema, { query: string; totalMatches: number }> {
	return {
		name: "search_book",
		label: "搜索全书",
		description: "在全书页文字、照片描述和章节背景中搜索文本，返回命中位置（页码/槽 id/照片 id）。用于修改前定位内容。",
		parameters: searchBookSchema,
		prepareArguments(args: unknown): SearchBookInput {
			if (isRecord(args)) {
				return {
					query: typeof args.query === "string" ? args.query : "",
					limit: readNumber(args.limit),
				};
			}
			return { query: "" };
		},
		async execute(
			_toolCallId: string,
			params: SearchBookInput,
		): Promise<AgentToolResult<{ query: string; totalMatches: number }>> {
			const query = params.query.trim();
			if (!query) throw new Error("query 是必填项");
			const limit = clampInteger(params.limit ?? DEFAULT_SEARCH_LIMIT, 1, MAX_SEARCH_LIMIT);
			const state = options.getBookState();
			const matches = searchAlbumBook(state, query, limit);
			return {
				content: [
					{
						type: "text",
						text: matches.length === 0 ? "(no matches)" : matches.map((match) => JSON.stringify(match)).join("\n"),
					},
				],
				details: { query, totalMatches: matches.length },
			};
		},
	};
}

function createListTemplatesTool(
	options: AlbumToolsOptions,
): AgentTool<typeof listTemplatesSchema, { total: number }> {
	return {
		name: "list_templates",
		label: "查询模板库",
		description: "列出可用版式模板（可按类目 cover/toc/interior/ending 和图槽数过滤）。换模板前先用它确认候选的图槽数与文字槽结构。",
		parameters: listTemplatesSchema,
		prepareArguments(args: unknown): ListTemplatesInput {
			if (isRecord(args)) {
				return {
					category: typeof args.category === "string" ? args.category : undefined,
					imageSlotCount: readNumber(args.imageSlotCount),
				};
			}
			return {};
		},
		async execute(_toolCallId: string, params: ListTemplatesInput): Promise<AgentToolResult<{ total: number }>> {
			const entries = options.catalog.list({
				category: params.category?.trim() || undefined,
				imageSlotCount: params.imageSlotCount,
			});
			const lines = entries.map((entry) =>
				JSON.stringify({
					templateId: entry.id,
					category: entry.category,
					imageSlotCount: entry.imageSlotIds.length,
					textSlots: entry.textSlotIds.map((slotId) => {
						const def = describeTextSlot(entry, slotId);
						return `${slotId}(${def.role}${def.maxChars !== undefined ? `,≤${def.maxChars}` : ""})`;
					}),
					structure: entry.structureDescription,
				}),
			);
			return {
				content: [{ type: "text", text: lines.length === 0 ? "(no templates)" : lines.join("\n") }],
				details: { total: entries.length },
			};
		},
	};
}

export interface AlbumWriteDetails {
	pageNo: number;
	version: number;
	operations: string[];
	notes?: string[];
}

function createUpdatePageTextsTool(
	options: AlbumToolsOptions,
): AgentTool<typeof updatePageTextsSchema, AlbumWriteDetails> {
	return {
		name: "update_page_texts",
		label: "更新页面文字",
		description:
			"修改指定页的文字槽内容（只传要改的槽）。写入前会按模板校验槽 id 与 maxChars，非法写入会报错并说明限制。一次调用可同时改同一页的多个槽。",
		parameters: updatePageTextsSchema,
		prepareArguments(args: unknown): UpdatePageTextsInput {
			if (!isRecord(args)) return { pageNo: -1, texts: {} };
			return {
				pageNo: readNumber(args.pageNo) ?? readNumber(args.pageIndex) ?? -1,
				texts: readStringRecord(args.texts),
			};
		},
		async execute(
			_toolCallId: string,
			params: UpdatePageTextsInput,
		): Promise<AgentToolResult<AlbumWriteDetails>> {
			const state = options.getBookState();
			const page = requirePage(state, params.pageNo);
			const template = requireTemplate(options.catalog, page.templateId);
			if (Object.keys(params.texts).length === 0) throw new Error("texts 至少要包含一个槽");
			const errors = validateTextsPatch(template, params.texts);
			if (errors.length > 0) throw new Error(`文字写入不合法：\n${errors.join("\n")}`);

			const nextState = cloneAlbumBookState(state);
			const nextPage = requirePage(nextState, params.pageNo);
			for (const [slotId, value] of Object.entries(params.texts)) {
				nextPage.texts[slotId] = value;
			}
			return commitWrite(options, nextState, {
				pageNo: params.pageNo,
				operations: Object.keys(params.texts).map((slotId) => `texts.${slotId}`),
			});
		},
	};
}

function createSwapPageTemplateTool(
	options: AlbumToolsOptions,
): AgentTool<typeof swapPageTemplateSchema, AlbumWriteDetails> {
	return {
		name: "swap_page_template",
		label: "更换页面模板",
		description:
			"把指定页换成同类目、同图槽数的另一个模板：照片按槽位顺序迁移，槽 id 相同的文字保留（超长会截断并报告），其余文字槽清空待重写。",
		parameters: swapPageTemplateSchema,
		prepareArguments(args: unknown): SwapPageTemplateInput {
			if (!isRecord(args)) return { pageNo: -1, templateId: "" };
			return {
				pageNo: readNumber(args.pageNo) ?? readNumber(args.pageIndex) ?? -1,
				templateId: typeof args.templateId === "string" ? args.templateId : "",
			};
		},
		async execute(
			_toolCallId: string,
			params: SwapPageTemplateInput,
		): Promise<AgentToolResult<AlbumWriteDetails>> {
			const state = options.getBookState();
			const page = requirePage(state, params.pageNo);
			const currentTemplate = requireTemplate(options.catalog, page.templateId);
			const nextTemplate = options.catalog.get(params.templateId.trim());
			if (!nextTemplate) throw new Error(`未知模板 "${params.templateId}"。用 list_templates 查询可用模板。`);
			if (nextTemplate.id === page.templateId) throw new Error(`第 ${params.pageNo} 页已经在使用模板 ${nextTemplate.id}`);
			if (nextTemplate.category !== currentTemplate.category) {
				throw new Error(
					`类目不匹配：当前页是 ${currentTemplate.category}，目标模板 ${nextTemplate.id} 是 ${nextTemplate.category}。只能换同类目模板。`,
				);
			}
			const currentPhotoCount = Object.keys(page.images).length;
			if (nextTemplate.imageSlotIds.length !== currentPhotoCount) {
				throw new Error(
					`图槽数不匹配：当前页有 ${currentPhotoCount} 张照片，模板 ${nextTemplate.id} 有 ${nextTemplate.imageSlotIds.length} 个图槽。用 list_templates 按 imageSlotCount=${currentPhotoCount} 过滤候选。`,
				);
			}

			const notes: string[] = [];
			const nextPage = migratePageToTemplate(page, nextTemplate, notes);
			const nextState = cloneAlbumBookState(state);
			nextState.pages[params.pageNo - 1] = nextPage;
			return commitWrite(options, nextState, {
				pageNo: params.pageNo,
				operations: [`template:${currentTemplate.id}->${nextTemplate.id}`],
				notes,
			});
		},
	};
}

function createUpdatePageImagesTool(
	options: AlbumToolsOptions,
): AgentTool<typeof updatePageImagesSchema, AlbumWriteDetails> {
	return {
		name: "update_page_images",
		label: "调整页面图片",
		description:
			"整页替换图片槽映射（槽 id → photoId）：模板所有图槽必须填满、照片必须来自本书章节、同页不能重复。用于调换图片顺序或替换照片。",
		parameters: updatePageImagesSchema,
		prepareArguments(args: unknown): UpdatePageImagesInput {
			if (!isRecord(args)) return { pageNo: -1, images: {} };
			return {
				pageNo: readNumber(args.pageNo) ?? readNumber(args.pageIndex) ?? -1,
				images: readStringRecord(args.images),
			};
		},
		async execute(
			_toolCallId: string,
			params: UpdatePageImagesInput,
		): Promise<AgentToolResult<AlbumWriteDetails>> {
			const state = options.getBookState();
			const page = requirePage(state, params.pageNo);
			const template = requireTemplate(options.catalog, page.templateId);
			const errors = validateImagesMap(template, params.images, state);
			if (errors.length > 0) throw new Error(`图片写入不合法：\n${errors.join("\n")}`);

			const nextState = cloneAlbumBookState(state);
			const nextPage = requirePage(nextState, params.pageNo);
			nextPage.images = { ...params.images };
			return commitWrite(options, nextState, {
				pageNo: params.pageNo,
				operations: ["images"],
			});
		},
	};
}

const ACCENT_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function createSetChapterThemeTool(
	options: AlbumToolsOptions,
): AgentTool<typeof setChapterThemeSchema, AlbumWriteDetails> {
	return {
		name: "set_chapter_theme",
		label: "设定章节主题色",
		description:
			"给指定章节设定主题色（一章一主色）：写入章节 accentColor，并自动散布到该章所有页面的装饰槽（variableDecor 文字槽的 carrier 键、SVG 装饰槽）。配色需求一律用它，不要手工逐页写 carrier 键。",
		parameters: setChapterThemeSchema,
		prepareArguments(args: unknown): SetChapterThemeInput {
			if (!isRecord(args)) return { chapterId: "", accentColor: "" };
			return {
				chapterId: typeof args.chapterId === "string" ? args.chapterId : "",
				accentColor: typeof args.accentColor === "string" ? args.accentColor : "",
				artFont: typeof args.artFont === "string" && args.artFont.trim() ? args.artFont.trim() : undefined,
			};
		},
		async execute(
			_toolCallId: string,
			params: SetChapterThemeInput,
		): Promise<AgentToolResult<AlbumWriteDetails>> {
			const state = options.getBookState();
			const chapterId = params.chapterId.trim();
			const chapter = state.chapters.find((candidate) => candidate.chapterId === chapterId);
			if (!chapter) {
				throw new Error(
					`没有 chapterId 为 "${chapterId}" 的章节。现有章节：${state.chapters.map((c) => c.chapterId).join(", ")}`,
				);
			}
			const accentColor = params.accentColor.trim();
			if (!ACCENT_COLOR_PATTERN.test(accentColor)) {
				throw new Error(`accentColor 必须是 #RGB/#RRGGBB 十六进制，收到："${accentColor}"`);
			}

			// 章节色写进画布的树（供后续轮次读取）；持久化效果靠散布到页面的
			// carrier 键 —— Web 只把 pages 写回 draft_json，树由 Web 侧流程管理。
			const nextState = cloneAlbumBookState(state);
			const nextChapter = nextState.chapters.find((candidate) => candidate.chapterId === chapterId);
			if (nextChapter) {
				nextChapter.accentColor = accentColor;
				if (params.artFont) nextChapter.artFont = params.artFont;
			}

			const photoToChapter = buildPhotoToChapterMap(nextState);
			const affectedPageNos: number[] = [];
			for (const [index, page] of nextState.pages.entries()) {
				if (derivePageChapterId(page, photoToChapter) !== chapterId) continue;
				const template = options.catalog.get(page.templateId);
				if (!template) continue;
				let touched = false;
				// SVG variableDecor 槽：值即色（theme-carrier 约定 ①）。
				for (const svgSlotId of template.svgSlotIds) {
					page.texts[svgSlotId] = accentColor;
					touched = true;
				}
				// TEXT variableDecor 槽：sibling carrier 键（约定 ②），槽内容原样保留。
				for (const slotId of template.textSlotIds) {
					const def = template.textDefsByBase.get(slotBaseIdForTheme(slotId));
					if (!def?.variableDecor) continue;
					page.texts[`${slotId}#accentColor`] = accentColor;
					if (params.artFont) page.texts[`${slotId}#artFont`] = params.artFont;
					touched = true;
				}
				if (touched) affectedPageNos.push(index + 1);
			}

			if (affectedPageNos.length === 0) {
				throw new Error(
					`章节 "${chapterId}" 的页面里没有任何 variableDecor 装饰槽，主题色无处落地。先确认页面模板是否带装饰槽（list_templates 查看）。`,
				);
			}

			return commitWrite(options, nextState, {
				pageNo: affectedPageNos[0] ?? 0,
				operations: [`theme:${chapterId}:${accentColor}`],
				notes: [`已散布到 ${affectedPageNos.length} 页（第 ${affectedPageNos.join("、")} 页）`],
			});
		},
	};
}

function slotBaseIdForTheme(slotId: string): string {
	return slotId.replace(/\[\d+\]/g, "");
}

function createReadSkillTool(options: AlbumToolsOptions): AgentTool<typeof readSkillSchema, { name: string }> {
	return {
		name: "read_skill",
		label: "读取技能",
		description: "读取指定 skill 的完整说明。当前任务匹配可用 skill 列表中的某个描述时，先调用它获取完整规则，再继续。",
		parameters: readSkillSchema,
		prepareArguments(args: unknown): ReadSkillInput {
			return { name: isRecord(args) && typeof args.name === "string" ? args.name : "" };
		},
		async execute(_toolCallId: string, params: ReadSkillInput): Promise<AgentToolResult<{ name: string }>> {
			const skillName = params.name.trim();
			if (!skillName) throw new Error("name 是必填项");
			const skills = options.skills ?? createDefaultDesignSkills();
			const skill = skills.find((candidate) => candidate.name === skillName);
			if (!skill) throw new Error(`未知 skill：${skillName}`);
			return {
				content: [{ type: "text", text: skill.content }],
				details: { name: skill.name },
			};
		},
	};
}

// ───────────────────────── 内部工具函数 ─────────────────────────

function commitWrite(
	options: AlbumToolsOptions,
	nextState: AlbumBookState,
	write: { pageNo: number; operations: string[]; notes?: string[] },
): AgentToolResult<AlbumWriteDetails> {
	nextState.version += 1;
	nextState.updatedAt = (options.now?.() ?? new Date()).toISOString();
	options.setBookState(nextState);
	const details: AlbumWriteDetails = {
		pageNo: write.pageNo,
		version: nextState.version,
		operations: write.operations,
		notes: write.notes && write.notes.length > 0 ? write.notes : undefined,
	};
	return {
		content: [{ type: "text", text: JSON.stringify(details, null, 1) }],
		details,
		terminate: true,
	};
}

function migratePageToTemplate(page: AlbumPage, nextTemplate: TemplateCatalogEntry, notes: string[]): AlbumPage {
	const nextPage = clonePage(page);
	nextPage.templateId = nextTemplate.id;

	// 照片迁移：槽 id 相同者原位保留，其余照片按原槽顺序填进剩余新槽。
	const nextImages: Record<string, string> = {};
	const remainingPhotos: string[] = [];
	const newSlotSet = new Set(nextTemplate.imageSlotIds);
	for (const [slotId, photoId] of Object.entries(page.images)) {
		if (newSlotSet.has(slotId) && !(slotId in nextImages)) {
			nextImages[slotId] = photoId;
		} else {
			remainingPhotos.push(photoId);
		}
	}
	for (const slotId of nextTemplate.imageSlotIds) {
		if (slotId in nextImages) continue;
		const photoId = remainingPhotos.shift();
		if (photoId) nextImages[slotId] = photoId;
	}
	nextPage.images = nextImages;

	// imagePos 只保留槽 id 未变的条目（新槽的构图重置为默认）。
	if (page.imagePos) {
		const nextImagePos: NonNullable<AlbumPage["imagePos"]> = {};
		for (const [slotId, pos] of Object.entries(page.imagePos)) {
			if (nextImages[slotId] === page.images[slotId] && pos) nextImagePos[slotId] = pos;
		}
		nextPage.imagePos = Object.keys(nextImagePos).length > 0 ? nextImagePos : null;
	}

	// 文字迁移：槽 id 相同者保留（超长截断并报告），carrier 随基础槽走，其余丢弃并报告。
	const nextTexts: Record<string, string> = {};
	const keptSlots = new Set<string>();
	for (const [slotId, value] of Object.entries(page.texts)) {
		if (parseThemeCarrierKey(slotId)) continue; // carrier 第二遍处理
		const check = validateTextsPatch(nextTemplate, { [slotId]: value });
		if (check.length === 0) {
			nextTexts[slotId] = value;
			keptSlots.add(slotId);
			continue;
		}
		const def = nextTemplate.textDefsByBase.get(slotIdBase(slotId));
		if (def?.maxChars !== undefined && [...value].length > def.maxChars) {
			const truncated = [...value].slice(0, def.maxChars).join("");
			nextTexts[slotId] = truncated;
			keptSlots.add(slotId);
			notes.push(`槽 "${slotId}" 超出新模板 maxChars ${def.maxChars}，已截断为："${truncated}"`);
		} else {
			notes.push(`槽 "${slotId}" 在新模板中不存在，内容已移除："${value.length > 30 ? `${value.slice(0, 30)}…` : value}"`);
		}
	}
	for (const [slotId, value] of Object.entries(page.texts)) {
		const carrier = parseThemeCarrierKey(slotId);
		if (!carrier) continue;
		if (keptSlots.has(carrier.baseSlotId) || nextTemplate.textDefsByBase.has(slotIdBase(carrier.baseSlotId))) {
			nextTexts[slotId] = value;
		}
	}
	nextPage.texts = nextTexts;
	return nextPage;
}

function slotIdBase(slotId: string): string {
	return slotId.replace(/\[\d+\]/g, "");
}

interface BookSearchMatch {
	where: "pageText" | "photo" | "chapter";
	pageNo?: number;
	slotId?: string;
	photoId?: string;
	chapterId?: string;
	preview: string;
}

function searchAlbumBook(state: AlbumBookState, query: string, limit: number): BookSearchMatch[] {
	const matches: BookSearchMatch[] = [];
	const lowerQuery = query.toLowerCase();
	const push = (match: BookSearchMatch): boolean => {
		matches.push(match);
		return matches.length >= limit;
	};

	for (const [index, page] of state.pages.entries()) {
		for (const [slotId, value] of Object.entries(page.texts)) {
			if (value.toLowerCase().includes(lowerQuery)) {
				if (push({ where: "pageText", pageNo: index + 1, slotId, preview: preview(value, query) })) {
					return matches;
				}
			}
		}
	}
	for (const chapter of state.chapters) {
		for (const photo of chapter.photos) {
			if (photo.sceneDescription.toLowerCase().includes(lowerQuery)) {
				if (
					push({
						where: "photo",
						chapterId: chapter.chapterId,
						photoId: photo.photoId,
						preview: preview(photo.sceneDescription, query),
					})
				) {
					return matches;
				}
			}
		}
		const context = chapter.chapterContext ?? "";
		if (context.toLowerCase().includes(lowerQuery)) {
			if (push({ where: "chapter", chapterId: chapter.chapterId, preview: preview(context, query) })) {
				return matches;
			}
		}
	}
	return matches;
}

function preview(text: string, query: string): string {
	const index = text.toLowerCase().indexOf(query.toLowerCase());
	if (index < 0) return text.slice(0, 80);
	const start = Math.max(0, index - 30);
	const end = Math.min(text.length, index + query.length + 30);
	return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

function describeTextSlot(
	template: TemplateCatalogEntry,
	slotId: string,
): { slotId: string; role: string; lang?: string; maxChars?: number; sample?: string } {
	const def = template.textDefsByBase.get(slotIdBase(slotId));
	// 不再暴露 hint（抽象指引效果差）；只给 sample 示范文案，让 AI 照着改。
	return {
		slotId,
		role: def?.role ?? "text",
		lang: def?.lang,
		maxChars: def?.maxChars,
		sample: def?.sample,
	};
}

function requirePage(state: AlbumBookState, pageNo: number): AlbumPage {
	const page = findAlbumPageByNo(state, pageNo);
	if (!page) {
		throw new Error(
			`没有第 ${pageNo} 页。本书共 ${state.pages.length} 页，页码取值 1..${state.pages.length}（见 get_book_summary）。`,
		);
	}
	return page;
}

function requireTemplate(catalog: TemplateCatalog, templateId: string): TemplateCatalogEntry {
	const template = catalog.get(templateId);
	if (!template) throw new Error(`模板库中找不到模板 "${templateId}"`);
	return template;
}

function readNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function clampInteger(value: number, min: number, max: number): number {
	return Math.min(Math.max(Math.trunc(value), min), max);
}

function readStringRecord(value: unknown): Record<string, string> {
	if (!isRecord(value)) return {};
	const record: Record<string, string> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (typeof entry === "string") record[key] = entry;
	}
	return record;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
