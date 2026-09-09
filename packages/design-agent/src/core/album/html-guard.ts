// write_page_html 的守门与 texts 派生(C 方案:页面真相 = HTML)。
// 纯字符串/正则实现,无 DOM 依赖 —— node 测试与 server 端同构可用。
//
// 设计约定(见仓根 HTML-PAGES-C-DESIGN.md §2):AI 可以自由改版面(挪位置、
// 改样式、增删装饰、改文字),但:
//   ① 原页的 data-text-key / data-image-slot 锚点一个不能丢;
//   ② 图片 src 必须保持 `{{IMG_SRC:slotId}}` token(真实 src 渲染时才解析);
//   ③ 禁 <script|iframe|object|embed>、on* 事件属性、javascript:、http(s) 外链 src;
//   ④ 根节点唯一且 data-template 与页面 templateId 一致;
//   ⑤ 整页 ≤ 64KB。

const MAX_PAGE_HTML_CHARS = 65536;

const TEXT_KEY_RE = /data-text-key="([^"]+)"/g;
const IMAGE_SLOT_RE = /data-image-slot="([^"]+)"/g;

function collect(re: RegExp, html: string): Set<string> {
	const out = new Set<string>();
	for (const m of html.matchAll(re)) out.add(m[1]!);
	return out;
}

export function validatePageHtml(prevHtml: string, nextHtml: string, templateId: string): string[] {
	const errors: string[] = [];
	const html = nextHtml.trim();

	if (html.length > MAX_PAGE_HTML_CHARS) {
		errors.push(`页面 HTML ${html.length} 字符,超过 ${MAX_PAGE_HTML_CHARS} 上限。请精简后重试。`);
	}
	if (!new RegExp(`^<div[^>]*data-template="${templateId}"`).test(html)) {
		errors.push(`根节点必须是带 data-template="${templateId}" 的 <div>(模板身份不可改;换排版请用 swap_page_template)。`);
	}
	if ((html.match(/data-template="/g) ?? []).length !== 1) {
		errors.push(`data-template 必须恰好出现一次(单根页面)。`);
	}

	// —— 安全黑名单 ——
	if (/<\s*(script|iframe|object|embed|link|meta)\b/i.test(html)) {
		errors.push("禁止 <script>/<iframe>/<object>/<embed>/<link>/<meta> 标签。");
	}
	if (/\son[a-z]+\s*=/i.test(html)) {
		errors.push("禁止 on* 事件属性(onclick/onerror 等)。");
	}
	if (/javascript:/i.test(html)) {
		errors.push("禁止 javascript: 协议。");
	}
	if (/\s(?:src|href)\s*=\s*"(?:https?:)?\/\//i.test(html)) {
		errors.push("禁止外链 src/href(图片一律用 {{IMG_SRC:slotId}} token,渲染时解析)。");
	}

	// —— 锚点保全 ——
	const prevTexts = collect(TEXT_KEY_RE, prevHtml);
	const nextTexts = collect(TEXT_KEY_RE, html);
	for (const key of prevTexts) {
		if (!nextTexts.has(key)) errors.push(`文字锚点 data-text-key="${key}" 丢失 —— 可以挪/改样式,不能删。`);
	}
	const prevSlots = collect(IMAGE_SLOT_RE, prevHtml);
	const nextSlots = collect(IMAGE_SLOT_RE, html);
	for (const slot of prevSlots) {
		if (!nextSlots.has(slot)) {
			errors.push(`图片锚点 data-image-slot="${slot}" 丢失 —— 可以挪/改样式,不能删。`);
			continue;
		}
		if (!html.includes(`{{IMG_SRC:${slot}}}`)) {
			errors.push(`图槽 ${slot} 的 src 必须保持 {{IMG_SRC:${slot}}} token(真实 src 由渲染端解析)。`);
		}
	}

	return errors;
}

function unescapeHtml(value: string): string {
	return value
		.replace(/<br\s*\/?>(\n)?/gi, "\n")
		.replace(/<[^>]+>/g, "")
		.replace(/&quot;/g, '"')
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&amp;/g, "&");
}

/** 从页面 HTML 的 data-text-key 元素提取文字(texts 派生缓存:装书校验/搜索用)。
 * 元素内容按"到最近的同名闭合标签"截取 —— 模板文字槽都是叶级元素,内嵌只有
 * <span>/<br> 级装饰,不存在同名标签嵌套。 */
export function derivePageTexts(html: string): Record<string, string> {
	const out: Record<string, string> = {};
	const openRe = /<([a-z0-9]+)\b[^>]*data-text-key="([^"]+)"[^>]*>/gi;
	for (const m of html.matchAll(openRe)) {
		const [full, tag, key] = m as unknown as [string, string, string];
		const start = m.index! + full.length;
		const close = `</${tag}>`;
		const end = html.indexOf(close, start);
		if (end === -1) continue;
		out[key!] = unescapeHtml(html.slice(start, end)).trim();
	}
	return out;
}

