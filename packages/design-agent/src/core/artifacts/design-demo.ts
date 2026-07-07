export type DesignDemoTheme = "clean" | "premium" | "dark";

export interface DesignDemoState {
	title: string;
	body: string;
	buttonLabel: string;
	theme: DesignDemoTheme;
	artifactHtml?: string;
	version: number;
	updatedAt: string;
}

export interface DesignDemoResult {
	state: DesignDemoState;
	html: string;
	assistantText: string;
	operations: string[];
}

export interface DesignArtifactSectionSummary {
	id: string;
	tagName: string;
	heading?: string;
	textPreview: string;
	start: number;
	length: number;
	htmlLength: number;
}

export interface DesignArtifactSummary {
	kind: "html";
	htmlLength: number;
	sections: DesignArtifactSectionSummary[];
}

export interface DesignDemoStateSummary {
	title: string;
	body: string;
	buttonLabel: string;
	theme: DesignDemoTheme;
	version: number;
	updatedAt: string;
	artifactSummary?: DesignArtifactSummary;
}

export interface DesignTaskArtifactSectionIndex {
	id: string;
	tagName: string;
	heading?: string;
	start: number;
	length: number;
}

export interface DesignTaskContextSummary {
	version: number;
	artifact: {
		kind: "html";
		htmlLength: number;
		sections: DesignTaskArtifactSectionIndex[];
	};
}

interface DesignDemoPatch {
	title?: string;
	body?: string;
	buttonLabel?: string;
	theme?: DesignDemoTheme;
}

interface DesignModelPayload {
	reply?: string;
	patch?: DesignDemoPatch;
	artifactHtml?: string;
}

interface ThemeTokens {
	pageBackground: string;
	sectionBackground: string;
	textColor: string;
	mutedColor: string;
	accentColor: string;
	accentTextColor: string;
	borderColor: string;
	shadowColor: string;
}

export function createInitialDesignDemoState(now = new Date()): DesignDemoState {
	return {
		title: "设计工作室",
		body: "把想法整理成一个清晰、可展示、可继续迭代的页面。",
		buttonLabel: "开始设计",
		theme: "clean",
		version: 1,
		updatedAt: now.toISOString(),
	};
}

export function cloneDesignDemoState(state: DesignDemoState): DesignDemoState {
	return { ...state };
}

export function summarizeDesignDemoState(state: DesignDemoState): DesignDemoStateSummary {
	const summary: DesignDemoStateSummary = {
		title: state.title,
		body: state.body,
		buttonLabel: state.buttonLabel,
		theme: state.theme,
		version: state.version,
		updatedAt: state.updatedAt,
	};
	if (state.artifactHtml) {
		summary.artifactSummary = summarizeHtmlArtifact(state.artifactHtml);
	}
	return summary;
}

export function summarizeDesignTaskContext(state: DesignDemoState): DesignTaskContextSummary {
	const artifact = summarizeHtmlArtifact(renderDesignPreviewHtml(state));
	return {
		version: state.version,
		artifact: {
			kind: artifact.kind,
			htmlLength: artifact.htmlLength,
			sections: artifact.sections.map(({ id, tagName, heading, start, length }) => ({
				id,
				tagName,
				heading,
				start,
				length,
			})),
		},
	};
}

export function createMockDesignModelOutput(current: DesignDemoState, prompt: string): string {
	const patch = extractDesignPatchFromText(prompt);
	const operations = operationsForPatch(current, patch);
	const preview = applyPatch(current, patch, undefined, new Date());
	const reply = createAssistantText(prompt, operations, preview.state);
	return JSON.stringify({ reply, patch } satisfies DesignModelPayload, null, 2);
}

export function applyDesignModelOutput(
	current: DesignDemoState,
	modelOutput: string,
	now = new Date(),
): DesignDemoResult {
	const payload = parseDesignModelPayload(modelOutput);
	const patch = payload.patch ?? {};
	const result = applyPatch(current, patch, payload.artifactHtml, now);
	return {
		...result,
		assistantText: payload.reply?.trim() || modelOutput.trim() || "模型没有返回可展示内容。",
	};
}

export function createNoChangeDesignResult(current: DesignDemoState, assistantText: string): DesignDemoResult {
	return {
		state: cloneDesignDemoState(current),
		html: renderDesignPreviewHtml(current),
		assistantText,
		operations: [],
	};
}

