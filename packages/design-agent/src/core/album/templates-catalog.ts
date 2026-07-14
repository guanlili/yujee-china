import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 模板目录层：直接读 packages/contracts/templates/*.json 与
 * template-previews/manifest.json（单一真相源，与 engine 的 Python loader 同策略）。
 * 不 import contracts 的 TS 源码，保持本包可独立 tsgo 构建。
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
	/** manifest 展开后的具体图槽 id（如 `image`、`image[0]`）。 */
	imageSlotIds: string[];
	/** manifest 展开后的具体文字槽 id。变长重复槽不在此列。 */
	textSlotIds: string[];
	/** 变长重复文字槽寻址模式（如 `title[n]`），按需超出 textSlotIds 使用。 */
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
	const manifestPath = join(contractsDir, "template-previews", "manifest.json");

	const manifestEntries = readManifestEntries(manifestPath);
	const entries = new Map<string, TemplateCatalogEntry>();

	for (const filename of readdirSync(templatesDir)) {
		if (!filename.endsWith(".json")) continue;
		const raw = JSON.parse(readFileSync(join(templatesDir, filename), "utf8")) as RawTemplate;
		if (!raw || typeof raw.id !== "string") continue;
		const manifest = manifestEntries.get(raw.id);
		entries.set(raw.id, buildEntry(raw, manifest));
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

interface ManifestTemplateEntry {
	templateId: string;
	category?: string;
	imageSlotIds?: string[];
	textSlotIds?: string[];
	repeatTextSlots?: { id: string; addressPattern?: string }[];
	structureDescription?: string;
}

function readManifestEntries(manifestPath: string): Map<string, ManifestTemplateEntry> {
	const map = new Map<string, ManifestTemplateEntry>();
	try {
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { templates?: ManifestTemplateEntry[] };
		for (const entry of manifest.templates ?? []) {
			if (entry?.templateId) map.set(entry.templateId, entry);
		}
	} catch {
		// manifest 缺失时退化为仅模板 JSON（structureDescription 与展开槽位为空）。
	}
	return map;
}

function buildEntry(raw: RawTemplate, manifest: ManifestTemplateEntry | undefined): TemplateCatalogEntry {
	const textDefsByBase = new Map<string, CatalogTextSlotDef>();
	for (const slot of raw.texts ?? []) {
		if (slot?.id) textDefsByBase.set(slot.id, { ...slot, role: slot.role ?? "text" });
	}
	for (const slot of raw.items?.texts ?? []) {
		if (slot?.id && !textDefsByBase.has(slot.id)) {
			textDefsByBase.set(slot.id, { ...slot, role: slot.role ?? "text", repeat: true });
		}
	}

	const imageSlots = [...(raw.images ?? []), ...(raw.items?.images ?? [])].filter(
		(slot) => typeof slot?.id === "string",
	);
	const imageSlotIds =
		manifest?.imageSlotIds && manifest.imageSlotIds.length > 0
			? [...manifest.imageSlotIds]
			: imageSlots.map((slot) => slot.id);
	const textSlotIds =
		manifest?.textSlotIds && manifest.textSlotIds.length > 0
			? [...manifest.textSlotIds]
			: [...textDefsByBase.keys()];

	return {
		id: raw.id,
		category: raw.category ?? manifest?.category ?? "interior",
		imageSlotIds,
		textSlotIds,
		repeatTextSlotBases: (manifest?.repeatTextSlots ?? []).map((slot) => slot.id).filter(Boolean),
		structureDescription: manifest?.structureDescription,
		imageSlots,
		textDefsByBase,
		svgSlotIds: new Set((raw.svgs ?? []).filter((svg) => svg?.variableDecor && svg.id).map((svg) => svg.id)),
	};
}
