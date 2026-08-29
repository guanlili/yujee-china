import type { AgentTool, AgentToolResult, Skill } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "typebox";
import {
	bestInkFor,
	BOOK_STYLES,
	type BookStyle,
	bookStyleById,
	bookStyleOf,
	interiorInkSequence,
	PAGE_BACKGROUND_CARRIER_KEY,
	styleBackgroundOptions,
} from "@yujee/contracts/design";
import {
	type AlbumBookState,
	type AlbumPage,
	cloneAlbumBookState,
	clonePage,
	findAlbumPageByNo,
	findAlbumPhoto,
	formatPageUserRef,
	NON_NUMBERED_PAGE_CATEGORIES,
	type PageUserRef,
	pageUserRefs,
	resolvePageUserRef,
	validateImagesMap,
	validateTextsPatch,
} from "./book-state.ts";
import { applyPageMoves, type PageMoveOperation } from "./page-move.ts";
import { createDefaultAlbumSkills } from "./skills.ts";
import { type FontRole, fontAllowsRole, fontsForRole, getFontEntry } from "./font-registry.ts";
import { derivePageTexts, patchHtmlText, validatePageHtml } from "./html-guard.ts";
import { bakeAlbumPageHtml, ensureAlbumPageHtml } from "./page-html.ts";
import { parseThemeCarrierKey, type TemplateCatalog, type TemplateCatalogEntry } from "./templates-catalog.ts";

export interface AlbumToolsOptions {
	catalog: TemplateCatalog;
	getBookState: () => AlbumBookState;
	setBookState: (state: AlbumBookState) => void;
	now?: () => Date;
	skills?: Skill[];
}

// ── 用户口径页码(铁律:模型看到/传入的页码 = 用户画面上看到的页码)──
// 内页用数字(1 起,与画面右下角页码一致);封面/目录/封尾不占号,用类别名指代。
const PAGE_REF_DESCRIPTION =
	'用户口径页码,与用户画面上看到的页码一致:内页用数字(从 1 开始);封面传 "cover"、目录传 "toc"、封尾传 "ending"(这些页不占数字页码)。';
const PageRefSchema = Type.Union([Type.Number(), Type.String()], { description: PAGE_REF_DESCRIPTION });

export function catalogCategoryOf(catalog: TemplateCatalog): (templateId: string) => string | undefined {
	return (templateId) => catalog.get(templateId)?.category;
}

// 双宽模板判定:用户口径页码里双宽页占两个号(与画布 folio 同语义,book-state 抬头)。
// 凡把数组位置换算成用户口径的地方都必须传它 —— pageUserRefs 的 isSpread 缺省是
// 「全不是双宽」,漏传的口径会比画布 folio 少号(album-server 的界面上下文标签栽过)。
export function catalogSpreadOf(catalog: TemplateCatalog): (templateId: string) => boolean {
	return (templateId) => catalog.get(templateId)?.spread === true;
}

// 模型传入的用户口径页码 → 内部 1 基数组位置。解析失败返回 -1(requirePage 统一报错)。
function resolveRefToInternal(options: AlbumToolsOptions, value: unknown): number {
	if (value === undefined || value === null) return -1;
	return (
		resolvePageUserRef(
			options.getBookState(),
			catalogCategoryOf(options.catalog),
			value,
			catalogSpreadOf(options.catalog),
		) ?? -1
	);
}

// 内部页位 → 用户称呼(报错/回执对模型说人话,与用户所见一致)。
function pageLabelOf(options: AlbumToolsOptions, state: AlbumBookState, internalNo: number): string {
	const ref = pageUserRefs(state, catalogCategoryOf(options.catalog), catalogSpreadOf(options.catalog))[
		internalNo - 1
	];
	return ref === undefined ? `#${internalNo}` : formatPageUserRef(ref);
}

// 用户口径页码 → 工具载荷里的 pageNo 值(数字/类别名;双宽页给 "L-R" 字符串)。
function payloadPageNo(ref: PageUserRef | undefined): number | string | undefined {
	if (ref === undefined) return undefined;
	return typeof ref === "object" ? `${ref.left}-${ref.right}` : ref;
}

// 本书可用页码清单(报错提示用)。
function pageRefRangeText(options: AlbumToolsOptions, state: AlbumBookState): string {
	const refs = pageUserRefs(state, catalogCategoryOf(options.catalog), catalogSpreadOf(options.catalog));
	// 双宽页占两个号:内页号上界取所有号里的最大值(不是内页张数)。
	let maxInteriorNo = 0;
	for (const ref of refs) {
		if (typeof ref === "number") maxInteriorNo = Math.max(maxInteriorNo, ref);
		else if (typeof ref === "object") maxInteriorNo = Math.max(maxInteriorNo, ref.right);
	}
	const specials = refs.filter((ref): ref is "cover" | "toc" | "ending" => typeof ref === "string");
	const parts: string[] = specials.map((ref) => `${formatPageUserRef(ref)}("${ref}")`);
	if (maxInteriorNo > 0) parts.push(`内页 1..${maxInteriorNo}`);
	return parts.join("、");
}

const readPagesSchema = Type.Object({
	pageNos: Type.Optional(
		Type.Array(PageRefSchema, {
			description: "要读取的页码数组。省略或空数组 = 读取全书所有页（用于了解全书）。",
		}),
	),
	includeHtml: Type.Optional(
		Type.Boolean({
			description:
				"是否返回整页 HTML。默认 false。整页 HTML 很长，只有你确实要用 write_page_html 整页改版面时才传 true；改文字/颜色/字体/换模板都不需要它。",
		}),
	),
});

const searchBookSchema = Type.Object({
	query: Type.String({ description: "在全书文字槽、照片描述和章节背景中搜索的文本，大小写不敏感。" }),
	limit: Type.Optional(Type.Number({ description: "最多返回的匹配数。默认 10，最大 30。" })),
});

const updatePageTextsSchema = Type.Object({
	updates: Type.Array(
		Type.Object({
			pageNo: PageRefSchema,
			texts: Type.Record(Type.String(), Type.String(), {
				description:
					"槽 id → 新文字内容。只需给出要修改的槽。写多长都行——版面会自动缩字号装下；照着 sample 的篇幅量级即可。",
			}),
		}),
		{ description: "一次可提交多页、每页多槽的文字修改。" },
	),
});

const swapPageTemplateSchema = Type.Object({
	pageNo: PageRefSchema,
	templateId: Type.String({ description: "新模板 id（用 list_templates 查询同类目、同图槽数的候选）。" }),
});

const updatePageImagesSchema = Type.Object({
	updates: Type.Array(
		Type.Object({
			pageNo: PageRefSchema,
			images: Type.Record(Type.String(), Type.String(), {
				description: "完整的槽 id → photoId 映射（整页替换）：未列出的槽会被清空（显示为缺图占位），照片必须存在于本书章节。",
			}),
		}),
		{ description: "一次可提交多页的图片替换。" },
	),
});

const setTextColorsSchema = Type.Object({
	titleColor: Type.Optional(
		Type.String({
			description: "标题色（同时用于 decoration 装饰槽：英文标签、页码等），#RGB 或 #RRGGBB 十六进制。",
		}),
	),
	bodyColor: Type.Optional(Type.String({ description: "正文色，#RGB 或 #RRGGBB 十六进制。" })),
	captionColor: Type.Optional(Type.String({ description: "注释/图注色，#RGB 或 #RRGGBB 十六进制。" })),
});