function applyPatch(
	current: DesignDemoState,
	patch: DesignDemoPatch,
	artifactHtml?: string,
	now = new Date(),
): DesignDemoResult {
	const operations: string[] = [];
	const next: DesignDemoState = { ...current };
	let hasConfigChange = false;
	if (patch.title && patch.title !== current.title) {
		next.title = patch.title;
		operations.push("title");
		hasConfigChange = true;
	}
	if (patch.body && patch.body !== current.body) {
		next.body = patch.body;
		operations.push("body");
		hasConfigChange = true;
	}
	if (patch.buttonLabel && patch.buttonLabel !== current.buttonLabel) {
		next.buttonLabel = patch.buttonLabel;
		operations.push("button");
		hasConfigChange = true;
	}
	if (patch.theme && patch.theme !== current.theme) {
		next.theme = patch.theme;
		operations.push("theme");
		hasConfigChange = true;
	}

	if (artifactHtml && artifactHtml !== current.artifactHtml) {
		next.artifactHtml = artifactHtml;
		operations.push("artifact");
	} else if (hasConfigChange && current.artifactHtml) {
		delete next.artifactHtml;
	}

	if (operations.length > 0) {
		next.version += 1;
		next.updatedAt = now.toISOString();
	}

	const html = renderDesignPreviewHtml(next);
	return {
		state: cloneDesignDemoState(next),
		html,
		assistantText: "",
		operations,
	};
}

export function renderDesignPreviewHtml(state: DesignDemoState): string {
	if (state.artifactHtml) return state.artifactHtml;

	const tokens = themeTokens(state.theme);
	const title = escapeHtml(state.title);
	const body = escapeHtml(state.body);
	const buttonLabel = escapeHtml(state.buttonLabel);
	return `<!doctype html>
<html lang="zh-CN">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>${title}</title>
		<style>
			:root {
				color-scheme: light;
				font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
				background: ${tokens.pageBackground};
				color: ${tokens.textColor};
			}
			* {
				box-sizing: border-box;
			}
			body {
				margin: 0;
				min-height: 100vh;
				display: grid;
				place-items: center;
				padding: 28px;
				background: ${tokens.pageBackground};
			}
			main {
				width: min(920px, 100%);
				min-height: 540px;
				display: grid;
				align-content: center;
				gap: 28px;
				padding: clamp(28px, 6vw, 72px);
				border: 1px solid ${tokens.borderColor};
				border-radius: 8px;
				background: ${tokens.sectionBackground};
				box-shadow: 0 26px 80px ${tokens.shadowColor};
			}
			.kicker {
				margin: 0;
				color: ${tokens.accentColor};
				font-size: 13px;
				font-weight: 700;
				text-transform: uppercase;
				letter-spacing: 0;
			}
			h1 {
				max-width: 760px;
				margin: 0;
				font-size: clamp(42px, 8vw, 88px);
				line-height: 0.95;
				letter-spacing: 0;
			}
			p {
				max-width: 640px;
				margin: 0;
				color: ${tokens.mutedColor};
				font-size: clamp(17px, 2.4vw, 24px);
				line-height: 1.45;
			}
			a {
				width: fit-content;
				display: inline-flex;
				align-items: center;
				justify-content: center;
				min-height: 46px;
				padding: 0 18px;
				border-radius: 8px;
				background: ${tokens.accentColor};
				color: ${tokens.accentTextColor};
				text-decoration: none;
				font-weight: 700;
			}
			.meta {
				color: ${tokens.mutedColor};
				font-size: 12px;
			}
		</style>
	</head>
	<body>
		<main>
			<p class="kicker">设计预览</p>
			<h1>${title}</h1>
			<p>${body}</p>
			<a href="#">${buttonLabel}</a>
			<div class="meta">版本 ${state.version}</div>
		</main>
	</body>
</html>`;
}

function extractDesignValue(prompt: string, patterns: RegExp[]): string | undefined {
	for (const pattern of patterns) {
		const match = pattern.exec(prompt);
		const value = match?.[1]?.trim();
		if (value) return trimQuotes(value);
	}
	return undefined;
}

function extractDesignPatchFromText(prompt: string): DesignDemoPatch {
	const title = extractDesignValue(prompt, [
		/(?:标题|主标题|headline|title)\s*(?:改成|叫|是|为|成|:|：)\s*([^，。,.；;\n]+)/i,
	]);
	const body = extractDesignValue(prompt, [
		/(?:正文|文案|副标题|说明|body|copy)\s*(?:改成|叫|是|为|成|:|：)\s*([^，。,.；;\n]+)/i,
	]);
	const buttonLabel = extractDesignValue(prompt, [
		/(?:按钮|行动按钮|button|cta)\s*(?:叫|改成|是|为|成|:|：)\s*([^，。,.；;\n]+)/i,
	]);
	const theme = extractTheme(prompt);
	return normalizePatch({ title, body, buttonLabel, theme });
}

