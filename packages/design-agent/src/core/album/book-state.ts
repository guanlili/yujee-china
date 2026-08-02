import {
	parseThemeCarrierKey,
	slotBaseId,
	type TemplateCatalog,
	type TemplateCatalogEntry,
} from "./templates-catalog.ts";

/**
 * Album 画布：设计 Agent 的"书"。字段命名与 packages/contracts 的
 * V3LayoutTree / Page 保持一致（跨服务契约单一真相源），此处仅是运行时形状，
 * 不新造契约字段。
 */

export interface AlbumChapterPhoto {
	photoId: string;
	sceneDescription: string;
	orientation?: string;
	composition?: string | null;
	takenAt?: string | null;
	width?: number;
	height?: number;
}

export interface AlbumChapter {
	chapterId: string;
	description?: string;
	chapterContext?: string;
	accentColor?: string | null;
	artFont?: string | null;
	photos: AlbumChapterPhoto[];
}

export interface AlbumPage {
	pageIndex: number;
	templateId: string;
	images: Record<string, string>;
	texts: Record<string, string>;
	imagePos?: Record<string, { x: number; y: number; scale: number }> | null;
	/** 页面 HTML 真相(C 方案,契约 Page.html 镜像):存在时渲染/AI 读写以它为准,
	 * texts 降级为派生缓存。图片 src 保持 {{IMG_SRC:slotId}} token。 */
	html?: string;
}

/** 书级设计简报(AI 的全局语境四件套之三:主题/配色主题/封面氛围;第四件=每页内容本身)。
 * chapter 概念不进 AI 上下文 —— 它只是分簇/写文案管线的内部工具(2026-07-11 用户拍板)。 */
export interface AlbumBookBrief {
	theme?: string;
	palette?: { fonts?: Record<string, string>; colors?: Record<string, string> };
	coverMood?: string;
}

export interface AlbumBookState {
	chapters: AlbumChapter[];
	pages: AlbumPage[];
	version: number;
	updatedAt: string;
	brief?: AlbumBookBrief;
}

export function cloneAlbumBookState(state: AlbumBookState): AlbumBookState {
	return {
		chapters: state.chapters.map((chapter) => ({ ...chapter, photos: chapter.photos.map((photo) => ({ ...photo })) })),
		pages: state.pages.map(clonePage),
		version: state.version,
		updatedAt: state.updatedAt,
		brief: state.brief ? JSON.parse(JSON.stringify(state.brief)) as AlbumBookBrief : undefined,
	};
}

export function clonePage(page: AlbumPage): AlbumPage {
	return {
		...page,
		images: { ...page.images },
		texts: { ...page.texts },
		imagePos: page.imagePos ? { ...page.imagePos } : page.imagePos,
	};
}

export interface ParseAlbumBookResult {
	book: AlbumBookState;
	warnings: string[];
}

/** 解析外部输入（fixture / Web 传入的 draft_json 片段）为书状态，结构非法直接抛错。 */
export function parseAlbumBookInput(raw: unknown, now = new Date()): ParseAlbumBookResult {
	if (!isRecord(raw)) throw new Error("book 输入必须是对象");
	const warnings: string[] = [];

	const chaptersRaw = raw.chapters ?? (isRecord(raw.tree) ? (raw.tree as Record<string, unknown>).chapters : undefined);
	if (!Array.isArray(chaptersRaw)) throw new Error("book.chapters（或 book.tree.chapters）必须是数组");
	const chapters = chaptersRaw.map((chapter, index) => parseChapter(chapter, index));

	if (!Array.isArray(raw.pages)) throw new Error("book.pages 必须是数组");
	// 保留输入数组顺序（draft 的页序是真相；真实管线的 pageIndex 按章节计数、会重复，
	// 不能当排序键或寻址键——寻址一律用 pageNo = 数组位置）。
	const pages = raw.pages.map((page, index) => parsePage(page, index));

	const seenPageIndex = new Set<number>();
	for (const page of pages) {
		if (seenPageIndex.has(page.pageIndex)) warnings.push(`pageIndex ${page.pageIndex} 重复（寻址请用 pageNo）`);
		seenPageIndex.add(page.pageIndex);
	}

	// 书级设计简报(可选):主题/配色主题/封面氛围。宽松解析,非法即忽略。
	const briefRaw = isRecord(raw.brief) ? raw.brief : undefined;
	const brief: AlbumBookBrief | undefined = briefRaw
		? {
				theme: typeof briefRaw.theme === "string" && briefRaw.theme ? briefRaw.theme : undefined,
				palette: isRecord(briefRaw.palette) ? (briefRaw.palette as AlbumBookBrief["palette"]) : undefined,
				coverMood: typeof briefRaw.coverMood === "string" && briefRaw.coverMood ? briefRaw.coverMood : undefined,
			}
		: undefined;

	return {
		book: {
			chapters,
			pages,
			version: typeof raw.version === "number" ? raw.version : 1,
			updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : now.toISOString(),
			brief,
		},
		warnings,
	};
}

