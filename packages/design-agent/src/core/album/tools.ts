import type { AgentTool, AgentToolResult, Skill } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "typebox";
import {
	bestInkFor,
	BOOK_STYLES,
	type BookStyle,
	bookStyleById,
	bookStyleOf,
	bookStyleSeed,
	contrastRatio,
	interiorInkSequence,
	PAGE_BACKGROUND_CARRIER_KEY,
	styleBackgroundOptions,
	THIRD_SET_INK,
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
import {
	isCutout,
	isLutId,
	LUT_IDS,
	type PhotoFilterPatch,
	type PhotoFilterRef,
	quantizeStrength,
	resolveEffectiveFilter,
} from "./photo-filter.ts";
import { createDefaultAlbumSkills } from "./skills.ts";
import { type FontRole, fontAllowsRole, fontsForRole, getFontEntry } from "./font-registry.ts";
import { derivePageTexts, patchHtmlImagePos, patchHtmlText, validatePageHtml } from "./html-guard.ts";
import {
	type ImageFit,
	IMAGE_FIT_MODES,
	type ImagePosValue,
	isImageFit,
	MAX_IMAGE_SCALE,
	MIN_IMAGE_SCALE,
	resolveImagePos,
} from "./image-fit.ts";
import { bakeAlbumPageHtml, ensureAlbumPageHtml } from "./page-html.ts";
import { parseThemeCarrierKey, type TemplateCatalog, type TemplateCatalogEntry } from "./templates-catalog.ts";

export interface AlbumToolsOptions {
	catalog: TemplateCatalog;
	getBookState: () => AlbumBookState;
	setBookState: (state: AlbumBookState) => void;
	now?: () => Date;
	skills?: Skill[];
	/** 滤镜/抠图走 albums.photo_filter + settingsRevision,**不走 commitWrite** ——
	 * 两套存储两套 OCC,混在一起必并发脏写(设计文档 §6②)。未注入时
	 * set_photo_filter / set_photo_cutout 两个工具不注册:宁可没这个能力,
	 * 也不能让模型调一个写不进去的工具。
	 * 实现方是 web 侧的 applyAgentPhotoFilter(album 行锁内走 lockAlbumForSettingsWrite)。
	 * warnings 原样进工具结果的 notes(如「这本书已分享」),让 Agent 转告用户。 */
	applyPhotoFilter?: (patch: PhotoFilterPatch) => Promise<{ warnings: string[] }>;
	/** 真图直喂的**兜底**通道(复用 compose 的 ref200px 路径):photoId → 图像字节。
	 * 常规视觉输入是 read_page 带回来的照片档案 —— 这条路只在档案答不了时走
	 * (「这张不对劲」)。未注入时 look_at_photos 不注册。 */
	lookAtPhotos?: (photoIds: string[]) => Promise<Array<{ photoId: string; data: string; mimeType: string }>>;
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

// ── set_image_pos:构图裁切 ────────────────────────────────────────────────
// 分工原则(设计文档 §4.4):**语义交给模型,几何交给代码**。模型只表达意图,
// x/y/scale 由 resolveImagePos 拿档案的 subjectBox/faceBoxes 算 —— LLM 心算坐标
// 必错,而且错得没规律、测不出来。
//
// ⚠️ rotate 本批明确不动:schema 只收 x/y/scale,不收 rotate;旋转过的槽直接拒绝,
// 不去动它的盒交换几何。contracts 的 ImagePos 与 page-html-dom 那两处 rotate
// 契约不一致是手工编辑那条线的账,混进来只会扩大 diff。这是有意为之,不是漏了。
const IMAGE_FIT_DESCRIPTION =
	"构图意图,工具会按照片档案自动算坐标:center-subject=把主体放到画面中心;avoid-face-crop=尽量避开人脸(按所有人脸的并集算;档案里没有人脸框时自动退回主体居中);fill=铺满不特意对齐(回到 50/50/1)。";

const setImagePosSchema = Type.Object({
	updates: Type.Array(
		Type.Object({
			pageNo: PageRefSchema,
			positions: Type.Record(
				Type.String(),
				Type.Union([
					Type.Object({
						// 逐个字面量列出(不是 IMAGE_FIT_MODES.map) —— typebox 需要元组才能推出
						// 联合类型,map 出来的数组会把 fit 推成 never。与 IMAGE_FIT_MODES 的
						// 一致性由 album-image-pos-tool.test.ts 的守卫钉住。
						fit: Type.Union(
							[Type.Literal("center-subject"), Type.Literal("avoid-face-crop"), Type.Literal("fill")],
							{ description: IMAGE_FIT_DESCRIPTION },
						),
					}),
					Type.Object({
						x: Type.Number({ description: "横向 object-position 百分比,0-100(0=左边缘,100=右边缘)。" }),
						y: Type.Number({ description: "纵向 object-position 百分比,0-100(0=上边缘,100=下边缘)。" }),
						scale: Type.Number({
							description: `放大倍数,${MIN_IMAGE_SCALE}-${MAX_IMAGE_SCALE};${MIN_IMAGE_SCALE} = 不放大。小于 ${MIN_IMAGE_SCALE} 会露底,被拒。`,
						}),
					}),
				]),
				{
					description:
						"图槽 id → 该槽的构图。**优先给 { fit: ... } 意图**,让工具照档案算坐标;只有用户明确说了方向(「往左一点」「再拉近些」)才给 { x, y, scale }。只需列出要改的槽,没列到的槽原样不动。",
				},
			),
		}),
		{ description: "一次可提交多页、每页多槽的构图调整。" },
	),
});

type SetImagePosInput = Static<typeof setImagePosSchema>;

// ── set_photo_filter / set_photo_cutout:整本定调与抠图 ─────────────────────
// 两者共用 albums.photo_filter 这一列(滤镜与抠图同属「每张照片的派生像素状态」),
// 走 settingsRevision 那套 OCC,与页面 draft 的 version 彻底分开。
//
// ⚠️ 契约铁律:cutouts 只认 true,关掉是**删键**(patch 里写 null),绝不写 false ——
// 允许 false 会让「没抠」有两种表示,renderVersion 和派生缓存 key 立刻产生歧义。
const lutIdSchema = Type.String({
	enum: [...LUT_IDS],
	description: "滤镜 id(26 个确定性胶片 LUT 之一)。",
} as never);

const photoFilterRefSchema = Type.Object({
	lutId: lutIdSchema,
	strength: Type.Number({ description: "滤镜强度 0-100,会被归到 5 的倍数。一般 50-70;超过 80 会明显失真。" }),
});

const setPhotoFilterSchema = Type.Object({
	default: Type.Optional(
		Type.Union([photoFilterRefSchema, Type.Null()], {
			description: "全书默认滤镜。传 null = 整本回到原片。不传 = 不动全书默认。",
		}),
	),
	overrides: Type.Optional(
		Type.Record(Type.String(), Type.Union([photoFilterRefSchema, Type.Null()]), {
			description: "单张覆盖:photoId → 滤镜,或 null 表示这张用原片。不传 = 不动已有覆盖。",
		}),
	),
});

const setPhotoCutoutSchema = Type.Object({
	photoIds: Type.Array(Type.String(), { minItems: 1, description: "要开/关抠图的照片 id(来自 read_page 的 images[slot].photoId)。" }),
	on: Type.Boolean({ description: "true = 抠出主体,false = 恢复原图。" }),
});

type SetPhotoFilterInput = Static<typeof setPhotoFilterSchema>;
type SetPhotoCutoutInput = Static<typeof setPhotoCutoutSchema>;

// ── look_at_photos:真图兜底 ──────────────────────────────────────────────
// 上限 6 张。真图进上下文很贵(#307 刚因为上下文把整页 HTML 改成默认不发),
// 而且模型为了「稳妥」会每轮都想看图 —— 边界写死在工具描述和这个常量里。
const MAX_LOOK_AT_PHOTOS = 6;

const lookAtPhotosSchema = Type.Object({
	photoIds: Type.Array(Type.String(), {
		minItems: 1,
		maxItems: MAX_LOOK_AT_PHOTOS,
		description: `要看的照片 id(来自 read_page 的 images[slot].photoId)。一次最多 ${MAX_LOOK_AT_PHOTOS} 张。`,
	}),
});

type LookAtPhotosInput = Static<typeof lookAtPhotosSchema>;

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
	const applyPhotoFilter = options.applyPhotoFilter;
	const lookAtPhotos = options.lookAtPhotos;
	return [
		createReadPagesTool(options),
		createSearchBookTool(options),
		createListTemplatesTool(options),
		createUpdatePageTextsTool(options),
		createWritePageHtmlTool(options),
		createSwapPageTemplateTool(options),
		createUpdatePageImagesTool(options),
		createSetImagePosTool(options),
		createSetTextColorsTool(options),
		createSetPageBackgroundTool(options),
		createApplyBookStyleTool(options),
		createSetTextFontsTool(options),
		createMovePagesTool(options),
		createDeletePageTool(options),
		createReadSkillTool(options),
		createWriteTodosTool(),
		// 跨存储写入的 seam 没注入就不注册这两个工具 —— 让模型看见一个写不进去的
		// 工具比没有这个能力更糟(它会以为改成功了,还会在回复里跟用户说改好了)。
		...(applyPhotoFilter
			? [
					createSetPhotoFilterTool(options, applyPhotoFilter) as AgentTool,
					createSetPhotoCutoutTool(options, applyPhotoFilter) as AgentTool,
				]
			: []),
		// 取图 seam 没注入就不注册 —— 同上,写不进去/看不到图的工具不该出现在菜单里。
		...(lookAtPhotos ? [createLookAtPhotosTool(options, lookAtPhotos) as AgentTool] : []),
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
				// maskKey 是 R2 存储实现细节,对模型决策零价值,只占上下文 —— 剥掉。
				const { maskKey: _droppedMaskKey, ...profile } = photo?.profile ?? {};
				const filter = resolveEffectiveFilter(state.photoFilter, photoId);
				return [
					slotId,
					{
						photoId,
						sceneDescription: photo?.sceneDescription ?? "",
						orientation: photo?.orientation,
						takenAt: photo?.takenAt ?? undefined,
						// 照片视觉档案:Agent 判断调色/裁切/抠图的唯一常规输入。
						// 存量书没建过档 => 整个键不出现(降级路径必须活着)。
						...(photo?.profile ? { profile } : {}),
						// 当前构图位置。**没设过也显式给默认值**(#165 的 render default) ——
						// 省略会让模型以为这个槽不支持调位置。
						imagePos: page.imagePos?.[slotId] ?? { x: 50, y: 50, scale: 1 },
						// 当前生效的滤镜 + 抠图状态。没滤镜时只剩 { cutout }。
						filter: { ...(filter ?? {}), cutout: isCutout(state.photoFilter, photoId) },
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

/**
 * 模板自带的深色页底。换到这些模板上，文字 carrier 必须跟着翻成浅字 ——
 * 不翻的话 mag-62 上是 #1c1b18 配 #12363A，约 1.3:1，整页读不了
 * (design-apply.ts:249 那条注释点名至今没修的坑)。
 * 值取自 render/html-templates/<id>.ts 的页根 style，改模板底色要同步改这里。
 */
const TEMPLATE_OWN_BACKGROUND: Record<string, string> = {
	"mag-62": "#12363A",
	"mag-63": "#12363A",
	p01: "#1C1B18",
};

/** 一页的实际底色：页级 carrier 优先，其次模板自带深底，最后模板默认白。 */
function effectivePageBackground(page: AlbumPage): string {
	return page.texts[PAGE_BACKGROUND_CARRIER_KEY] ?? TEMPLATE_OWN_BACKGROUND[page.templateId] ?? "#FFFFFF";
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
			// 换模板可能换掉了页底色（深底模板自带深底）——字色必须跟着翻，否则留下读不了的页。
			const beforeInk = bestInkFor(effectivePageBackground(page));
			const afterInk = bestInkFor(effectivePageBackground(nextPage));
			if (beforeInk !== afterInk) {
				const nextTemplateEntry = requireTemplate(options.catalog, nextPage.templateId);
				for (const slotId of collectThemeableSlots(nextPage, nextTemplateEntry)) {
					nextPage.texts[`${slotId}#accentColor`] = afterInk;
				}
				notes.push(`底色明暗变了，文字色跟着翻成${afterInk === THIRD_SET_INK.light ? "浅字" : "深字"}`);
			}
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

/** 一个槽的构图请求:要么给意图(工具算坐标),要么给坐标(用户明确说了方向)。 */
type ImagePosRequest = { fit: ImageFit } | ImagePosValue;

/** 手工坐标必须三项齐给 —— 缺项补默认 = 把没提到的那一维静默推平。 */
const IMAGE_POS_COORD_KEYS = ["x", "y", "scale"] as const;

function createSetImagePosTool(
	options: AlbumToolsOptions,
): AgentTool<typeof setImagePosSchema, AlbumWriteDetails> {
	return {
		name: "set_image_pos",
		label: "调整照片构图",
		description:
			"调整照片在框里的位置和缩放。**优先用 fit 意图**(center-subject=主体居中、avoid-face-crop=尽量避开人脸、fill=铺满不特意对齐),工具会根据照片档案自动算出坐标;只有用户明确说了方向(「往左一点」「再拉近些」)才直接传 x/y/scale。x/y 是 0-100 的百分比,scale ≥ 1。",
		parameters: setImagePosSchema,
		prepareArguments(args: unknown): SetImagePosInput {
			return { updates: readImagePosUpdates(options, args) };
		},
		async execute(_toolCallId: string, params: SetImagePosInput): Promise<AgentToolResult<AlbumWriteDetails>> {
			const state = options.getBookState();
			if (params.updates.length === 0) throw new Error("updates 至少要包含一页");

			// 先整批校验(与 update_page_images 同一道防线):任一页非法则整批拒绝,不改状态。
			const notes: string[] = [];
			const resolved: Array<{ internalNo: number; positions: Record<string, ImagePosValue> }> = [];
			for (const update of params.updates) {
				const internalNo = Number(update.pageNo);
				const page = requirePage(options, state, internalNo);
				const template = requireTemplate(options.catalog, page.templateId);
				const label = pageLabelOf(options, state, internalNo);
				// 没有实际改动就不写:空 positions 也走 commitWrite 会白白前进 book version
				// → 整书 replaceAll + draftRevision 前进 → 协同 OCC 下给别的协作者凭空造冲突面。
				if (Object.keys(update.positions).length === 0) {
					throw new Error(`${label}的 positions 是空的 —— 至少要给一个图槽,没有实际改动就不该写。`);
				}
				const allowed = new Set(template.imageSlotIds);
				const positions: Record<string, ImagePosValue> = {};

				for (const [slotId, request] of Object.entries(update.positions)) {
					if (!allowed.has(slotId)) {
						throw new Error(
							`${label}的模板 ${template.id} 没有图片槽 "${slotId}"。可用槽:${template.imageSlotIds.join("、") || "(无)"}`,
						);
					}
					// 旋转过的槽:html 里是「盒交换」几何(绝对定位 + 转置尺寸 + rotate),
					// 按无旋转分支去 patch 会把旋转毁掉。rotate 本批不动 —— 直接拒。
					const previous = page.imagePos?.[slotId] as (ImagePosValue & { rotate?: number }) | undefined;
					if (previous?.rotate) {
						throw new Error(
							`${label}的图槽 "${slotId}" 被旋转过(${previous.rotate}°),本工具不改旋转过的图。请让用户在编辑器里手动调整。`,
						);
					}

					if ("fit" in request) {
						const photoId = page.images[slotId];
						const photo = photoId ? findAlbumPhoto(state, photoId) : undefined;
						// fill 的定义就是 50/50/1,不需要几何;其余意图算不出来就必须报错。
						// ⚠️ 以前是退回默认 + 在 notes 里说一句 —— 但写工具 terminate,模型这一轮
						// 根本读不到 notes,只会照着调用前那句「已按主体重新构图」交差,用户拿到的
						// 却是被推平的构图。报错是这一轮唯一能到达模型的通道。
						if (request.fit !== "fill") {
							if (!photoId) {
								throw new Error(`${label}的图槽 "${slotId}" 是空槽(没有照片),fit 意图无从算起。`);
							}
							if (!photo?.profile) {
								throw new Error(
									`${label}的图槽 "${slotId}" 的照片没有视觉档案(存量书没建过档),算不出主体位置,做不了 ${request.fit}。要么改用 fit:"fill"(铺满,回到 50/50/1),要么等用户说了方向再给 x/y/scale —— 别声称已按主体重新构图。`,
								);
							}
						}
						positions[slotId] = resolveImagePos(request.fit, photo?.profile);
						continue;
					}

					for (const axis of ["x", "y"] as const) {
						const value = request[axis];
						if (!Number.isFinite(value) || value < 0 || value > 100) {
							throw new Error(`${label}的图槽 "${slotId}" 的 ${axis} 必须在 0-100 之间(object-position 百分比),收到 ${value}。`);
						}
					}
					if (!Number.isFinite(request.scale) || request.scale < MIN_IMAGE_SCALE || request.scale > MAX_IMAGE_SCALE) {
						throw new Error(
							`${label}的图槽 "${slotId}" 的 scale 必须在 ${MIN_IMAGE_SCALE}-${MAX_IMAGE_SCALE} 之间(小于 ${MIN_IMAGE_SCALE} 会露出底色),收到 ${request.scale}。`,
						);
					}
					positions[slotId] = { x: request.x, y: request.y, scale: request.scale };
				}
				resolved.push({ internalNo, positions });
			}

			const nextState = cloneAlbumBookState(state);
			const operations: string[] = [];
			for (const { internalNo, positions } of resolved) {
				const nextPage = requirePage(options, nextState, internalNo);
				const nextImagePos: Record<string, ImagePosValue> = { ...(nextPage.imagePos ?? {}) };
				for (const [slotId, pos] of Object.entries(positions)) {
					nextImagePos[slotId] = pos;
					// 页面真相是 html,object-position / transform 是烘进去的 —— 只改数据
					// 不改 html,画板上照片纹丝不动(存库 html 优先于即时渲染)。
					// 槽位级 patch 而不是整页重烘:重烘会把 write_page_html 的手工版面冲掉。
					if (nextPage.html) {
						const patched = patchHtmlImagePos(nextPage.html, slotId, pos);
						if (patched) nextPage.html = patched;
						else notes.push(`${pageLabelOf(options, nextState, internalNo)}的 HTML 里找不到图槽 "${slotId}" 的锚点,构图已记在数据层,渲染端会按它重烘。`);
					}
				}
				nextPage.imagePos = nextImagePos;
				operations.push(`p${internalNo}:imagePos(${Object.keys(positions).join(",")})`);
			}
			return commitWrite(options, nextState, {
				pageNo: Number(params.updates[0]!.pageNo),
				operations,
				notes,
			});
		},
	};
}

function createLookAtPhotosTool(
	options: AlbumToolsOptions,
	lookAtPhotos: NonNullable<AlbumToolsOptions["lookAtPhotos"]>,
): AgentTool<typeof lookAtPhotosSchema, { photoIds: string[] }> {
	return {
		name: "look_at_photos",
		label: "看照片原图",
		description: `直接看照片原图。**这是兜底,不是默认输入** —— 常规判断先读 read_page 给的照片档案(profile:构图/场景/人数/色温/明暗/情绪/一句话描述),只有档案答不了的时候(用户说「这张不对劲」「这张为什么这么怪」)才调它。一次最多 ${MAX_LOOK_AT_PHOTOS} 张:真图进上下文很贵,每轮都看图会让上下文和成本双爆。`,
		parameters: lookAtPhotosSchema,
		prepareArguments(args: unknown): LookAtPhotosInput {
			if (!isRecord(args)) return { photoIds: [] };
			const raw = Array.isArray(args.photoIds) ? args.photoIds : args.photoId !== undefined ? [args.photoId] : [];
			return { photoIds: raw.filter((entry): entry is string => typeof entry === "string") };
		},
		async execute(
			_toolCallId: string,
			params: LookAtPhotosInput,
		): Promise<AgentToolResult<{ photoIds: string[] }>> {
			if (params.photoIds.length === 0) throw new Error("photoIds 至少要包含一张照片");
			if (params.photoIds.length > MAX_LOOK_AT_PHOTOS) {
				throw new Error(
					`一次最多看 ${MAX_LOOK_AT_PHOTOS} 张照片,收到 ${params.photoIds.length} 张。先读 read_page 的照片档案,只对真正判断不了的那几张调这个工具。`,
				);
			}
			const state = options.getBookState();
			for (const photoId of params.photoIds) requireBookPhoto(state, photoId);

			const images = await lookAtPhotos(params.photoIds);
			// ⚠️ 回执报的是**真的拿到的那几张**,不是请求的那几张。web 侧会按预算跳过
			// 一部分(没有服务端缩图,单张/单次都有字节上限),照抄请求 id 会让模型对着
			// 一张自己没看到的照片评头论足 —— 幻觉的直接来源。
			const seen = images.map((image) => image.photoId);
			const missing = params.photoIds.filter((photoId) => !seen.includes(photoId));
			const payload = {
				photoIds: seen,
				...(missing.length > 0
					? {
							missingPhotoIds: missing,
							note: `这些照片没取到(可能还没上传完成,或体积超出单次预算):${missing.join("、")}。别评价没看到的照片,需要的话告诉用户。`,
						}
					: {}),
			};
			// 读工具:不 terminate —— 模型看完图还要接着改书。
			return {
				content: [
					{ type: "text", text: JSON.stringify(payload, null, 1) },
					...images.map((image) => ({ type: "image" as const, data: image.data, mimeType: image.mimeType })),
				],
				details: { photoIds: seen },
			};
		},
	};
}

// ── 滤镜/抠图:跨存储写入,不走 commitWrite ────────────────────────────────

interface PhotoFilterWriteDetails {
	target: string;
	changed: number;
	notes?: string[];
}

function photoFilterResult(details: PhotoFilterWriteDetails): AgentToolResult<PhotoFilterWriteDetails> {
	return {
		content: [{ type: "text", text: JSON.stringify(details, null, 1) }],
		details,
		terminate: true,
	};
}

/** photoId 必须真的在这本书里 —— 模型编 id 时要当场拒,别把垃圾写进设置列。 */
function requireBookPhoto(state: AlbumBookState, photoId: string): void {
	if (typeof photoId !== "string" || photoId.length === 0) {
		throw new Error("photoId 必须是非空字符串");
	}
	if (!findAlbumPhoto(state, photoId)) {
		throw new Error(`photoId "${photoId}" 不存在于这本书的任何章节。用 read_page 查 images[slot].photoId。`);
	}
}

function normalizeFilterRef(raw: unknown, label: string): PhotoFilterRef | null {
	if (raw === null || raw === undefined) return null;
	if (!isRecord(raw)) throw new Error(`${label} 必须是 { lutId, strength } 或 null(null = 原片)`);
	if (!isLutId(raw.lutId)) {
		throw new Error(
			`${label} 的 lutId "${String(raw.lutId)}" 不是可用滤镜。可用滤镜:${LUT_IDS.join("、")}`,
		);
	}
	const strength = raw.strength;
	if (typeof strength !== "number" || !Number.isFinite(strength) || strength < 0 || strength > 100) {
		throw new Error(`${label} 的 strength 必须是 0-100 的数字,收到 ${JSON.stringify(strength)}`);
	}
	// strength 一律过 quantizeStrength(5 的倍数) —— 与 web 侧同一归一化,
	// 不然同一档强度在两边算出不同的 renderVersion,分享快照直接失配。
	return { lutId: raw.lutId, strength: quantizeStrength(strength) };
}

function createSetPhotoFilterTool(
	options: AlbumToolsOptions,
	applyPhotoFilter: NonNullable<AlbumToolsOptions["applyPhotoFilter"]>,
): AgentTool<typeof setPhotoFilterSchema, PhotoFilterWriteDetails> {
	return {
		name: "set_photo_filter",
		label: "设置照片滤镜",
		description:
			"给整本书定调色(26 个胶片滤镜),也可以给单张照片单独指定。先读照片档案里的 colorTemp/brightness/mood 再选,别凭书名猜。strength 是 0-100,一般 50-70 之间;超过 80 会明显失真。传 default:null 让整本回到原片,overrides 里某张传 null 让那张回到原片。",
		parameters: setPhotoFilterSchema,
		prepareArguments(args: unknown): SetPhotoFilterInput {
			return isRecord(args) ? (args as SetPhotoFilterInput) : ({} as SetPhotoFilterInput);
		},
		async execute(
			_toolCallId: string,
			params: SetPhotoFilterInput,
		): Promise<AgentToolResult<PhotoFilterWriteDetails>> {
			const raw = params as Record<string, unknown>;
			const hasDefault = Object.hasOwn(raw, "default");
			const hasOverrides = Object.hasOwn(raw, "overrides") && isRecord(raw.overrides);
			if (!hasDefault && !hasOverrides) {
				throw new Error("至少要给 default(全书默认滤镜)或 overrides(单张覆盖)之一");
			}

			const state = options.getBookState();
			const patch: PhotoFilterPatch = {};
			if (hasDefault) patch.default = normalizeFilterRef(raw.default, "default");
			if (hasOverrides) {
				const overrides: Record<string, PhotoFilterRef | null> = {};
				for (const [photoId, value] of Object.entries(raw.overrides as Record<string, unknown>)) {
					requireBookPhoto(state, photoId);
					overrides[photoId] = normalizeFilterRef(value, `overrides["${photoId}"]`);
				}
				patch.overrides = overrides;
			}

			// **不走 commitWrite** —— 这里一个字节的书状态都不改。
			const { warnings } = await applyPhotoFilter(patch);
			return photoFilterResult({
				target: hasDefault && hasOverrides ? "default+overrides" : hasDefault ? "default" : "overrides",
				changed: (hasDefault ? 1 : 0) + Object.keys(patch.overrides ?? {}).length,
				notes: warnings.length > 0 ? warnings : undefined,
			});
		},
	};
}

/** 抠图开关的错误话术:只有布尔 true 才开,方向不猜(见 prepareArguments 里的注释)。 */
const REQUIRE_CUTOUT_ON =
	'on 必须是布尔值:true = 抠出主体,false = 恢复原图。字符串 "true"/"false" 与 0/1 都不接受 —— 开关方向不猜。';

function createSetPhotoCutoutTool(
	options: AlbumToolsOptions,
	applyPhotoFilter: NonNullable<AlbumToolsOptions["applyPhotoFilter"]>,
): AgentTool<typeof setPhotoCutoutSchema, PhotoFilterWriteDetails> {
	return {
		name: "set_photo_cutout",
		label: "抠出照片主体",
		description:
			"把照片主体从背景里抠出来(用于主体叠加类版式)。**逐张开,不要整本默认全抠** —— 抠图会改变照片观感,用户没要求就别动。要改哪几张,在调这个工具之前就说清楚:它一返回本轮就结束了,你没有补话的机会。",
		parameters: setPhotoCutoutSchema,
		prepareArguments(args: unknown): SetPhotoCutoutInput {
			if (!isRecord(args)) throw new Error(REQUIRE_CUTOUT_ON);
			const rawIds = Array.isArray(args.photoIds) ? args.photoIds : args.photoId !== undefined ? [args.photoId] : [];
			// ⚠️ 开关方向**不许猜**。旧写法 `args.on !== false` 把 "false"(字符串)、0、
			// 缺省全折成 true:用户说「把抠图关掉」,系统反而给他抠了背景,renderVersion
			// 一变已发布的分享快照当场失配 —— 反向执行比不执行糟得多。非布尔一律报错,
			// 错误里带合法取值让模型自己改对。
			if (typeof args.on !== "boolean") {
				throw new Error(`${REQUIRE_CUTOUT_ON}收到 ${describeValue(args.on)}。`);
			}
			return {
				photoIds: rawIds.filter((entry): entry is string => typeof entry === "string"),
				on: args.on,
			};
		},
		async execute(
			_toolCallId: string,
			params: SetPhotoCutoutInput,
		): Promise<AgentToolResult<PhotoFilterWriteDetails>> {
			if (params.photoIds.length === 0) throw new Error("photoIds 至少要包含一张照片");
			const state = options.getBookState();
			const cutouts: Record<string, true | null> = {};
			for (const photoId of params.photoIds) {
				requireBookPhoto(state, photoId);
				// ⚠️ 契约铁律:关掉抠图是**删键**(null),绝不写 false。允许 false 会让
				// 「没抠」有两种表示,renderVersion 和派生缓存 key 立刻产生歧义。
				// ⚠️ 判等写 `=== true` 而不是真值判断:第二道防线,万一有非布尔绕过
				// prepareArguments 落到这里,方向也只会倒向安全的那一侧(关闭)。
				cutouts[photoId] = params.on === true ? true : null;
			}

			const { warnings } = await applyPhotoFilter({ cutouts });
			return photoFilterResult({
				target: params.on ? "cutout:on" : "cutout:off",
				changed: params.photoIds.length,
				notes: warnings.length > 0 ? warnings : undefined,
			});
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

/**
 * 打回 set_text_colors 时给模型的**可行**出路（2026-08-29 最终评审 Important 3）。
 *
 * 旧文案一律端出两个 ink（"深底配浅字 X、浅底配深字 Y"）。问题有二：
 *   ① 底色统一的书上，两个里必有一个不可用，那半句是噪音；
 *   ② 多巴胺书每页底色不同 —— 淡黄 #F3F0A8 配浅字只有 1.05、橙 #C83E18 配深字 3.46，
 *      **没有任何一个 hex 能同时过这两页**（评审把 #F5F2E8/#1A1A14/#FFF/#000 四个都
 *      实测打回了）。这时两个建议色本身都不可用，模型照着改会无限撞墙，而「相册配色」
 *      和「风格理解」两个技能都还在往这个工具身上指。
 *
 * 现在按「这本书里到底有没有一个字色能过全书」来说话：
 *   · 有 → 只报那一个（或那两个），是真的能用的；
 *   · 没有 → 明说统一刷一个字色做不到，并给出两条真正走得通的路：
 *     apply_book_style 改整本气质、set_page_background 改某几页观感（改底色时字色
 *     会自动跟着翻，见该工具）。
 *
 * 注意判据是「有没有可用色」而不是「底色统不统一」：底色不统一但全是浅底的书，
 * 深字在每页上都过得了，一刀切拒绝会误伤。
 */
function uniformColorAdvice(state: AlbumBookState): string {
	const backgrounds = state.pages.map(effectivePageBackground);
	const workable = [THIRD_SET_INK.light, THIRD_SET_INK.dark].filter((ink) =>
		backgrounds.every((bg) => {
			const ratio = contrastRatio(bg, ink);
			return !Number.isFinite(ratio) || ratio >= 4.5;
		}),
	);
	if (workable.length > 0) {
		return `这本书每页都读得了的文字色是 ${workable.join(" 或 ")}；要整本换气质用 apply_book_style。`;
	}
	const distinct = [...new Set(backgrounds.map((bg) => bg.toUpperCase()))];
	const why =
		distinct.length > 1
			? `这本书 ${distinct.length} 种底色混着用（浅底页要深字、深底页要浅字）`
			: `这本书的底色 ${distinct[0]} 明暗居中`;
	return (
		`${why}，统一刷一个文字色这件事做不到 —— 没有哪个颜色能在每一页上都过 4.5:1。` +
		`要改整本气质用 apply_book_style；只想改某几页的观感用 set_page_background（改底色时文字色会自动跟着翻）。`
	);
}

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

			// 对比度体检:文字色落在该页底色上必须 >= 4.5:1。AI 看不见渲染结果,不会自己发现
			// 「深底刷深字」——这里不拦,用户拿到的就是一整页读不了的书(mag-62 上实测 1.3:1)。
			const state0 = options.getBookState();
			const failures: string[] = [];
			for (const [index, page] of state0.pages.entries()) {
				// 用 effectivePageBackground(Task 8 引入)而不是只看 carrier ——
				// mag-62/mag-63/p01 这几个模板自带深底,页面没走过 set_page_background、
				// 没有 #pageBackground carrier 时,只查 carrier 会当成白底放行,
				// 评审实测 1.343:1 就是从这个缺口钻出来的。
				const bg = effectivePageBackground(page);
				for (const [kind, color] of provided) {
					const ratio = contrastRatio(bg, color as string);
					if (!Number.isFinite(ratio) || ratio >= 4.5) continue;
					failures.push(
						`${pageLabelOf(options, state0, index + 1)}底色 ${bg} 配 ${kind} 色 ${color} 只有 ${ratio.toFixed(2)}:1`,
					);
				}
			}
			if (failures.length > 0) {
				const shown = failures.slice(0, 3).join("；");
				throw new Error(
					`对比度不够（要 4.5:1 以上）：${shown}${failures.length > 3 ? ` 等 ${failures.length} 处` : ""}。` +
						uniformColorAdvice(state0),
				);
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

/** 多巴胺内页取色的 seed。**公式住在 contracts（bookStyleSeed）**，这里只是取
 *  state.pages 交过去 —— apps/web 落库时要按同一个公式把种子记回
 *  draft.design.interiorSeed，追加照片才复算得出同一串序列（2026-08-29 最终评审
 *  Critical 1）。两边各写一份的话，第一次改公式就串色。
 *  **导出**是为了让测试能算出期望序列，不必在测试里复刻一份取 seed 的逻辑。 */
export function bookSeed(state: AlbumBookState): string {
	return bookStyleSeed(state.pages);
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
		if (slotId === PAGE_BACKGROUND_CARRIER_KEY) {
			// 页级底色 carrier 不挂在任何模板文字槽下,validateTextsPatch 会把它当
			// "未知槽"清掉——不特判的话,用户设过的页底色会在换模板后静默复位成模板
			// 默认(Task 4「重烘后不再丢失」被这条迁移路径绕过去了,评审实测坐实)。
			nextTexts[slotId] = value;
			continue;
		}
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
			// 照片描述有两处来源:档案的 description(建过档的书)与 sceneDescription
			// (存量书 / 档案回填后)。engine 侧 sceneDescription 长期恒空,只搜它这条
			// 分支一直搜不到东西 —— 档案优先,两处都看,但同一张照片只报一次。
			const candidates = [photo.profile?.description ?? "", photo.sceneDescription];
			const hit = candidates.find((text) => text.length > 0 && text.toLowerCase().includes(lowerQuery));
			if (hit && push({ where: "photo", photoId: photo.photoId, preview: preview(hit, query) })) {
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

// 兼容：既接受批量 { updates: [{pageNo, positions}] }，也接受单页 { pageNo, positions }。
// pageNo 是用户口径页码(数字=内页,"cover"/"toc"/"ending"),此处转内部页位 ——
// 换算走 resolveRefToInternal,它带 isSpread(双宽页占两个号,漏传会比画布少号)。
function readImagePosUpdates(
	options: AlbumToolsOptions,
	args: unknown,
): Array<{ pageNo: number; positions: Record<string, ImagePosRequest> }> {
	if (!isRecord(args)) return [];
	if (Array.isArray(args.updates)) {
		return args.updates.filter(isRecord).map((update) => {
			const rawRef = update.pageNo ?? update.pageIndex;
			return {
				pageNo: resolveRefToInternal(options, rawRef),
				positions: readImagePosRecord(update.positions ?? update.imagePos, rawRef),
			};
		});
	}
	const rawRef = args.pageNo ?? args.pageIndex;
	// 连页码都没有 = 不是单页调用,交给 execute 报「updates 至少要包含一页」。
	if (rawRef === undefined || rawRef === null) return [];
	return [
		{
			pageNo: resolveRefToInternal(options, rawRef),
			positions: readImagePosRecord(args.positions ?? args.imagePos, rawRef),
		},
	];
}

/** 报错话术里的页码位置:直接回显模型自己写的那个值,它才知道改哪一处。 */
function imagePosRefLabel(rawRef: unknown): string {
	return `pageNo ${typeof rawRef === "string" ? JSON.stringify(rawRef) : String(rawRef)}`;
}

function readImagePosRecord(value: unknown, rawRef: unknown): Record<string, ImagePosRequest> {
	if (!isRecord(value)) {
		throw new Error(
			`${imagePosRefLabel(rawRef)} 的 positions 必须是 { 图槽 id: { fit: ... } 或 { x, y, scale } } 这样的对象,收到 ${describeValue(value)}。`,
		);
	}
	const out: Record<string, ImagePosRequest> = {};
	for (const [slotId, entry] of Object.entries(value)) {
		out[slotId] = readImagePosRequest(entry, `${imagePosRefLabel(rawRef)} 的图槽 "${slotId}"`);
	}
	return out;
}

/**
 * 一个槽的构图请求。**非法输入一律报错,绝不静默降级。**
 *
 * 旧写法:`isImageFit(entry.fit)` 不成立就掉进手工坐标分支,缺项补 50/50/1。
 * 于是 `fit:"center"`(少了 `-subject`)= 把这一槽的构图推平成默认值,book version
 * 前进,回执还报成功 —— 用户听到的是「已按主体重新构图」,拿到的是全被推平。
 * 静默降级比报错糟得多:报错模型能自己改对,降级它连错都不知道。
 *
 * ⚠️ 别指望 prepareArguments 之后那道 typebox 校验(pi-ai 的 validateToolArguments)
 * 兜底 —— 它看到的是本函数改写之后的入参。非法值在这里被折成合法形状,那道防线
 * 就永远看不到原始值。判非法必须发生在这里。
 */
function readImagePosRequest(entry: unknown, label: string): ImagePosRequest {
	if (!isRecord(entry)) {
		throw new Error(`${label} 的构图必须是 { fit: ... } 或 { x, y, scale },收到 ${describeValue(entry)}。`);
	}
	const hasFit = Object.hasOwn(entry, "fit");
	const hasCoord = IMAGE_POS_COORD_KEYS.some((key) => Object.hasOwn(entry, key));
	if (hasFit && hasCoord) {
		throw new Error(
			`${label} 同时给了 fit 和坐标 —— 二选一:要么只给 fit(工具照档案算坐标),要么只给 x/y/scale(用户明确说了方向时)。`,
		);
	}
	if (hasFit) {
		if (!isImageFit(entry.fit)) {
			throw new Error(
				`${label} 的 fit ${describeValue(entry.fit)} 不是可用的构图意图。可用值:${IMAGE_FIT_MODES.join("、")}。`,
			);
		}
		return { fit: entry.fit };
	}
	if (!hasCoord) {
		throw new Error(
			`${label} 既没给 fit 也没给 x/y/scale。优先给 fit(${IMAGE_FIT_MODES.join("、")}),只有用户明确说了方向才给三项齐全的坐标。`,
		);
	}
	// 三项逐个读,少一项就报错 —— 这里**没有**默认值:缺项按 50/50/1 补,等于把模型
	// 没提到的那一维静默推平(x 给了、y 没给 = y 被拉回 50)。
	const readCoord = (key: (typeof IMAGE_POS_COORD_KEYS)[number]): number => {
		const raw = entry[key];
		if (typeof raw !== "number" || !Number.isFinite(raw)) {
			throw new Error(
				`${label} 的 ${key} 必须是数字(x/y 是 0-100 百分比,scale 是 ${MIN_IMAGE_SCALE}-${MAX_IMAGE_SCALE}),收到 ${describeValue(raw)}。三项要齐给;想让工具代劳算坐标就改用 fit 意图(${IMAGE_FIT_MODES.join("、")})。`,
			);
		}
		return raw;
	};
	return { x: readCoord("x"), y: readCoord("y"), scale: readCoord("scale") };
}

function describeValue(value: unknown): string {
	return value === undefined ? "undefined" : JSON.stringify(value);
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