function parseDesignModelPayload(modelOutput: string): DesignModelPayload {
	const json = extractJsonObject(modelOutput);
	const artifactHtml = extractHtmlArtifact(modelOutput);
	if (!json) return { reply: stripHtmlArtifact(modelOutput, artifactHtml), patch: {}, artifactHtml };
	try {
		const parsed = JSON.parse(json) as {
			reply?: unknown;
			patch?: unknown;
			artifactHtml?: unknown;
			html?: unknown;
			artifact?: unknown;
		};
		return {
			reply: typeof parsed.reply === "string" ? parsed.reply : undefined,
			patch: normalizePatch(isRecord(parsed.patch) ? parsed.patch : {}),
			artifactHtml:
				readArtifactHtml(parsed.artifactHtml) ?? readArtifactHtml(parsed.html) ?? readArtifactHtml(parsed.artifact),
		};
	} catch {
		return { reply: stripHtmlArtifact(modelOutput, artifactHtml), patch: {}, artifactHtml };
	}
}

function extractJsonObject(text: string): string | undefined {
	const trimmed = text
		.trim()
		.replace(/^```(?:json)?\s*/i, "")
		.replace(/\s*```$/i, "");
	const start = trimmed.indexOf("{");
	const end = trimmed.lastIndexOf("}");
	if (start < 0 || end <= start) return undefined;
	return trimmed.slice(start, end + 1);
}

function normalizePatch(input: Record<string, unknown>): DesignDemoPatch {
	const patch: DesignDemoPatch = {};
	const title = readNonEmptyString(input.title);
	const body = readNonEmptyString(input.body);
	const buttonLabel = readNonEmptyString(input.buttonLabel);
	const theme = readTheme(input.theme);
	if (title) patch.title = title;
	if (body) patch.body = body;
	if (buttonLabel) patch.buttonLabel = buttonLabel;
	if (theme) patch.theme = theme;
	return patch;
}

function operationsForPatch(current: DesignDemoState, patch: DesignDemoPatch): string[] {
	return applyPatch(current, patch).operations;
}

function extractHtmlArtifact(text: string): string | undefined {
	const artifactMatch = /<artifact\b[^>]*type=["']html["'][^>]*>([\s\S]*?)<\/artifact>/i.exec(text);
	const fallbackArtifactMatch = /<artifact\b[^>]*>([\s\S]*?)<\/artifact>/i.exec(text);
	const taggedArtifact = normalizeArtifactHtml(artifactMatch?.[1] ?? fallbackArtifactMatch?.[1]);
	if (taggedArtifact) return taggedArtifact;

	const fencedHtml = normalizeArtifactHtml(/```html\s*([\s\S]*?)```/i.exec(text)?.[1]);
	if (fencedHtml) return fencedHtml;

	return extractStandaloneHtml(text);
}

function extractStandaloneHtml(text: string): string | undefined {
	const lowerText = text.toLowerCase();
	const doctypeIndex = lowerText.indexOf("<!doctype html");
	const htmlIndex = lowerText.indexOf("<html");
	const start = doctypeIndex >= 0 ? doctypeIndex : htmlIndex;
	if (start < 0) return undefined;

	const closeIndex = lowerText.lastIndexOf("</html>");
	const end = closeIndex >= start ? closeIndex + "</html>".length : text.length;
	return normalizeArtifactHtml(text.slice(start, end));
}

function stripHtmlArtifact(text: string, artifactHtml: string | undefined): string {
	const withoutTaggedArtifacts = text
		.replace(/<artifact\b[^>]*>[\s\S]*?<\/artifact>/gi, "")
		.replace(/```html\s*[\s\S]*?```/gi, "")
		.trim();
	if (!artifactHtml) return withoutTaggedArtifacts;
	return withoutTaggedArtifacts.replace(artifactHtml, "").trim();
}

function readArtifactHtml(value: unknown): string | undefined {
	if (typeof value === "string") return normalizeArtifactHtml(value);
	if (!isRecord(value)) return undefined;
	const kind = typeof value.kind === "string" ? value.kind : value.type;
	if (kind !== "html") return undefined;
	return normalizeArtifactHtml(readNonEmptyString(value.content));
}

function normalizeArtifactHtml(value: string | undefined): string | undefined {
	const html = value?.trim();
	if (!html || !looksLikeHtml(html)) return undefined;
	return html;
}

function looksLikeHtml(value: string): boolean {
	return /<!doctype html|<html\b|<body\b|<main\b|<section\b|<div\b/i.test(value);
}

function summarizeHtmlArtifact(html: string): DesignArtifactSummary {
	return {
		kind: "html",
		htmlLength: html.length,
		sections: extractArtifactSections(html),
	};
}

function extractArtifactSections(html: string): DesignArtifactSectionSummary[] {
	const sections = collectArtifactSections(html, /<(section)\b([^>]*)>([\s\S]*?)<\/\1>/gi);
	if (sections.length > 0) return sections;

	const fallbackSections = collectArtifactSections(
		html,
		/<(main|header|footer|nav|article|div)\b([^>]*)>([\s\S]*?)<\/\1>/gi,
	);
	if (fallbackSections.length > 0) return fallbackSections;

	return [
		{
			id: "document",
			tagName: "html",
			heading: extractFirstHeading(html),
			textPreview: htmlToText(html).slice(0, 220),
			start: 0,
			length: html.length,
			htmlLength: html.length,
		},
	];
}

function collectArtifactSections(html: string, sectionPattern: RegExp): DesignArtifactSectionSummary[] {
	const sections: DesignArtifactSectionSummary[] = [];
	let match = sectionPattern.exec(html);
	while (match && sections.length < 12) {
		const tagName = match[1]?.toLowerCase() ?? "section";
		const attrs = match[2] ?? "";
		const innerHtml = match[3] ?? "";
		const rawHtml = match[0] ?? "";
		const id =
			readHtmlAttribute(attrs, "id") ??
			readHtmlAttribute(attrs, "data-section") ??
			`${tagName}-${sections.length + 1}`;
		const text = htmlToText(innerHtml);
		sections.push({
			id,
			tagName,
			heading: extractFirstHeading(innerHtml),
			textPreview: text.slice(0, 220),
			start: match.index,
			length: rawHtml.length,
			htmlLength: rawHtml.length,
		});
		match = sectionPattern.exec(html);
	}
	return sections;
}

function readHtmlAttribute(attrs: string, name: string): string | undefined {
	const pattern = new RegExp(`${name}=["']([^"']+)["']`, "i");
	return readNonEmptyString(pattern.exec(attrs)?.[1]);
}

function extractFirstHeading(html: string): string | undefined {
	return readNonEmptyString(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i.exec(html)?.[1])?.replace(/<[^>]+>/g, "");
}

function htmlToText(html: string): string {
	return html
		.replace(/<style\b[\s\S]*?<\/style>/gi, " ")
		.replace(/<script\b[\s\S]*?<\/script>/gi, " ")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/\s+/g, " ")
		.trim();
}

