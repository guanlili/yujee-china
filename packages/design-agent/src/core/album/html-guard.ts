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

/** 槽位级改字:直接替换 html 中 data-text-key 元素的内容(保留 AI 手工版面)。
 * 找不到锚点返回 null(调用方决定报错或重烘)。 */
export function patchHtmlText(html: string, slotId: string, value: string): string | null {
	const openRe = new RegExp(`<([a-z0-9]+)\\b[^>]*data-text-key="${slotId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>`, "i");
	const m = openRe.exec(html);
	if (!m) return null;
	const start = m.index + m[0].length;
	const end = html.indexOf(`</${m[1]}>`, start);
	if (end === -1) return null;
	return html.slice(0, start) + escapeHtmlText(value) + html.slice(end);
}
