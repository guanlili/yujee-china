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

export interface AlbumBookState {
	chapters: AlbumChapter[];
	pages: AlbumPage[];
	version: number;
	updatedAt: string;
}

export interface AlbumBookSummary {
	version: number;
	updatedAt: string;
	chapterCount: number;
	pageCount: number;
	chapters: {
		chapterId: string;
		photoCount: number;
		accentColor?: string | null;
		contextPreview?: string;
	}[];
	pages: {
		/** 页码（从 1 开始，第 1 页 = 第一页）——工具寻址与对用户口径统一用它，全书唯一。 */
		pageNo: number;
		/** 管线产出的原始 pageIndex（按章节计数，从 0 起、可能重复），仅作数据保留。 */
		pageIndex: number;
		templateId: string;
		category: string;
		chapterId?: string;
		imageCount: number;
		filledTextSlots: number;
		totalTextSlots: number;
	}[];
}

export function cloneAlbumBookState(state: AlbumBookState): AlbumBookState {
	return {
		chapters: state.chapters.map((chapter) => ({ ...chapter, photos: chapter.photos.map((photo) => ({ ...photo })) })),
		pages: state.pages.map(clonePage),
		version: state.version,
		updatedAt: state.updatedAt,
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

	return {
		book: {
			chapters,
			pages,
			version: typeof raw.version === "number" ? raw.version : 1,
			updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : now.toISOString(),
		},
		warnings,
	};
}

export function summarizeAlbumBook(state: AlbumBookState, catalog: TemplateCatalog): AlbumBookSummary {
	const photoToChapter = buildPhotoToChapterMap(state);
	return {
		version: state.version,
		updatedAt: state.updatedAt,
		chapterCount: state.chapters.length,
		pageCount: state.pages.length,
		chapters: state.chapters.map((chapter) => ({
			chapterId: chapter.chapterId,
			photoCount: chapter.photos.length,
			accentColor: chapter.accentColor,
			contextPreview: chapter.chapterContext ? truncate(chapter.chapterContext, 60) : undefined,
		})),
		pages: state.pages.map((page, index) => {
			const template = catalog.get(page.templateId);
			const concreteTextSlots = template?.textSlotIds ?? [];
			const filledTextSlots = concreteTextSlots.filter((slotId) => (page.texts[slotId] ?? "").trim().length > 0);
			return {
				pageNo: index + 1, // 1 起，与用户口径一致
				pageIndex: page.pageIndex,
				templateId: page.templateId,
				category: template?.category ?? "unknown",
				chapterId: derivePageChapterId(page, photoToChapter),
				imageCount: Object.keys(page.images).length,
				filledTextSlots: filledTextSlots.length,
				totalTextSlots: concreteTextSlots.length,
			};
		}),
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
		if (def.maxChars !== undefined) {
			const charCount = [...value].length;
			if (charCount > def.maxChars) {
				errors.push(
					`槽 "${key}" 超出字数限制：${charCount} > maxChars ${def.maxChars}（${def.role}）。请精简后重试。`,
				);
			}
		}
	}
	return errors;
}

/** 校验整页图片槽映射是否对模板合法（槽位齐全、不重复、照片存在）。 */
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
	for (const slotId of template.imageSlotIds) {
		if (!(slotId in images)) errors.push(`缺少图片槽 "${slotId}"（模板 ${template.id} 的所有图槽都必须填充）`);
	}
	const usedPhotos = new Map<string, string>();
	for (const [slotId, photoId] of Object.entries(images)) {
		if (typeof photoId !== "string" || photoId.length === 0) {
			errors.push(`图片槽 "${slotId}" 的 photoId 必须是非空字符串`);
			continue;
		}
		if (!findAlbumPhoto(state, photoId)) errors.push(`photoId "${photoId}" 不存在于这本书的任何章节`);
		const existingSlot = usedPhotos.get(photoId);
		if (existingSlot) errors.push(`photoId "${photoId}" 同时出现在槽 "${existingSlot}" 和 "${slotId}"`);
		usedPhotos.set(photoId, slotId);
	}
	return errors;
}

/** 装书容错：把超出模板 maxChars 的文字槽截到上限（按 Unicode 字符），返回警告。
 * 上游文案是 AI 自然成文、不硬截断，落库可能超限；装书时截断降级而不是把整本书
 * 挡在设计对话外。只动超限文本；结构性错误（未知模板/缺图槽）留给 validateAlbumBook 硬失败。 */
export function clampOverLimitTexts(state: AlbumBookState, catalog: TemplateCatalog): string[] {
	const notes: string[] = [];
	for (const page of state.pages) {
		const template = catalog.get(page.templateId);
		if (!template) continue;
		for (const [key, value] of Object.entries(page.texts)) {
			if (typeof value !== "string") continue;
			if (parseThemeCarrierKey(key)) continue;
			const def = template.textDefsByBase.get(slotBaseId(key));
			if (!def || def.maxChars === undefined) continue;
			const chars = [...value];
			if (chars.length <= def.maxChars) continue;
			page.texts[key] = chars.slice(0, def.maxChars).join("");
			notes.push(
				`第 ${page.pageIndex} 页：槽 "${key}" 超出 maxChars ${def.maxChars}（实际 ${chars.length}），装书时已截断`,
			);
		}
	}
	return notes;
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