function extractTheme(prompt: string): DesignDemoTheme | undefined {
	if (/高级|精致|premium|luxury/i.test(prompt)) return "premium";
	if (/深色|暗色|黑色|dark/i.test(prompt)) return "dark";
	if (/清爽|明亮|简洁|clean|light/i.test(prompt)) return "clean";
	return undefined;
}

function readNonEmptyString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readTheme(value: unknown): DesignDemoTheme | undefined {
	if (value === "clean" || value === "premium" || value === "dark") return value;
	return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createAssistantText(prompt: string, operations: string[], state: DesignDemoState): string {
	if (operations.length === 0) {
		return [
			"我在，当前页面已经显示在中间预览区。",
			"如果要改页面，直接说：把标题改成 星河工作室，正文改成 用 AI 做网页，加一个按钮叫 立即开始。",
		].join("\n");
	}
	return [
		`已根据你的输入更新设计：${operations.join(", ")}。`,
		`当前标题：${state.title}`,
		`当前按钮：${state.buttonLabel}`,
		`原始输入：${prompt}`,
	].join("\n");
}

function trimQuotes(value: string): string {
	return value.replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").trim();
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function themeTokens(theme: DesignDemoTheme): ThemeTokens {
	if (theme === "premium") {
		return {
			pageBackground: "#f5f1ea",
			sectionBackground: "#fffdf8",
			textColor: "#1f1a14",
			mutedColor: "#62584c",
			accentColor: "#8f6428",
			accentTextColor: "#ffffff",
			borderColor: "#d8c7ad",
			shadowColor: "rgb(87 64 34 / 18%)",
		};
	}
	if (theme === "dark") {
		return {
			pageBackground: "#111827",
			sectionBackground: "#0f172a",
			textColor: "#f8fafc",
			mutedColor: "#cbd5e1",
			accentColor: "#38bdf8",
			accentTextColor: "#082f49",
			borderColor: "#334155",
			shadowColor: "rgb(2 6 23 / 42%)",
		};
	}
	return {
		pageBackground: "#e7edf3",
		sectionBackground: "#ffffff",
		textColor: "#111827",
		mutedColor: "#4b5563",
		accentColor: "#0f766e",
		accentTextColor: "#ffffff",
		borderColor: "#d3dae4",
		shadowColor: "rgb(36 48 63 / 18%)",
	};
}
