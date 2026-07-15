import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 模板目录层：直接读 packages/contracts/templates/*.json —— 模板 JSON 是唯一输入。
 * 不 import contracts 的 TS 源码，保持本包可独立 tsgo 构建。
 *
 * 这里曾经还读 template-previews/manifest.json(烘焙产物)拿 slotIds 和
 * structureDescription。那是一份从模板 JSON 抄出来的副本:模板一改、忘了重烘,
 * catalog 就按过期的槽位清单干活(真出过:删掉的槽还在 manifest 里挂着)。
 * 所有字段本来就能从模板 JSON 当场推导,structureDescription 也在下面运行时生成
 * (还能带上 orientation/composition 配图提示,比烘焙版信息更多)。副本已废除。
 */

export interface CatalogTextSlotDef {
	id: string;
	role: string;
	lang?: string;
	hint?: string;
	sample?: string;
	variableDecor?: boolean;
	/** 来自 items 重复组的槽（寻址形如 `id[n]`）。 */
	repeat?: boolean;
}

export interface CatalogImageSlotDef {
	id: string;
	orientation?: string[];
	quality?: string[];
	composition?: string[];
}

export interface TemplateCatalogEntry {
	id: string;
	category: string;
	/** 具体图槽 id（如 `image`、items 重复槽保持 base id）。 */
	imageSlotIds: string[];
	/** 具体文字槽 id（base id;items 重复槽也在内,寻址时用 `id[n]`）。 */
	textSlotIds: string[];
	/** 变长重复文字槽的 base id（寻址形如 `title[n]`）。 */
	repeatTextSlotBases: string[];
	structureDescription?: string;
	imageSlots: CatalogImageSlotDef[];
	/** base id → 定义（含 items 内的重复槽定义）。 */
	textDefsByBase: Map<string, CatalogTextSlotDef>;
	/** SVG variableDecor 槽 id 集合：texts[slotId] 的值即章节色。 */
	svgSlotIds: Set<string>;
}

export interface TemplateCatalog {
	get(templateId: string): TemplateCatalogEntry | undefined;
	list(filter?: { category?: string; imageSlotCount?: number }): TemplateCatalogEntry[];
	ids(): string[];
}

export interface TemplateCatalogOptions {
	/** contracts 包根目录；默认按 monorepo 相对位置解析，可用 YUJEE_CONTRACTS_DIR 覆盖。 */
	contractsDir?: string;
	env?: Record<string, string | undefined>;
}

const moduleDir = dirname(fileURLToPath(import.meta.url));

export function defaultContractsDir(env: Record<string, string | undefined> = process.env): string {
	const fromEnv = env.YUJEE_CONTRACTS_DIR?.trim();
	if (fromEnv) return fromEnv;
	// src/core/album → design-agent 包根再上一层是 packages/。dist 构建后目录深度一致。
	return join(moduleDir, "..", "..", "..", "..", "contracts");
}

export function loadTemplateCatalog(options: TemplateCatalogOptions = {}): TemplateCatalog {
	const contractsDir = options.contractsDir ?? defaultContractsDir(options.env ?? process.env);
	const templatesDir = join(contractsDir, "templates");

	const entries = new Map<string, TemplateCatalogEntry>();

	for (const filename of readdirSync(templatesDir)) {
		if (!filename.endsWith(".json")) continue;
		const raw = JSON.parse(readFileSync(join(templatesDir, filename), "utf8")) as RawTemplate;
		if (!raw || typeof raw.id !== "string") continue;
		entries.set(raw.id, buildEntry(raw));
	}

	return {
		get(templateId: string): TemplateCatalogEntry | undefined {
			return entries.get(templateId);
		},
		list(filter?: { category?: string; imageSlotCount?: number }): TemplateCatalogEntry[] {
			const all = [...entries.values()].sort((a, b) => a.id.localeCompare(b.id));
			return all.filter((entry) => {
				if (filter?.category && entry.category !== filter.category) return false;
				if (filter?.imageSlotCount !== undefined && entry.imageSlotIds.length !== filter.imageSlotCount)
					return false;
				return true;
			});
		},
		ids(): string[] {
			return [...entries.keys()].sort();
		},
	};
}

/** 解析槽 id：`title[2]` → base `title`；`cells[0].image` → base `cells.image`（保守取非下标部分）。 */
export function slotBaseId(slotId: string): string {
	return slotId.replace(/\[\d+\]/g, "");
}

