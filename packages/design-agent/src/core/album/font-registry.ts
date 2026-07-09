/**
 * 相册艺术字字体库（B1 定稿，用户 2026-07 拍板）。
 *
 * 每个字体一个稳定 id（= contracts `ArtFontPack` 的成员、web `theme-carrier` 映射键、
 * 写进 `${slot}#artFont` carrier 的值）。设计 Agent 不 import contracts TS（会破坏
 * tsgo 构建），故这份 id 清单与 contracts `enums.ts` / web `theme-carrier.ts` **手工对齐**
 * ——三处新增/删除字体必须同步。
 *
 * `roles`：这款字体适合出现在哪些角色（标题/正文/装饰）。`set_text_fonts` 按角色过滤，
 * 选错角色（如草书用作正文）直接打回——"选错自动挡"。
 */

export type FontRole = "title" | "body" | "decoration";
export type FontLang = "zh" | "en";

export interface FontEntry {
	id: string;
	/** 中文名（zh）或展示名（en），仅用于工具汇报/技能说明。 */
	label: string;
	lang: FontLang;
	roles: readonly FontRole[];
}

/** 中文 9 款（去掉 马善政楷书 / 站酷快乐体）。 */
const ZH_FONTS: readonly FontEntry[] = [
	{ id: "noto-serif-sc", label: "思源宋体", lang: "zh", roles: ["body", "title", "decoration"] },
	{ id: "noto-sans-sc", label: "思源黑体", lang: "zh", roles: ["body"] },
	{ id: "zcool-xiaowei", label: "站酷小薇", lang: "zh", roles: ["body", "title"] },
	{ id: "lxgw-wenkai", label: "霞鹜文楷", lang: "zh", roles: ["body", "title", "decoration"] },
	{ id: "smiley-sans", label: "得意黑", lang: "zh", roles: ["title"] },
	{ id: "zcool-qingke-huangyou", label: "站酷庆科黄油体", lang: "zh", roles: ["title"] },
	{ id: "long-cang", label: "龙藏体", lang: "zh", roles: ["title", "decoration"] },
	{ id: "zhi-mang-xing", label: "志莽行书", lang: "zh", roles: ["title", "decoration"] },
	{ id: "liu-jian-mao-cao", label: "柳建毛草", lang: "zh", roles: ["title", "decoration"] },
];

/** 英文（全留）。 */
const EN_FONTS: readonly FontEntry[] = [
	// 正文
	{ id: "eb-garamond", label: "EB Garamond", lang: "en", roles: ["body"] },
	{ id: "source-serif-4", label: "Source Serif 4", lang: "en", roles: ["body"] },
	{ id: "lora", label: "Lora", lang: "en", roles: ["body"] },
	{ id: "libre-baskerville", label: "Libre Baskerville", lang: "en", roles: ["body"] },
	{ id: "inter", label: "Inter", lang: "en", roles: ["body"] },
	{ id: "work-sans", label: "Work Sans", lang: "en", roles: ["body"] },
	{ id: "dm-sans", label: "DM Sans", lang: "en", roles: ["body"] },
	{ id: "poppins", label: "Poppins", lang: "en", roles: ["body"] },
	{ id: "raleway", label: "Raleway", lang: "en", roles: ["body"] },
	// 标题
	{ id: "playfair-display", label: "Playfair Display", lang: "en", roles: ["title"] },
	{ id: "cormorant-garamond", label: "Cormorant Garamond", lang: "en", roles: ["title"] },
	{ id: "bebas-neue", label: "Bebas Neue", lang: "en", roles: ["title"] },
	{ id: "archivo-black", label: "Archivo Black", lang: "en", roles: ["title"] },
	{ id: "abril-fatface", label: "Abril Fatface", lang: "en", roles: ["title"] },
	{ id: "montserrat", label: "Montserrat", lang: "en", roles: ["title", "body"] },
	// 装饰
	{ id: "ibm-plex-mono", label: "IBM Plex Mono", lang: "en", roles: ["decoration"] },
	{ id: "jetbrains-mono", label: "JetBrains Mono", lang: "en", roles: ["decoration"] },
	{ id: "great-vibes", label: "Great Vibes", lang: "en", roles: ["decoration"] },
	{ id: "dancing-script", label: "Dancing Script", lang: "en", roles: ["decoration"] },
	{ id: "sacramento", label: "Sacramento", lang: "en", roles: ["decoration"] },
	{ id: "parisienne", label: "Parisienne", lang: "en", roles: ["decoration"] },
];

export const FONT_REGISTRY: readonly FontEntry[] = [...ZH_FONTS, ...EN_FONTS];

const FONT_BY_ID = new Map<string, FontEntry>(FONT_REGISTRY.map((f) => [f.id, f]));

export function getFontEntry(id: string): FontEntry | undefined {
	return FONT_BY_ID.get(id);
}

/** 某角色下所有合法字体 id（供工具校验与技能菜单）。 */
export function fontsForRole(role: FontRole): FontEntry[] {
	return FONT_REGISTRY.filter((f) => f.roles.includes(role));
}

/** 该字体 id 是否可用于该角色。 */
export function fontAllowsRole(id: string, role: FontRole): boolean {
	return FONT_BY_ID.get(id)?.roles.includes(role) ?? false;
}