export function derivePageChapterId(
	page: AlbumPage,
	photoToChapter: Map<string, string>,
): string | undefined {
	for (const photoId of Object.values(page.images)) {
		const chapterId = photoToChapter.get(photoId);
		if (chapterId) return chapterId;
	}
	return undefined;
}

export function buildPhotoToChapterMap(state: AlbumBookState): Map<string, string> {
	const map = new Map<string, string>();
	for (const chapter of state.chapters) {
		for (const photo of chapter.photos) {
			map.set(photo.photoId, chapter.chapterId);
		}
	}
	return map;
}

/** 按书内顺序号（数组位置）取页——唯一寻址方式。 */
/** 按页码（1 起）取页——工具寻址唯一入口，内部转数组下标 pageNo-1。 */
export function findAlbumPageByNo(state: AlbumBookState, pageNo: number): AlbumPage | undefined {
	if (!Number.isInteger(pageNo) || pageNo < 1) return undefined;
	return state.pages[pageNo - 1];
}

// ───────────────────────── 用户口径页码 ─────────────────────────
//
// 铁律:喂给 AI 的页码必须等于用户在画面上看到的页码。Web 展示层的 folio 规则
// (page-html-dom.pageFolioNumbers)是:封面/目录/封尾不编号,内页从 1 连续编号。
// AI 侧完全对齐 —— 内页用数字(1..M),封面/目录/封尾用类别名指代,绝不占号。

export type PageUserRef = number | "cover" | "toc" | "ending";

const NON_NUMBERED_PAGE_CATEGORIES = new Set(["cover", "toc", "ending"]);

/** 每页(按数组序)的用户口径页码:内页 1..M;封面/目录/封尾返回类别名。 */
export function pageUserRefs(
	state: AlbumBookState,
	categoryOf: (templateId: string) => string | undefined,
): PageUserRef[] {
	let interiorNo = 0;
	return state.pages.map((page) => {
		const category = categoryOf(page.templateId) ?? "";
		if (NON_NUMBERED_PAGE_CATEGORIES.has(category)) return category as PageUserRef;
		interiorNo += 1;
		return interiorNo;
	});
}

/** 用户口径页码 → 中文称呼(对用户/模型说话用)。 */
export function formatPageUserRef(ref: PageUserRef): string {
	if (ref === "cover") return "封面";
	if (ref === "toc") return "目录";
	if (ref === "ending") return "封尾";
	return `第 ${ref} 页`;
}

/** 用户口径页码 → 内部 1 基数组位置;找不到返回 undefined。
 * 数字 = 第 n 个内页;"cover"/"toc"/"ending" = 对应类别的第一页。 */