function escapeHtmlText(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 含换行的文案要在槽元素上补 white-space:pre-wrap —— 文本节点里的 \n 默认被
 * HTML 渲染折叠成空格。追加在 style 末尾(CSS 后声明胜出,模板自带的 nowrap 等
 * 被用户的换行意图覆盖);已有 pre-wrap 则不重复追加。 */
function withPreWrap(openTag: string): string {
	const styleMatch = /style="([^"]*)"/.exec(openTag);
	if (!styleMatch) return openTag.replace(/>$/, ' style="white-space:pre-wrap">');
	if (/white-space\s*:\s*pre-wrap/i.test(styleMatch[1]!)) return openTag;
	const sep = styleMatch[1] === "" || styleMatch[1]!.endsWith(";") ? "" : ";";
	return openTag.replace(styleMatch[0], `style="${styleMatch[1]}${sep}white-space:pre-wrap"`);
}

/** 槽位级改字:直接替换 html 中 data-text-key 元素的内容(保留 AI 手工版面)。
 * 找不到锚点返回 null(调用方决定报错或重烘)。换行支持与 web page-html-dom 的
 * 同名实现保持同步。 */
export function patchHtmlText(html: string, slotId: string, value: string): string | null {
	const openRe = new RegExp(`<([a-z0-9]+)\\b[^>]*data-text-key="${slotId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>`, "i");
	const m = openRe.exec(html);
	if (!m) return null;
	const start = m.index + m[0].length;
	const end = html.indexOf(`</${m[1]}>`, start);
	if (end === -1) return null;
	const openTag = /[\r\n]/.test(value) ? withPreWrap(m[0]) : m[0];
	return html.slice(0, m.index) + openTag + escapeHtmlText(value) + html.slice(end);
}

// ── 图片位置的槽位级 patch ───────────────────────────────────────────────
// 页面真相是 html,而 object-position / transform 是**烘进 html 的**(fill-template
// 的 IMG_POS / IMG_TF token)。所以 set_image_pos 只改 page.imagePos 是不够的 ——
// 存库 html 优先于即时渲染(web preferredPageHtml),画板上照片会纹丝不动。
//
// ⚠️ 与 web `components/album/page-html-dom.patchHtmlImagePos` 是同名对偶实现,
// 改一边要同步另一边。**本实现只覆盖无旋转分支** —— 旋转要做「盒交换」
// (90/270 时把 img 盒换成图框转置尺寸),那套几何留在 web 侧;design-agent 的
// set_image_pos 对旋转过的槽直接拒绝,不去动它(rotate 本批明确不动)。

const STYLE_ATTR_RE = /style="([^"]*)"/i;

/** 行内 style 的声明级 upsert:值为 null = 删除该声明。保留其余声明与顺序。 */
function upsertStyleAttr(openTag: string, patch: Record<string, string | null>): string {
	const match = STYLE_ATTR_RE.exec(openTag);
	const declarations: Array<[string, string]> = [];
	if (match) {
		for (const part of match[1]!.split(";")) {
			const index = part.indexOf(":");
			if (index === -1) continue;
			const key = part.slice(0, index).trim();
			if (key) declarations.push([key, part.slice(index + 1).trim()]);
		}
	}
	for (const [key, value] of Object.entries(patch)) {
		const at = declarations.findIndex(([name]) => name.toLowerCase() === key.toLowerCase());
		if (value === null) {
			if (at !== -1) declarations.splice(at, 1);
		} else if (at === -1) {
			declarations.push([key, value]);
		} else {
			declarations[at] = [key, value];
		}
	}
	const style = declarations.map(([key, value]) => `${key}:${value}`).join(";");
	const styleAttr = style ? `${style};` : "";
	if (match) return openTag.replace(match[0], `style="${styleAttr}"`);
	return openTag.replace(/\s*\/?>$/, (tail) => ` style="${styleAttr}"${tail.trimStart()}`);
}

/** 槽位级改图片位置:替换 html 中 data-image-slot 那个 <img> 的行内定位样式。
 * 找不到锚点返回 null(调用方决定报错还是放弃)。 */
export function patchHtmlImagePos(
	html: string,
	slotId: string,
	pos: { x: number; y: number; scale: number },
): string | null {
	const escapedSlot = slotId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const openRe = new RegExp(`<img\\b[^>]*data-image-slot="${escapedSlot}"[^>]*>`, "i");
	const match = openRe.exec(html);
	if (!match) return null;
	const patched = upsertStyleAttr(match[0], {
		"object-position": `${pos.x}% ${pos.y}%`,
		// scale 回到 1 时要把 transform 删干净,否则上一次放大会留成残影。
		transform: pos.scale > 1 ? `scale(${pos.scale})` : null,
		"transform-origin": pos.scale > 1 ? `${pos.x}% ${pos.y}%` : null,
	});
	return html.slice(0, match.index) + patched + html.slice(match.index + match[0].length);
}