const setTextFontsSchema = Type.Object({
	titleFont: Type.Optional(
		Type.String({ description: "标题字体 id（须是标题角色的合法字体，用 read_skill 相册字体 查菜单）。" }),
	),
	bodyFont: Type.Optional(
		Type.String({ description: "正文字体 id（含图注，须是正文角色的合法字体）。" }),
	),
	decorationFont: Type.Optional(
		Type.String({ description: "装饰字体 id（英文标签/页码/点缀，须是装饰角色的合法字体）。" }),
	),
});

const movePagesSchema = Type.Object({
	operations: Type.Array(
		Type.Union([
			Type.Object({
				type: Type.Literal("move"),
				pageNo: PageRefSchema,
				before: Type.Optional(PageRefSchema),
				after: Type.Optional(PageRefSchema),
			}),
			Type.Object({
				type: Type.Literal("swap"),
				a: PageRefSchema,
				b: PageRefSchema,
			}),
		]),
		{
			minItems: 1,
			description:
				'按序应用的页序操作。move = 把 pageNo 摘出、插到锚点页前(before)/后(after),二者恰好给一个,锚点可用 "cover"/"toc"/"ending";swap = 两内页对调。所有页码引用都按本次调用之前的页序解析,多步操作不用自己推算挪动后的新序号。',
		},
	),
});

type MovePagesInput = Static<typeof movePagesSchema>;

const deletePageSchema = Type.Object({
	pageNo: PageRefSchema,
});

type DeletePageInput = Static<typeof deletePageSchema>;

const listTemplatesSchema = Type.Object({
	category: Type.Optional(Type.String({ description: "按类目过滤：cover / toc / interior / ending。" })),
	imageSlotCount: Type.Optional(Type.Number({ description: "按图槽数量过滤。" })),
});

const readSkillSchema = Type.Object({
	name: Type.String({ description: "需要读取完整内容的 skill 名称。" }),
});

// ── write_todos:复诵式长任务计划(2026-08-05 设计:docs/specs/2026-08-05-write-todos-design.md)──
// 整表覆盖、无服务端状态、纯 no-op;计划的唯一载体是对话历史里的参数与回执。
const TODO_STATUSES = ["pending", "in_progress", "completed"] as const;
type AlbumTodoStatus = (typeof TODO_STATUSES)[number];

interface AlbumTodo {
	content: string;
	status: AlbumTodoStatus;
}

const MAX_TODOS = 30;

const writeTodosSchema = Type.Object({
	todos: Type.Array(
		Type.Object({
			content: Type.String({ description: "任务内容，一句话，具体可执行（如「把第 3-5 页换成杂志模板」）。" }),
			status: Type.Union([Type.Literal("pending"), Type.Literal("in_progress"), Type.Literal("completed")], {
				description: "pending 未开始 / in_progress 进行中 / completed 已完成。",
			}),
		}),
		{
			description: "完整待办清单。整表覆盖：每次调用都传全部条目（含已完成的），不是增量。空数组 = 清空计划。",
		},
	),
});

type ReadPagesInput = Static<typeof readPagesSchema>;
type SearchBookInput = Static<typeof searchBookSchema>;
type UpdatePageTextsInput = Static<typeof updatePageTextsSchema>;
type SwapPageTemplateInput = Static<typeof swapPageTemplateSchema>;
type UpdatePageImagesInput = Static<typeof updatePageImagesSchema>;
type SetTextColorsInput = Static<typeof setTextColorsSchema>;
type SetTextFontsInput = Static<typeof setTextFontsSchema>;
type ListTemplatesInput = Static<typeof listTemplatesSchema>;
type ReadSkillInput = Static<typeof readSkillSchema>;
type WriteTodosInput = Static<typeof writeTodosSchema>;

const DEFAULT_SEARCH_LIMIT = 10;
const MAX_SEARCH_LIMIT = 30;

export function createAlbumTools(options: AlbumToolsOptions): AgentTool[] {
	return [
		createReadPagesTool(options),
		createSearchBookTool(options),
		createListTemplatesTool(options),
		createUpdatePageTextsTool(options),
		createWritePageHtmlTool(options),
		createSwapPageTemplateTool(options),
		createUpdatePageImagesTool(options),
		createSetTextColorsTool(options),
		createSetPageBackgroundTool(options),
		createApplyBookStyleTool(options),
		createSetTextFontsTool(options),
		createMovePagesTool(options),
		createDeletePageTool(options),
		createReadSkillTool(options),
		createWriteTodosTool(),
	];
}

function readPagePayload(
	options: AlbumToolsOptions,
	state: AlbumBookState,
	internalNo: number,
	includeHtml = false,
): Record<string, unknown> {
	const page = requirePage(options, state, internalNo);
	const template = requireTemplate(options.catalog, page.templateId);
	// chapter 概念不进 AI 上下文(分簇/写文案的内部工具);AI 的全局语境走书级
	// 设计简报(主题/配色/封面氛围,见 composeChatTurn),页面语境 = html + 照片描述。
	// pageNo = 用户口径(内页数字/封面目录封尾类别名);管线原始 pageIndex 不喂模型。
	return {
		pageNo: payloadPageNo(
			pageUserRefs(state, catalogCategoryOf(options.catalog), catalogSpreadOf(options.catalog))[
				internalNo - 1
			],
		),
		templateId: page.templateId,
		category: template.category,
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
		// 空槽显式列出（用户删过图的槽，页面上渲成浅灰缺图占位）。不列出来 AI 就看不见
		// 它们，答不了「这页缺图吗」，也想不到用 update_page_images 补图。
		...(template.imageSlotIds.some((slotId) => !(slotId in page.images))
			? { emptyImageSlots: template.imageSlotIds.filter((slotId) => !(slotId in page.images)) }
			: {}),
		texts: page.texts,
		textSlotDefs: template.textSlotIds.map((slotId) => describeTextSlot(template, slotId)),
		repeatTextSlotBases: template.repeatTextSlotBases.map((base) => `${base}[n]`),
		// 页面真相:完整 HTML(C 方案)。**默认不发**(#307):整页 HTML 是上下文大头
		// (模板平均 ~7K 字符,mag-42 单页 35K),读全书能上到十几万 token。改文字/
		// 颜色/字体/换模板都用不到它,只有 write_page_html 整页改版才需要 —— 那时
		// 显式传 includeHtml=true。图片 src 是 {{IMG_SRC:slotId}} token,别动。
		...(includeHtml ? { html: ensureAlbumPageHtml(page) } : {}),
	};
}