export function resolvePageUserRef(
	state: AlbumBookState,
	categoryOf: (templateId: string) => string | undefined,
	ref: unknown,
): number | undefined {
	const refs = pageUserRefs(state, categoryOf);
	if (typeof ref === "string") {
		const key = ref.trim().toLowerCase();
		// 类别名(含中文别名)寻址
		const alias: Record<string, PageUserRef> = {
			cover: "cover", 封面: "cover",
			toc: "toc", 目录: "toc",
			ending: "ending", 封底: "ending", 封尾: "ending",
		};
		const target = alias[key] ?? alias[ref.trim()];
		if (target) {
			const index = refs.indexOf(target);
			return index === -1 ? undefined : index + 1;
		}
		const numeric = Number(key);
		if (Number.isInteger(numeric)) return resolvePageUserRef(state, categoryOf, numeric);
		return undefined;
	}
	if (typeof ref === "number" && Number.isInteger(ref) && ref >= 1) {
		const index = refs.indexOf(ref);
		return index === -1 ? undefined : index + 1;
	}
	return undefined;
}

export function findAlbumPhoto(state: AlbumBookState, photoId: string): AlbumChapterPhoto | undefined {
	for (const chapter of state.chapters) {
		const photo = chapter.photos.find((candidate) => candidate.photoId === photoId);
		if (photo) return photo;
	}
	return undefined;
}

// ───────────────────────── 契约合法性校验 ─────────────────────────

/** 校验一批文字槽写入是否对该页模板合法。返回错误列表（空 = 合法）。 */
export function validateTextsPatch(
	template: TemplateCatalogEntry,
	patch: Record<string, string>,
): string[] {
	const errors: string[] = [];
	for (const [key, value] of Object.entries(patch)) {
		if (typeof value !== "string") {
			errors.push(`texts["${key}"] 必须是字符串`);
			continue;
		}
		const carrier = parseThemeCarrierKey(key);
		if (carrier) {
			if (!isKnownTextBase(template, carrier.baseSlotId)) {
				errors.push(`主题 carrier 键 "${key}" 的基础槽 "${carrier.baseSlotId}" 不属于模板 ${template.id}`);
			}
			continue;
		}
		const base = slotBaseId(key);
		const def = template.textDefsByBase.get(base);
		if (!def) {
			if (template.svgSlotIds.has(base)) {
				if (!/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)) {
					errors.push(`SVG 装饰槽 "${key}" 的值必须是 #RGB/#RRGGBB 颜色，收到："${truncate(value, 30)}"`);
				}
				continue;
			}
			errors.push(
				`模板 ${template.id} 没有文字槽 "${key}"。可用槽：${template.textSlotIds.join(", ") || "(无)"}${
					template.repeatTextSlotBases.length > 0
						? `；可变重复槽：${template.repeatTextSlotBases.map((slotBase) => `${slotBase}[n]`).join(", ")}`
						: ""
				}`,
			);
			continue;
		}
		// 不校验字数 —— 模板已不再声明任何字数上限。用户和 AI 写多长都照收，
		// 版面装不下由渲染层的 fit-text 解决（固定高度的文字框自动缩字号），
		// 而不是拒收或砍掉已经写好的字。
	}
	return errors;
}

/** 校验整页图片槽映射是否对模板合法（槽 id 存在、photoId 非空且在本书）。 */
export function validateImagesMap(
	template: TemplateCatalogEntry,
	images: Record<string, string>,
	state: AlbumBookState,
): string[] {
	const errors: string[] = [];
	const allowed = new Set(template.imageSlotIds);
	const providedSlots = Object.keys(images);
	for (const slotId of providedSlots) {
		if (!allowed.has(slotId)) {
			errors.push(`模板 ${template.id} 没有图片槽 "${slotId}"。可用槽：${template.imageSlotIds.join(", ") || "(无)"}`);
		}
	}
	// 空槽是合法状态：编辑器删图就是删 key（image-swap / applyImageClear 同口径），
	// Web 对空槽渲染浅灰「缺少图片」占位。这里若坚持「所有图槽必须填满」，用户删一张图
	// 后进设计对话就会被 /api/book 422 挡在门外 —— 所以不校验槽位齐全。
	// 同一张照片允许出现在同一页的多个槽 —— 用户可能就是想重复用同一张。故也不校验
	// 「一页内 photoId 重复」。只校验槽 id 合法、photoId 非空且存在于本书。
	for (const [slotId, photoId] of Object.entries(images)) {
		if (typeof photoId !== "string" || photoId.length === 0) {
			errors.push(`图片槽 "${slotId}" 的 photoId 必须是非空字符串`);
			continue;
		}
		if (!findAlbumPhoto(state, photoId)) errors.push(`photoId "${photoId}" 不存在于这本书的任何章节`);
	}
	return errors;
}