/** 主题 carrier 键（layout.ts theme-carrier 约定）：`slotId#accentColor` / `slotId#artFont`。 */
export const THEME_CARRIER_SUFFIXES = ["#accentColor", "#artFont"] as const;

export function parseThemeCarrierKey(key: string): { baseSlotId: string; suffix: string } | undefined {
	for (const suffix of THEME_CARRIER_SUFFIXES) {
		if (key.endsWith(suffix)) return { baseSlotId: key.slice(0, -suffix.length), suffix };
	}
	return undefined;
}

interface RawTemplateTextSlot {
	id: string;
	role?: string;
	lang?: string;
	hint?: string;
	sample?: string;
	variableDecor?: boolean;
}

interface RawTemplate {
	id: string;
	category?: string;
	images?: CatalogImageSlotDef[];
	texts?: RawTemplateTextSlot[];
	svgs?: { id: string; variableDecor?: boolean }[];
	items?: { texts?: RawTemplateTextSlot[]; images?: CatalogImageSlotDef[] };
}

/**
 * grid 模板(items.images 单个重复槽)每页固定装几张照片。与 engine
 * skeleton_v3._ITEMS_GRID_CAPACITY 同一产品常量;mag-10 的 HTML 也是固定 4 格。
 * items 图槽在页面上寻址为 `image[0..3]`,装书校验要求全部填充 —— 所以 catalog
 * 必须给出【展开后】的 id,不能只给 base(这不是从旧 manifest 抄来的,是算出来的)。
 */
const ITEMS_GRID_CAPACITY = 4;

/** 图槽的一句话描述,带配图提示 —— 选模板的模型靠它做朝向/构图匹配。 */
function describeImageSlot(slot: CatalogImageSlotDef): string {
	const traits = [...(slot.orientation ?? []), ...(slot.composition ?? [])];
	return traits.length > 0 ? `${slot.id}(${traits.join("/")})` : slot.id;
}

function describeStructure(raw: RawTemplate, imageSlots: CatalogImageSlotDef[], textSlotIds: string[]): string {
	const images =
		imageSlots.length > 0
			? `${imageSlots.length} image slot(s): ${imageSlots.map(describeImageSlot).join(", ")}`
			: "no image slots";
	const texts = textSlotIds.length > 0 ? `${textSlotIds.length} text slot(s): ${textSlotIds.join(", ")}` : "no text slots";
	return `${raw.id} ${raw.category ?? "interior"} template with ${images}; ${texts}.`;
}

function buildEntry(raw: RawTemplate): TemplateCatalogEntry {
	const textDefsByBase = new Map<string, CatalogTextSlotDef>();
	for (const slot of raw.texts ?? []) {
		if (slot?.id) textDefsByBase.set(slot.id, { ...slot, role: slot.role ?? "text" });
	}
	const repeatTextSlotBases: string[] = [];
	for (const slot of raw.items?.texts ?? []) {
		if (!slot?.id) continue;
		repeatTextSlotBases.push(slot.id);
		if (!textDefsByBase.has(slot.id)) {
			textDefsByBase.set(slot.id, { ...slot, role: slot.role ?? "text", repeat: true });
		}
	}

	const imageSlots = [...(raw.images ?? []), ...(raw.items?.images ?? [])].filter(
		(slot) => typeof slot?.id === "string",
	);
	const topImageIds = (raw.images ?? []).filter((s) => typeof s?.id === "string").map((s) => s.id);
	const itemImageIds = (raw.items?.images ?? [])
		.filter((s) => typeof s?.id === "string")
		.flatMap((s) => Array.from({ length: ITEMS_GRID_CAPACITY }, (_, i) => `${s.id}[${i}]`));
	const imageSlotIds = [...topImageIds, ...itemImageIds];
	const textSlotIds = [...textDefsByBase.keys()];

	return {
		id: raw.id,
		category: raw.category ?? "interior",
		imageSlotIds,
		textSlotIds,
		repeatTextSlotBases,
		structureDescription: describeStructure(raw, imageSlots, textSlotIds),
		imageSlots,
		textDefsByBase,
		svgSlotIds: new Set((raw.svgs ?? []).filter((svg) => svg?.variableDecor && svg.id).map((svg) => svg.id)),
	};
}