function createReadPagesTool(options: AlbumToolsOptions): AgentTool<typeof readPagesSchema, { pageNos: number[] }> {
	return {
		name: "read_page",
		label: "读取页面",
		description:
			"读取一页或多页的内容（图片 + 文字 + 槽位定义）：传 pageNos 指定多页；省略 pageNos = 读取全书所有页（用于了解全书）。默认不含整页 HTML —— 改文字/颜色/字体/换模板都不需要 HTML；只有要用 write_page_html 整页改版面时，才对那一页传 includeHtml=true。",
		parameters: readPagesSchema,
		prepareArguments(args: unknown): ReadPagesInput {
			if (!isRecord(args)) return {};
			const includeHtml = args.includeHtml === true;
			// 兼容单页/别名：pageNos 数组优先；否则 pageNo/pageIndex 单值包成数组；都没有 = 全书。
			// 入参是用户口径页码(数字=内页序号,"cover"/"toc"/"ending"=封面/目录/封尾),此处转内部页位。
			// 无效引用保留为 -1 透传:requirePage 会带可用页码清单报错,绝不静默回退成读全书。
			const rawList = Array.isArray(args.pageNos) ? args.pageNos : undefined;
			if (rawList && rawList.length > 0) {
				return { pageNos: rawList.map((entry) => resolveRefToInternal(options, entry)), includeHtml };
			}
			const rawSingle = args.pageNo ?? args.pageIndex;
			if (rawSingle !== undefined && rawSingle !== null) {
				return { pageNos: [resolveRefToInternal(options, rawSingle)], includeHtml };
			}
			return { includeHtml };
		},
		async execute(_toolCallId: string, params: ReadPagesInput): Promise<AgentToolResult<{ pageNos: number[] }>> {
			const state = options.getBookState();
			const pageNos =
				params.pageNos && params.pageNos.length > 0
					? params.pageNos.map(Number)
					: state.pages.map((_, index) => index + 1);
			const pages = pageNos.map((pageNo) => readPagePayload(options, state, pageNo, params.includeHtml === true));
			return {
				content: [{ type: "text", text: JSON.stringify({ pages }, null, 1) }],
				details: { pageNos },
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
		description: "在全书页文字、照片描述和章节背景中搜索文本，返回命中位置（页码/槽 id/照片 id）。用于修改定位内容。",
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
			const matches = searchAlbumBook(
				state,
				catalogCategoryOf(options.catalog),
				query,
				limit,
				catalogSpreadOf(options.catalog),
			);
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
		description: "可用版式模板信息，（可按类目 cover/toc/interior/ending 和图槽数过滤）。换模板前先用它确认候选的图槽数与文字槽结构。",
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
						return `${slotId}(${def.role})`;
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
			"修改指定页的文字内容（只传要改的槽）。写入前会按模板校验槽 id ，非法写入会报错并说明限制。一次调用可同时改多页多槽。",
		parameters: updatePageTextsSchema,
		prepareArguments(args: unknown): UpdatePageTextsInput {
			return { updates: readTextUpdates(options, args) };
		},
		async execute(
			_toolCallId: string,
			params: UpdatePageTextsInput,
		): Promise<AgentToolResult<AlbumWriteDetails>> {
			const state = options.getBookState();
			if (params.updates.length === 0) throw new Error("updates 至少要包含一页");
			// 先整批校验：任一页非法则整批拒绝，不改状态。
			for (const update of params.updates) {
				const internalNo = Number(update.pageNo);
				const page = requirePage(options, state, internalNo);
				const template = requireTemplate(options.catalog, page.templateId);
				if (Object.keys(update.texts).length === 0)
					throw new Error(`${pageLabelOf(options, state, internalNo)} texts 至少要包含一个槽`);
				const errors = validateTextsPatch(template, update.texts);
				if (errors.length > 0)
					throw new Error(`${pageLabelOf(options, state, internalNo)}文字写入不合法：\n${errors.join("\n")}`);
			}

			const nextState = cloneAlbumBookState(state);
			const operations: string[] = [];
			const notes: string[] = [];
			for (const update of params.updates) {
				const internalNo = Number(update.pageNo);
				const nextPage = requirePage(options, nextState, internalNo);
				let carrierTouched = false;
				for (const [slotId, value] of Object.entries(update.texts)) {
					nextPage.texts[slotId] = value;
					if (parseThemeCarrierKey(slotId)) carrierTouched = true;
					operations.push(`p${internalNo}:texts.${slotId}`);
				}
				// C 方案:html 是页面真相,槽位改字要同步进 html。
				// 普通槽 → 原位 patch(保留该页手工版面);carrier 键(色/字体)烘不进
				// 现有 html,只能重烘 → 该页手工版面改动会被模板重置,结果里告知。
				if (carrierTouched) {
					nextPage.html = undefined;
					nextPage.html = bakeAlbumPageHtml(nextPage);
					notes.push(`${pageLabelOf(options, state, internalNo)}涉及主题 carrier,已从模板重烘(该页手工版面改动被重置)`);
					continue;
				}
				let html = ensureAlbumPageHtml(nextPage);
				if (!html) continue; // 模板未注册(迁移过渡期):texts 已更新,html 留给渲染端回退
				for (const [slotId, value] of Object.entries(update.texts)) {
					const patched = patchHtmlText(html, slotId, value);
					if (patched === null) {
						notes.push(`${pageLabelOf(options, state, internalNo)}槽 ${slotId} 在 html 里没有锚点(可能被历史编辑移除),该槽文字只更新了数据层`);
						continue;
					}
					html = patched;
				}
				nextPage.html = html;
			}
			return commitWrite(options, nextState, { pageNo: Number(params.updates[0].pageNo), operations, notes });
		},
	};
}

const writePageHtmlSchema = Type.Object({
	pageNo: PageRefSchema,
	html: Type.String({ description: "整页新 HTML(以 read_page 返回的 html 为基础修改后完整交回)。" }),
});

type WritePageHtmlInput = Static<typeof writePageHtmlSchema>;

function createWritePageHtmlTool(
	options: AlbumToolsOptions,
): AgentTool<typeof writePageHtmlSchema, AlbumWriteDetails> {
	return {
		name: "write_page_html",
		label: "改写页面 HTML",
		description:
			"整页改写页面 HTML(版面/内容自由编辑的首选):以 read_page 的 html 为基础修改后完整交回。硬约束:原有 data-text-key / data-image-slot 锚点一个不能删(可挪位置/改样式);图片 src 必须保持 {{IMG_SRC:slotId}} token;禁 script/事件属性/外链;根节点 data-template 不可改(换排版用 swap_page_template)。违反会被拒绝并返回原因。",
		parameters: writePageHtmlSchema,
		prepareArguments(args: unknown): WritePageHtmlInput {
			if (!isRecord(args)) return { pageNo: -1, html: "" };
			return {
				pageNo: resolveRefToInternal(options, args.pageNo ?? args.pageIndex),
				html: typeof args.html === "string" ? args.html : "",
			};
		},
		async execute(
			_toolCallId: string,
			params: WritePageHtmlInput,
		): Promise<AgentToolResult<AlbumWriteDetails>> {
			const state = options.getBookState();
			const internalNo = Number(params.pageNo);
			const page = requirePage(options, state, internalNo);
			if (!params.html.trim()) throw new Error("html 不能为空。以 read_page 返回的 html 为基础修改后完整交回。");
			const prevHtml = ensureAlbumPageHtml(page);
			if (!prevHtml) {
				throw new Error(`${pageLabelOf(options, state, internalNo)}的模板 ${page.templateId} 尚无 HTML 基线,暂不能整页改写。`);
			}
			const errors = validatePageHtml(prevHtml, params.html, page.templateId);
			if (errors.length > 0) {
				throw new Error(`页面 HTML 校验未通过:\n${errors.map((e) => `- ${e}`).join("\n")}`);
			}

			const nextState = cloneAlbumBookState(state);
			const nextPage = requirePage(options, nextState, internalNo);
			nextPage.html = params.html.trim();
			// texts 从 html 派生(装书校验/搜索用);carrier 键(#accentColor 等)保留原值。
			const derived = derivePageTexts(nextPage.html);
			for (const [slotId, value] of Object.entries(derived)) {
				nextPage.texts[slotId] = value;
			}
			return commitWrite(options, nextState, {
				pageNo: internalNo,
				operations: [`p${internalNo}:html`],
				notes: [`texts 已从 html 派生同步(${Object.keys(derived).length} 个槽)`],
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
				pageNo: resolveRefToInternal(options, args.pageNo ?? args.pageIndex),
				templateId: typeof args.templateId === "string" ? args.templateId : "",
			};
		},
		async execute(
			_toolCallId: string,
			params: SwapPageTemplateInput,
		): Promise<AgentToolResult<AlbumWriteDetails>> {
			const state = options.getBookState();
			const internalNo = Number(params.pageNo);
			const page = requirePage(options, state, internalNo);
			const currentTemplate = requireTemplate(options.catalog, page.templateId);
			const nextTemplate = options.catalog.get(params.templateId.trim());
			if (!nextTemplate) throw new Error(`未知模板 "${params.templateId}"。用 list_templates 查询可用模板。`);
			if (nextTemplate.id === page.templateId)
				throw new Error(`${pageLabelOf(options, state, internalNo)}已经在使用模板 ${nextTemplate.id}`);
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
			// 结构性操作:从新模板重新生成页面 HTML,旧页(含手工版面改动)整体重置。
			nextPage.html = undefined;
			nextPage.html = bakeAlbumPageHtml(nextPage);
			notes.push("页面 HTML 已按新模板重新生成(原手工版面改动被重置)");
			const nextState = cloneAlbumBookState(state);
			nextState.pages[internalNo - 1] = nextPage;
			return commitWrite(options, nextState, {
				pageNo: internalNo,
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
			"整页替换图片槽映射（槽 id → photoId）：未列出的槽会被清空，除非用户明确要留空/删图，否则应把所有图槽填满。用于调换图片顺序或替换照片。",
		parameters: updatePageImagesSchema,
		prepareArguments(args: unknown): UpdatePageImagesInput {
			return { updates: readImageUpdates(options, args) };
		},
		async execute(
			_toolCallId: string,
			params: UpdatePageImagesInput,
		): Promise<AgentToolResult<AlbumWriteDetails>> {
			const state = options.getBookState();
			if (params.updates.length === 0) throw new Error("updates 至少要包含一页");
			// 先整批校验：任一页非法则整批拒绝，不改状态。
			for (const update of params.updates) {
				const internalNo = Number(update.pageNo);
				const page = requirePage(options, state, internalNo);
				const template = requireTemplate(options.catalog, page.templateId);
				const errors = validateImagesMap(template, update.images, state);
				if (errors.length > 0)
					throw new Error(`${pageLabelOf(options, state, internalNo)}图片写入不合法：\n${errors.join("\n")}`);
			}

			const nextState = cloneAlbumBookState(state);
			const operations: string[] = [];
			for (const update of params.updates) {
				const internalNo = Number(update.pageNo);
				const nextPage = requirePage(options, nextState, internalNo);
				nextPage.images = { ...update.images };
				operations.push(`p${internalNo}:images`);
			}
			return commitWrite(options, nextState, { pageNo: Number(params.updates[0].pageNo), operations });
		},
	};
}

const ACCENT_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** 配色：文字角色 → 三类色（标题/正文/注释）。decoration（英文标签/页码等）跟标题同色。 */
const ROLE_TO_COLOR_KIND: Record<string, "title" | "body" | "caption"> = {
	title: "title",
	decoration: "title",
	body: "body",
	explain: "caption",
};

/**
 * 字体：文字角色 → 三类字体（标题/正文/装饰）。**与配色不同**——装饰自成一档
 * （页码走 mono、点缀走 script，跟标题字体不是一回事），图注 explain 跟正文同字体。
 */
const ROLE_TO_FONT_KIND: Record<string, FontRole> = {
	title: "title",
	decoration: "decoration",
	body: "body",
	explain: "body",
};

function createSetTextColorsTool(
	options: AlbumToolsOptions,
): AgentTool<typeof setTextColorsSchema, AlbumWriteDetails> {
	return {
		name: "set_text_colors",
		label: "设定文字配色",
		description:
			"整本书一键配色：按文字角色设定颜色——标题（含装饰槽：英文标签/页码）、正文、注释三类各一个色。工具一键刷新",
		parameters: setTextColorsSchema,
		prepareArguments(args: unknown): SetTextColorsInput {
			if (!isRecord(args)) return {};
			const pick = (value: unknown): string | undefined =>
				typeof value === "string" && value.trim() ? value.trim() : undefined;
			return {
				titleColor: pick(args.titleColor),
				bodyColor: pick(args.bodyColor),
				captionColor: pick(args.captionColor),
			};
		},
		async execute(
			_toolCallId: string,
			params: SetTextColorsInput,
		): Promise<AgentToolResult<AlbumWriteDetails>> {
			const kindColors: Record<"title" | "body" | "caption", string | undefined> = {
				title: params.titleColor,
				body: params.bodyColor,
				caption: params.captionColor,
			};
			const provided = Object.entries(kindColors).filter(([, color]) => color !== undefined);
			if (provided.length === 0) {
				throw new Error("至少要给 titleColor / bodyColor / captionColor 中的一个颜色。");
			}
			for (const [kind, color] of provided) {
				if (!ACCENT_COLOR_PATTERN.test(color as string)) {
					throw new Error(`${kind} 颜色必须是 #RGB/#RRGGBB 十六进制，收到："${color}"`);
				}
			}

			const nextState = cloneAlbumBookState(options.getBookState());
			const affectedByKind: Record<string, number> = {};
			const affectedPageNos: number[] = [];
			for (const [index, page] of nextState.pages.entries()) {
				const template = options.catalog.get(page.templateId);
				if (!template) continue;
				let touched = false;
				for (const slotId of collectThemeableSlots(page, template)) {
					const role = template.textDefsByBase.get(slotBaseIdForTheme(slotId))?.role ?? "text";
					const kind = ROLE_TO_COLOR_KIND[role];
					if (!kind) continue;
					const color = kindColors[kind];
					if (!color) continue;
					page.texts[`${slotId}#accentColor`] = color;
					affectedByKind[kind] = (affectedByKind[kind] ?? 0) + 1;
					touched = true;
				}
				if (touched) {
					affectedPageNos.push(index + 1);
					// 主题一键渲染是结构性操作:烘进 html(该页手工版面改动被模板重置)。
					page.html = undefined;
					page.html = bakeAlbumPageHtml(page);
				}
			}

			if (affectedPageNos.length === 0) {
				throw new Error(
					"全书没有匹配这些角色的文字槽，配色无处落地。用 read_page / list_templates 确认页面结构。",
				);
			}

			const operations = provided.map(([kind, color]) => `color:${kind}=${color}`);
			const kindLabel: Record<string, string> = { title: "标题", body: "正文", caption: "注释" };
			const notes = provided
				.filter(([kind]) => affectedByKind[kind])
				.map(([kind]) => `${kindLabel[kind]}色刷了 ${affectedByKind[kind]} 个槽`);
			notes.push(`共影响 ${affectedPageNos.length} 页`);
			return commitWrite(options, nextState, {
				pageNo: affectedPageNos[0] ?? 0,
				operations,
				notes,
			});
		},
	};
}

const setPageBackgroundSchema = Type.Object({
	pages: Type.Union([Type.Literal("all"), Type.Array(PageRefSchema)], {
		description: `要改底色的页：${PAGE_REF_DESCRIPTION} 传 "all" 表示全书。`,
	}),
	colorId: Type.String({ description: "底色 id，只能从当前风格的调色板里挑（报错时会列出可选值）。" }),
});
type SetPageBackgroundInput = Static<typeof setPageBackgroundSchema>;

/** 当前书的风格：从封面页的模板反推（封面模板与风格一一对应，故意不存字段）。 */
function currentBookStyle(options: AlbumToolsOptions): BookStyle {
	const state = options.getBookState();
	const coverPage = state.pages.find((p) => options.catalog.get(p.templateId)?.category === "cover");
	return bookStyleOf(coverPage?.templateId);
}

function createSetPageBackgroundTool(
	options: AlbumToolsOptions,
): AgentTool<typeof setPageBackgroundSchema, AlbumWriteDetails> {
	return {
		name: "set_page_background",
		label: "设定页面底色",
		description:
			"改页面底色：指定页或全书换一个底色，该页文字色按深底浅字/浅底深字自动跟着翻。底色只能从当前风格的调色板里挑，传错会列出可选值。整本换气质用 apply_book_style，不要用这个逐页刷。",
		parameters: setPageBackgroundSchema,
		prepareArguments(args: unknown): SetPageBackgroundInput {
			if (!isRecord(args)) return { pages: [], colorId: "" };
			const pages =
				args.pages === "all"
					? ("all" as const)
					: Array.isArray(args.pages)
						? args.pages
						: args.pages !== undefined
							? [args.pages]
							: [];
			return { pages, colorId: typeof args.colorId === "string" ? args.colorId.trim() : "" };
		},
		async execute(
			_toolCallId: string,
			params: SetPageBackgroundInput,
		): Promise<AgentToolResult<AlbumWriteDetails>> {
			const style = currentBookStyle(options);
			const optionsList = styleBackgroundOptions(style.id);
			const picked = optionsList.find((o) => o.id === params.colorId);
			if (!picked) {
				throw new Error(
					`底色 "${params.colorId}" 不在「${style.name}」风格的调色板里。可选：${optionsList
						.map((o) => o.id)
						.join(" / ")}`,
				);
			}

			const state = options.getBookState();
			const targets =
				params.pages === "all"
					? state.pages.map((_, i) => i + 1)
					: params.pages.map((ref) => resolveRefToInternal(options, ref));
			const bad = targets.filter((n) => n <= 0);
			if (bad.length > 0 || targets.length === 0) {
				throw new Error(`认不出要改哪几页。${pageRefRangeText(options, state)}`);
			}

			const ink = bestInkFor(picked.hex);
			const nextState = cloneAlbumBookState(state);
			const touched: number[] = [];
			for (const internalNo of targets) {
				const page = nextState.pages[internalNo - 1];
				if (!page) continue;
				const template = options.catalog.get(page.templateId);
				page.texts[PAGE_BACKGROUND_CARRIER_KEY] = picked.hex;
				// 底色变了字色必须跟着翻，否则留下「改完底色字读不了」的中间态。
				if (template) {
					for (const slotId of collectThemeableSlots(page, template)) {
						page.texts[`${slotId}#accentColor`] = ink;
					}
				}
				page.html = undefined;
				page.html = bakeAlbumPageHtml(page);
				touched.push(internalNo);
			}
			if (touched.length === 0) throw new Error("没有页面被改到，检查页码。");

			const notes = [
				params.pages === "all" ? `全书 ${touched.length} 页刷成${picked.name}` : `${touched.length} 页刷成${picked.name}`,
				`文字色跟着翻成 ${ink === "#F5F2E8" ? "浅字" : "深字"}`,
			];
			return commitWrite(options, nextState, {
				pageNo: touched[0]!,
				operations: [`pageBackground:${picked.id}=${picked.hex}`],
				notes,
			});
		},
	};
}

const applyBookStyleSchema = Type.Object({
	styleId: Type.String({
		description: "风格 id：editorial（素白散文）/ magazine（杂志刊头）/ dopamine（多巴胺）/ postcard（旅行画报）",
	}),
});
type ApplyBookStyleInput = Static<typeof applyBookStyleSchema>;

/** 多巴胺内页取色的 seed。书状态里没有 albumId 时回落封面首图 photoId —— 只要
 *  对同一本书稳定即可（前缀稳定性靠 interiorInkSequence 自身保证）。
 *  **导出**是为了让测试能算出期望序列，不必在测试里复刻一份取 seed 的逻辑。 */
export function bookSeed(state: AlbumBookState): string {
	const cover = state.pages[0];
	return Object.values(cover?.images ?? {})[0] ?? cover?.templateId ?? "yujee";
}

function createApplyBookStyleTool(
	options: AlbumToolsOptions,
): AgentTool<typeof applyBookStyleSchema, AlbumWriteDetails> {
	return {
		name: "apply_book_style",
		label: "更换全书风格",
		description:
			"整本换气质：换封面和封底版式、刷全书页底色和三个文字色。四个风格见「风格理解」技能。用户对整本观感不满（太素/太花/想文艺点/想活泼点）时用它；只有某几页颜色不对用 set_page_background。注意：换封面版式会重排封面文案，迁不过去的会丢，动手前先告诉用户。",
		parameters: applyBookStyleSchema,
		prepareArguments(args: unknown): ApplyBookStyleInput {
			return { styleId: isRecord(args) && typeof args.styleId === "string" ? args.styleId.trim() : "" };
		},
		async execute(
			_toolCallId: string,
			params: ApplyBookStyleInput,
		): Promise<AgentToolResult<AlbumWriteDetails>> {
			const target = bookStyleById(params.styleId);
			if (!target) {
				throw new Error(
					`未知风格 "${params.styleId}"。可选：${BOOK_STYLES.map((s) => `${s.id}（${s.name}）`).join(" / ")}`,
				);
			}
			const current = currentBookStyle(options);
			if (current.id === target.id) {
				throw new Error(
					`这本书已经是「${target.name}」了。要微调就用 set_page_background 换底色，或 set_text_colors 换字色。`,
				);
			}

			const state = options.getBookState();
			const nextState = cloneAlbumBookState(state);
			const notes: string[] = [];
			const categoryOf = catalogCategoryOf(options.catalog);

			// ① 换封面/封底模板。图槽数不匹配也照换（多出的照片从该页移除，不回流；
			// 新增的槽暂时空着待补图），不能因为槽数不一致就整个跳过 —— 四套风格里
			// 唯二的封尾模板是 mag-22(2 图槽) 和多巴胺专属的 mag-63(纯装饰,0 图槽/
			// 0 文字槽,故意做成没有照片没有文字的收尾页),真实书的封尾几乎总有照片,
			// 若按槽数相等才换,dopamine 风格永远换不了封尾,整条功能等于没做。
			for (const [idx, page] of nextState.pages.entries()) {
				const category = categoryOf(page.templateId);
				const wantId =
					category === "cover" ? target.coverTemplateId : category === "ending" ? target.endingTemplateId : undefined;
				if (!wantId || wantId === page.templateId) continue;
				const nextTemplate = options.catalog.get(wantId);
				if (!nextTemplate) continue;
				const label = category === "cover" ? "封面" : "封尾";
				const prevImageCount = Object.keys(page.images).length;
				const migrateNotes: string[] = [];
				nextState.pages[idx] = migratePageToTemplate(page, nextTemplate, migrateNotes);
				const nextImageCount = nextTemplate.imageSlotIds.length;
				if (nextImageCount < prevImageCount) {
					migrateNotes.push(`图槽从 ${prevImageCount} 减到 ${nextImageCount}，多出的照片从这页移除（不会转移到其他页）`);
				} else if (nextImageCount > prevImageCount) {
					migrateNotes.push(`图槽从 ${prevImageCount} 增到 ${nextImageCount}，新增的槽暂时空着待补图`);
				}
				notes.push(`${label}版式换成 ${wantId}${migrateNotes.length > 0 ? `（${migrateNotes.join("；")}）` : ""}`);
			}
			notes.push("封面/封尾文案已按新版式重排，迁不过去的槽已清空 —— 告诉用户并确认是否要补写");

			// ② 逐页刷底色和字色
			// 多巴胺：确定性序列（同 seed 同长度逐项相同、前缀稳定）。绝不能换成随机 ——
			// 追加照片时只重刷新页，两次结果不一样就会让新页跟全书不是一套色。
			const seed = bookSeed(nextState);
			const interiorIdx = nextState.pages
				.map((p, i) => ({ i, category: categoryOf(p.templateId) }))
				// NON_NUMBERED_PAGE_CATEGORIES 是 Set（book-state.ts:170），用 .has 不是 .includes
				.filter((x) => !NON_NUMBERED_PAGE_CATEGORIES.has(x.category ?? ""))
				.map((x) => x.i);
			const sequence = target.interiorInks ? interiorInkSequence(seed, interiorIdx.length) : undefined;

			for (const [idx, page] of nextState.pages.entries()) {
				const template = options.catalog.get(page.templateId);
				if (!template) continue;
				const seqPos = interiorIdx.indexOf(idx);
				const ink = sequence && seqPos >= 0 ? sequence[seqPos]! : undefined;
				const bg = ink?.bg ?? target.pageBackground;
				const colors = ink ? { title: ink.accent, body: ink.body, explain: ink.body } : target.colors;
				page.texts[PAGE_BACKGROUND_CARRIER_KEY] = bg;
				for (const slotId of collectThemeableSlots(page, template)) {
					const role = template.textDefsByBase.get(slotBaseIdForTheme(slotId))?.role ?? "text";
					const kind = ROLE_TO_COLOR_KIND[role];
					page.texts[`${slotId}#accentColor`] = kind === "body" ? colors.body : kind === "caption" ? colors.explain : colors.title;
				}
				page.html = undefined;
				page.html = bakeAlbumPageHtml(page);
			}

			notes.unshift(`全书 ${nextState.pages.length} 页刷成「${target.name}」`);
			return commitWrite(options, nextState, {
				pageNo: 1,
				operations: [`bookStyle:${current.id}->${target.id}`],
				notes,
			});
		},
	};
}

const FONT_KIND_LABEL: Record<FontRole, string> = { title: "标题", body: "正文", decoration: "装饰" };

function createSetTextFontsTool(
	options: AlbumToolsOptions,
): AgentTool<typeof setTextFontsSchema, AlbumWriteDetails> {
	return {
		name: "set_text_fonts",
		label: "设定文字字体",
		description:
			"整本书一键选字体：按角色设定艺术字——标题、正文（含图注）、装饰（英文标签/页码/点缀）三类各一个字体。全书对应角色的文字槽一次刷到底。至少给一类；只改一类就只传那一类。字体值必须是合法字体 id 且属于该角色（选错角色会打回）；菜单见「相册字体」技能。不要手工逐页写 carrier 键。",
		parameters: setTextFontsSchema,
		prepareArguments(args: unknown): SetTextFontsInput {
			if (!isRecord(args)) return {};
			const pick = (value: unknown): string | undefined =>
				typeof value === "string" && value.trim() ? value.trim() : undefined;
			return {
				titleFont: pick(args.titleFont),
				bodyFont: pick(args.bodyFont),
				decorationFont: pick(args.decorationFont),
			};
		},
		async execute(
			_toolCallId: string,
			params: SetTextFontsInput,
		): Promise<AgentToolResult<AlbumWriteDetails>> {
			const kindFonts: Record<FontRole, string | undefined> = {
				title: params.titleFont,
				body: params.bodyFont,
				decoration: params.decorationFont,
			};
			const provided = Object.entries(kindFonts).filter(([, font]) => font !== undefined) as [
				FontRole,
				string,
			][];
			if (provided.length === 0) {
				throw new Error("至少要给 titleFont / bodyFont / decorationFont 中的一个字体。");
			}
			for (const [kind, font] of provided) {
				if (!getFontEntry(font)) {
					throw new Error(`${FONT_KIND_LABEL[kind]}字体 "${font}" 不是合法字体 id；用 read_skill 相册字体 查菜单。`);
				}
				if (!fontAllowsRole(font, kind)) {
					const menu = fontsForRole(kind)
						.map((f) => f.id)
						.join(" / ");
					throw new Error(`字体 "${font}" 不适合${FONT_KIND_LABEL[kind]}角色。${FONT_KIND_LABEL[kind]}可选：${menu}。`);
				}
			}

			const nextState = cloneAlbumBookState(options.getBookState());
			const affectedByKind: Partial<Record<FontRole, number>> = {};
			const affectedPageNos: number[] = [];
			for (const [index, page] of nextState.pages.entries()) {
				const template = options.catalog.get(page.templateId);
				if (!template) continue;
				let touched = false;
				for (const slotId of collectThemeableSlots(page, template)) {
					const role = template.textDefsByBase.get(slotBaseIdForTheme(slotId))?.role ?? "text";
					const kind = ROLE_TO_FONT_KIND[role];
					if (!kind) continue;
					const font = kindFonts[kind];
					if (!font) continue;
					page.texts[`${slotId}#artFont`] = font;
					affectedByKind[kind] = (affectedByKind[kind] ?? 0) + 1;
					touched = true;
				}
				if (touched) {
					affectedPageNos.push(index + 1);
					page.html = undefined;
					page.html = bakeAlbumPageHtml(page);
				}
			}

			if (affectedPageNos.length === 0) {
				throw new Error(
					"全书没有匹配这些角色的文字槽，字体无处落地。用 get_book_summary / list_templates 确认页面结构。",
				);
			}

			const operations = provided.map(([kind, font]) => `font:${kind}=${font}`);
			const notes = provided
				.filter(([kind]) => affectedByKind[kind])
				.map(([kind]) => `${FONT_KIND_LABEL[kind]}字体刷了 ${affectedByKind[kind]} 个槽`);
			notes.push(`共影响 ${affectedPageNos.length} 页`);
			return commitWrite(options, nextState, {
				pageNo: affectedPageNos[0] ?? 0,
				operations,
				notes,
			});
		},
	};
}

function slotBaseIdForTheme(slotId: string): string {
	return slotId.replace(/\[\d+\]/g, "");
}

/**
 * 一页里所有可套主题（配色/字体）的文字槽 id：模板定义的具体槽 + 页面上已有的重复槽（items[n]），
 * 排除 carrier 键（`slot#accentColor` / `slot#artFont` 之类）本身。
 */
function collectThemeableSlots(page: AlbumPage, template: TemplateCatalogEntry): string[] {
	const slots = new Set<string>(template.textSlotIds);
	for (const key of Object.keys(page.texts)) {
		if (parseThemeCarrierKey(key)) continue;
		slots.add(key);
	}
	return [...slots];
}

function createMovePagesTool(options: AlbumToolsOptions): AgentTool<typeof movePagesSchema, AlbumWriteDetails> {
	return {
		name: "move_pages",
		label: "挪动页面",
		description:
			"调整页面顺序(纯挪位置,页面内容一字不改):operations 数组按序应用,move 插入 / swap 对调。只能挪内页,封面/目录/封尾钉死。一次调用必须表达用户要的完整重排 —— 写入后本轮即结束,不能分多次挪。",
		parameters: movePagesSchema,
		prepareArguments(args: unknown): MovePagesInput {
			if (!isRecord(args) || !Array.isArray(args.operations)) return { operations: [] };
			const operations = args.operations.map((raw): PageMoveOperation => {
				const op = isRecord(raw) ? raw : {};
				if (op.type === "swap") {
					return { type: "swap", a: resolveRefToInternal(options, op.a), b: resolveRefToInternal(options, op.b) };
				}
				return {
					type: "move",
					pageNo: resolveRefToInternal(options, op.pageNo),
					before: op.before === undefined ? undefined : resolveRefToInternal(options, op.before),
					after: op.after === undefined ? undefined : resolveRefToInternal(options, op.after),
				};
			});
			return { operations };
		},
		async execute(_toolCallId: string, params: MovePagesInput): Promise<AgentToolResult<AlbumWriteDetails>> {
			const state = options.getBookState();
			// prepareArguments 已把引用解析成内部位次(数字);此处收窄类型并把未解析(-1)统一报错。
			const resolvedOps: PageMoveOperation[] = params.operations.map((op) =>
				op.type === "swap"
					? { type: "swap", a: Number(op.a), b: Number(op.b) }
					: {
							type: "move",
							pageNo: Number(op.pageNo),
							before: op.before === undefined ? undefined : Number(op.before),
							after: op.after === undefined ? undefined : Number(op.after),
						},
			);
			for (const op of resolvedOps) {
				const refs = op.type === "swap" ? [op.a, op.b] : [op.pageNo, op.before, op.after];
				if (refs.some((no) => no === -1))
					throw new Error(`页码引用无法解析。本书可用页码:${pageRefRangeText(options, state)}`);
			}
			const categoryOf = catalogCategoryOf(options.catalog);
			const isInterior = (page: AlbumPage) => {
				const category = categoryOf(page.templateId);
				return category === undefined || !NON_NUMBERED_PAGE_CATEGORIES.has(category);
			};
			const nextState = cloneAlbumBookState(state);
			const beforePages = nextState.pages;
			nextState.pages = applyPageMoves(beforePages, isInterior, resolvedOps, (no) =>
				pageLabelOf(options, state, no),
			);

			// 结果反馈:每步用户口径描述 + 源页新旧页码映射(模型同轮回话不说错页码)。
			const spreadOf = catalogSpreadOf(options.catalog);
			const oldRefs = pageUserRefs(state, categoryOf, spreadOf);
			const newRefs = pageUserRefs(nextState, categoryOf, spreadOf);
			const sourceNos = resolvedOps.flatMap((op) => (op.type === "swap" ? [op.a, op.b] : [op.pageNo]));
			const operations = resolvedOps.map((op) =>
				op.type === "swap"
					? `swap:${formatPageUserRef(oldRefs[op.a - 1])}<->${formatPageUserRef(oldRefs[op.b - 1])}`
					: `move:${formatPageUserRef(oldRefs[op.pageNo - 1])}->${op.after !== undefined ? `${formatPageUserRef(oldRefs[op.after - 1])}后` : `${formatPageUserRef(oldRefs[op.before! - 1])}前`}`,
			);
			const notes = [...new Set(sourceNos)].map((no) => {
				const page = beforePages[no - 1];
				const newIndex = nextState.pages.indexOf(page);
				return `原${formatPageUserRef(oldRefs[no - 1])} → 现${formatPageUserRef(newRefs[newIndex])}`;
			});
			notes.push("其余内页页码相应顺延;页面内容全部原样未动");
			return commitWrite(options, nextState, { pageNo: sourceNos[0] ?? -1, operations, notes });
		},
	};
}

// 删除书页(2026-08-03 设计:docs/specs/2026-08-03-delete-page-design.md)。
// 只删内页,照片随页移除不回流,拒绝删到内页数为 0。与 move_pages 同口径:只动
// pages 数组、不改余页对象的 pageIndex 字段(落库行序由 persistDesignChat 按数组
// 位置重编号)。
function createDeletePageTool(options: AlbumToolsOptions): AgentTool<typeof deletePageSchema, AlbumWriteDetails> {
	return {
		name: "delete_page",
		label: "删除页面",
		description:
			"删除一张内页,页上的照片和文字一起移除(照片不会转移到其他页)。只能删内页,封面/目录/封尾不可删,书里至少要留一张内页。注意区分意图:用户要「把内容合并/挤到别的页」时不要用本工具,先反问确认。写入后本轮即结束。",
		parameters: deletePageSchema,
		prepareArguments(args: unknown): DeletePageInput {
			return { pageNo: isRecord(args) ? resolveRefToInternal(options, args.pageNo ?? args.pageIndex) : -1 };
		},
		async execute(_toolCallId: string, params: DeletePageInput): Promise<AgentToolResult<AlbumWriteDetails>> {
			const state = options.getBookState();
			const internalNo = Number(params.pageNo);
			if (internalNo === -1)
				throw new Error(`页码引用无法解析。本书可用页码:${pageRefRangeText(options, state)}`);
			const page = requirePage(options, state, internalNo);
			const categoryOf = catalogCategoryOf(options.catalog);
			const isInterior = (candidate: AlbumPage) => {
				const category = categoryOf(candidate.templateId);
				return category === undefined || !NON_NUMBERED_PAGE_CATEGORIES.has(category);
			};
			const label = pageLabelOf(options, state, internalNo);
			if (!isInterior(page)) throw new Error(`${label}是封面/目录/封尾,不可删除`);
			const interiorCount = state.pages.filter(isInterior).length;
			if (interiorCount <= 1) throw new Error("这是最后一张内页,不能删除(书里至少要留一张内页)");

			const nextState = cloneAlbumBookState(state);
			nextState.pages = nextState.pages.filter((_, index) => index !== internalNo - 1);

			// 回执说清两件用户可感知的事:照片去向(随页移除,不回流)和翻面效应
			// (普通内页净减 1 个页位 → 后续内页左右互换;双宽页净减 2 → 不移位)。
			const photoCount = Object.keys(page.images).length;
			const isSpreadTemplate = options.catalog.get(page.templateId)?.spread === true;
			const notes = [
				`${label}已删除;页上 ${photoCount} 张照片一并移除,不会转移到其他页`,
				`剩余内页 ${interiorCount - 1} 张,后续内页页码相应前移`,
				isSpreadTemplate
					? "删的是双宽页(占两个页位),后续页面的左右位置不变"
					: "后续内页的左右位置会互换(直到下一个封面/封尾/双宽页为止),回复里要提醒用户",
			];
			return commitWrite(options, nextState, {
				pageNo: internalNo,
				operations: [`delete:${label}`],
				notes,
			});
		},
	};
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
			const skills = options.skills ?? createDefaultAlbumSkills();
			const skill = skills.find((candidate) => candidate.name === skillName);
			if (!skill) throw new Error(`未知 skill：${skillName}`);
			return {
				content: [{ type: "text", text: skill.content }],
				details: { name: skill.name },
			};
		},
	};
}

const TODO_SYMBOLS: Record<AlbumTodoStatus, string> = {
	pending: "[ ]",
	in_progress: "[→]",
	completed: "[✓]",
};

// 计划工具不接 options:刻意无状态(书状态、会话都不碰),摘除时只删这一个函数与注册行。
function createWriteTodosTool(): AgentTool<typeof writeTodosSchema, { todos: AlbumTodo[]; counts: Record<AlbumTodoStatus, number> }> {
	return {
		name: "write_todos",
		label: "规划任务",
		description:
			"维护当前长任务的待办清单，整表覆盖（每次都传完整列表，空数组=清空）。仅当任务涉及 3 个以上独立步骤/页面时使用（如整本换模板、逐页批量调整）；简单任务直接做，不要用它。它只记录进度，不修改书。",
		parameters: writeTodosSchema,
		prepareArguments(args: unknown): WriteTodosInput {
			// 原样透传(仅断言类型),execute 统一严格校验(非法输入要以带指引的报错打回给模型)。
			return { todos: (isRecord(args) ? args.todos : undefined) as AlbumTodo[] };
		},
		async execute(
			_toolCallId: string,
			params: WriteTodosInput,
		): Promise<AgentToolResult<{ todos: AlbumTodo[]; counts: Record<AlbumTodoStatus, number> }>> {
			const todos = parseTodos(params.todos);
			const counts: Record<AlbumTodoStatus, number> = { pending: 0, in_progress: 0, completed: 0 };
			for (const todo of todos) counts[todo.status] += 1;
			const text =
				todos.length === 0
					? "计划已清空。"
					: [
							`待办 ${counts.completed}/${todos.length} 完成：`,
							...todos.map((todo) => `${TODO_SYMBOLS[todo.status]} ${todo.content}`),
						].join("\n");
			return {
				content: [{ type: "text", text }],
				details: { todos, counts },
			};
		},
	};
}

function parseTodos(raw: unknown): AlbumTodo[] {
	if (!Array.isArray(raw)) {
		throw new Error("todos 必须是数组（整表覆盖：每次传完整清单；空数组=清空计划）");
	}
	if (raw.length > MAX_TODOS) {
		throw new Error(`待办最多 ${MAX_TODOS} 条，收到 ${raw.length} 条；请合并同类步骤（如「逐页调整 1-12 页」记一条）`);
	}
	return raw.map((entry, index) => {
		if (!isRecord(entry)) throw new Error(`第 ${index + 1} 条必须是 { content, status } 对象`);
		const content = typeof entry.content === "string" ? entry.content.trim() : "";
		if (!content) throw new Error(`第 ${index + 1} 条的 content 必须是非空字符串`);
		const status = entry.status;
		if (typeof status !== "string" || !(TODO_STATUSES as readonly string[]).includes(status)) {
			throw new Error(`第 ${index + 1} 条的 status 非法：${JSON.stringify(status)}；只认 pending / in_progress / completed`);
		}
		return { content, status: status as AlbumTodoStatus };
	});
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

	// 文字迁移：槽 id 在新模板里存在者原样保留（多长都不截断），carrier 随基础槽走，
	// 其余丢弃并报告。
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
		notes.push(`槽 "${slotId}" 在新模板中不存在，内容已移除："${value.length > 30 ? `${value.slice(0, 30)}…` : value}"`);
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
	/** 用户口径页码(内页数字/封面目录封尾类别名;双宽页 "L-R"),与用户画面一致。 */
	pageNo?: number | string;
	slotId?: string;
	photoId?: string;
	chapterId?: string;
	preview: string;
}

function searchAlbumBook(
	state: AlbumBookState,
	categoryOf: (templateId: string) => string | undefined,
	query: string,
	limit: number,
	isSpread: (templateId: string) => boolean = () => false,
): BookSearchMatch[] {
	const matches: BookSearchMatch[] = [];
	const userRefs = pageUserRefs(state, categoryOf, isSpread);
	const lowerQuery = query.toLowerCase();
	const push = (match: BookSearchMatch): boolean => {
		matches.push(match);
		return matches.length >= limit;
	};

	for (const [index, page] of state.pages.entries()) {
		for (const [slotId, value] of Object.entries(page.texts)) {
			if (value.toLowerCase().includes(lowerQuery)) {
				if (push({ where: "pageText", pageNo: payloadPageNo(userRefs[index]), slotId, preview: preview(value, query) })) {
					return matches;
				}
			}
		}
	}
	// chapter 概念不进 AI 上下文:照片池仍按内部结构遍历,但命中结果不暴露 chapterId,
	// 章节背景(chapterContext)不再参与搜索(写文案素材已烘进页面 html/texts)。
	for (const chapter of state.chapters) {
		for (const photo of chapter.photos) {
			if (photo.sceneDescription.toLowerCase().includes(lowerQuery)) {
				if (
					push({
						where: "photo",
						photoId: photo.photoId,
						preview: preview(photo.sceneDescription, query),
					})
				) {
					return matches;
				}
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
): { slotId: string; role: string; lang?: string; sample?: string } {
	const def = template.textDefsByBase.get(slotIdBase(slotId));
	// 不再暴露 hint（抽象指引效果差）；只给 sample 示范文案，让 AI 照着改。
	return {
		slotId,
		role: def?.role ?? "text",
		lang: def?.lang,
		sample: def?.sample,
	};
}

function requirePage(options: AlbumToolsOptions, state: AlbumBookState, internalNo: number): AlbumPage {
	const page = findAlbumPageByNo(state, internalNo);
	if (!page) {
		throw new Error(`没有找到目标页。本书可用页码:${pageRefRangeText(options, state)}。${PAGE_REF_DESCRIPTION}`);
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

// 兼容：既接受批量 { updates: [{pageNo, texts}] }，也接受单页 { pageNo, texts }。
// pageNo 是用户口径页码(数字=内页,"cover"/"toc"/"ending"=封面/目录/封尾),此处转内部页位。
function readTextUpdates(
	options: AlbumToolsOptions,
	args: unknown,
): Array<{ pageNo: number; texts: Record<string, string> }> {
	if (!isRecord(args)) return [];
	if (Array.isArray(args.updates)) {
		return args.updates.filter(isRecord).map((update) => ({
			pageNo: resolveRefToInternal(options, update.pageNo ?? update.pageIndex),
			texts: readStringRecord(update.texts),
		}));
	}
	const pageNo = resolveRefToInternal(options, args.pageNo ?? args.pageIndex);
	if (pageNo > 0 && isRecord(args.texts)) return [{ pageNo, texts: readStringRecord(args.texts) }];
	return [];
}

// 兼容：既接受批量 { updates: [{pageNo, images}] }，也接受单页 { pageNo, images }。
// pageNo 是用户口径页码,同 readTextUpdates。
function readImageUpdates(
	options: AlbumToolsOptions,
	args: unknown,
): Array<{ pageNo: number; images: Record<string, string> }> {
	if (!isRecord(args)) return [];
	if (Array.isArray(args.updates)) {
		return args.updates.filter(isRecord).map((update) => ({
			pageNo: resolveRefToInternal(options, update.pageNo ?? update.pageIndex),
			images: readStringRecord(update.images),
		}));
	}
	const pageNo = resolveRefToInternal(options, args.pageNo ?? args.pageIndex);
	if (pageNo > 0 && isRecord(args.images)) return [{ pageNo, images: readStringRecord(args.images) }];
	return [];
}