/** 全书契约体检（fixture 加载与测试用）。 */
export function validateAlbumBook(state: AlbumBookState, catalog: TemplateCatalog): string[] {
	const errors: string[] = [];
	for (const page of state.pages) {
		const template = catalog.get(page.templateId);
		if (!template) {
			errors.push(`第 ${page.pageIndex} 页使用了未知模板 "${page.templateId}"`);
			continue;
		}
		for (const error of validateImagesMap(template, page.images, state)) {
			errors.push(`第 ${page.pageIndex} 页：${error}`);
		}
		for (const error of validateTextsPatch(template, page.texts)) {
			errors.push(`第 ${page.pageIndex} 页：${error}`);
		}
	}
	return errors;
}

// ───────────────────────── 预览渲染（开发用轻量画布） ─────────────────────────

/** 轻量书预览：不是产品渲染器，只为 dev 画布提供直观视图。 */
export function renderAlbumBookPreviewHtml(state: AlbumBookState, catalog: TemplateCatalog): string {
	const photoToChapter = buildPhotoToChapterMap(state);
	const chapterColor = new Map(state.chapters.map((chapter) => [chapter.chapterId, chapter.accentColor ?? "#8a8f98"]));
	const pagesHtml = state.pages
		.map((page) => {
			const template = catalog.get(page.templateId);
			const chapterId = derivePageChapterId(page, photoToChapter);
			const accent = (chapterId && chapterColor.get(chapterId)) || "#8a8f98";
			const imagesHtml = Object.entries(page.images)
				.map(([slotId, photoId]) => {
					const photo = findAlbumPhoto(state, photoId);
					return `<div class="img"><span class="slot">${escapeHtml(slotId)}</span><strong>${escapeHtml(photoId)}</strong><em>${escapeHtml(truncate(photo?.sceneDescription ?? "", 40))}</em></div>`;
				})
				.join("");
			const textsHtml = (template?.textSlotIds ?? Object.keys(page.texts))
				.map((slotId) => {
					const value = page.texts[slotId] ?? "";
					return `<li><span class="slot">${escapeHtml(slotId)}</span>${value ? escapeHtml(value) : '<span class="empty">（空）</span>'}</li>`;
				})
				.join("");
			return `<article style="border-top:4px solid ${escapeHtml(accent)}">
	<header><strong>P${page.pageIndex}</strong> · ${escapeHtml(page.templateId)} <span class="cat">${escapeHtml(template?.category ?? "?")}</span>${chapterId ? ` <span class="cat">${escapeHtml(chapterId)}</span>` : ""}</header>
	<div class="imgs">${imagesHtml || '<div class="img empty">无图</div>'}</div>
	<ul class="texts">${textsHtml}</ul>
</article>`;
		})
		.join("\n");

	return `<!doctype html>
<html lang="zh-CN">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>相册画布 · v${state.version}</title>
		<style>
			:root { font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #eef1f5; color: #111827; }
			body { margin: 0; padding: 24px; }
			.meta { color: #6b7280; font-size: 12px; margin-bottom: 16px; }
			main { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; }
			article { background: #fff; border-radius: 8px; padding: 14px 16px; box-shadow: 0 8px 24px rgb(30 41 59 / 8%); }
			header { font-size: 14px; margin-bottom: 10px; }
			.cat { background: #eef1f5; border-radius: 4px; padding: 1px 6px; font-size: 11px; color: #475569; }
			.imgs { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
			.img { background: #f1f5f9; border: 1px dashed #cbd5e1; border-radius: 6px; padding: 6px 8px; font-size: 11px; display: grid; gap: 2px; min-width: 110px; }
			.img em { color: #64748b; font-style: normal; }
			.slot { color: #0f766e; font-size: 10px; letter-spacing: 0.4px; margin-right: 6px; }
			ul.texts { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; font-size: 12px; }
			.empty { color: #9ca3af; }
		</style>
	</head>
	<body>
		<div class="meta">版本 ${state.version} · ${state.chapters.length} 章 · ${state.pages.length} 页 · 更新于 ${escapeHtml(state.updatedAt)}</div>
		<main>${pagesHtml}</main>
	</body>
</html>`;
}

function isKnownTextBase(template: TemplateCatalogEntry, slotId: string): boolean {
	const base = slotBaseId(slotId);
	return template.textDefsByBase.has(base) || template.svgSlotIds.has(base);
}

function parseChapter(raw: unknown, index: number): AlbumChapter {
	if (!isRecord(raw) || typeof raw.chapterId !== "string") {
		throw new Error(`chapters[${index}] 缺少 chapterId`);
	}
	const photosRaw = Array.isArray(raw.photos) ? raw.photos : [];
	return {
		chapterId: raw.chapterId,
		description: typeof raw.description === "string" ? raw.description : undefined,
		chapterContext: typeof raw.chapterContext === "string" ? raw.chapterContext : undefined,
		accentColor: typeof raw.accentColor === "string" ? raw.accentColor : null,
		artFont: typeof raw.artFont === "string" ? raw.artFont : null,
		photos: photosRaw.map((photo, photoIndex) => parsePhoto(photo, index, photoIndex)),
	};
}

function parsePhoto(raw: unknown, chapterIndex: number, photoIndex: number): AlbumChapterPhoto {
	if (!isRecord(raw) || typeof raw.photoId !== "string") {
		throw new Error(`chapters[${chapterIndex}].photos[${photoIndex}] 缺少 photoId`);
	}
	return {
		photoId: raw.photoId,
		sceneDescription: typeof raw.sceneDescription === "string" ? raw.sceneDescription : "",
		orientation: typeof raw.orientation === "string" ? raw.orientation : undefined,
		composition: typeof raw.composition === "string" ? raw.composition : null,
		takenAt: typeof raw.takenAt === "string" ? raw.takenAt : null,
		width: typeof raw.width === "number" ? raw.width : undefined,
		height: typeof raw.height === "number" ? raw.height : undefined,
	};
}

function parsePage(raw: unknown, index: number): AlbumPage {
	if (!isRecord(raw)) throw new Error(`pages[${index}] 必须是对象`);
	if (typeof raw.pageIndex !== "number" || !Number.isInteger(raw.pageIndex) || raw.pageIndex < 0) {
		throw new Error(`pages[${index}].pageIndex 必须是非负整数`);
	}
	if (typeof raw.templateId !== "string" || raw.templateId.length === 0) {
		throw new Error(`pages[${index}].templateId 必须是非空字符串`);
	}
	return {
		pageIndex: raw.pageIndex,
		templateId: raw.templateId,
		images: parseStringRecord(raw.images, `pages[${index}].images`),
		texts: parseStringRecord(raw.texts, `pages[${index}].texts`),
		imagePos: isRecord(raw.imagePos) ? (raw.imagePos as AlbumPage["imagePos"]) : null,
		// 页面 HTML 真相(C 方案):Web 落库时已烘;缺失(存量数据)由 page-html 兜底现场烘。
		html: typeof raw.html === "string" && raw.html.length > 0 ? raw.html : undefined,
	};
}

function parseStringRecord(raw: unknown, label: string): Record<string, string> {
	if (raw === undefined || raw === null) return {};
	if (!isRecord(raw)) throw new Error(`${label} 必须是 string→string 映射`);
	const record: Record<string, string> = {};
	for (const [key, value] of Object.entries(raw)) {
		if (typeof value !== "string") throw new Error(`${label}["${key}"] 必须是字符串`);
		record[key] = value;
	}
	return record;
}

function truncate(text: string, maxChars: number): string {
	const chars = [...text];
	if (chars.length <= maxChars) return text;
	return `${chars.slice(0, maxChars).join("")}…`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}
