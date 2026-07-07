import type { AgentTool, AgentToolResult, Skill } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "typebox";
import { type DesignDemoState, renderDesignPreviewHtml, summarizeDesignTaskContext } from "../artifacts/design-demo.ts";
import { createDefaultDesignSkills } from "../skills/index.ts";

export type DesignTool = AgentTool;

const getArtifactSummarySchema = Type.Object({});

const readArtifactSchema = Type.Object({
	start: Type.Optional(Type.Number({ description: "开始读取的字符偏移量，从 0 开始。" })),
	length: Type.Optional(Type.Number({ description: "最多返回的字符数。默认 3000，最大 12000。" })),
});

const readFullArtifactSchema = Type.Object({});

const searchArtifactSchema = Type.Object({
	query: Type.String({ description: "在当前渲染后的 HTML artifact 中搜索的文本，大小写不敏感。" }),
	limit: Type.Optional(Type.Number({ description: "最多返回的匹配数。默认 8，最大 20。" })),
});

const replaceArtifactSchema = Type.Object({
	html: Type.String({ description: "用于替换当前整个 artifact 的完整 HTML 文档。" }),
});

const replaceArtifactRangeSchema = Type.Object({
	start: Type.Number({ description: "替换开始位置的字符偏移量，从 0 开始。" }),
	length: Type.Number({ description: "需要替换的字符数。" }),
	replacementHtml: Type.String({ description: "插入到该范围内的 HTML 片段。" }),
});

const readSkillSchema = Type.Object({
	name: Type.String({ description: "需要读取完整内容的 skill 名称。" }),
});

type ReadArtifactInput = Static<typeof readArtifactSchema>;
type SearchArtifactInput = Static<typeof searchArtifactSchema>;
type ReplaceArtifactInput = Static<typeof replaceArtifactSchema>;
type ReplaceArtifactRangeInput = Static<typeof replaceArtifactRangeSchema>;
type ReadSkillInput = Static<typeof readSkillSchema>;

export interface DesignToolsOptions {
	getDesignState?: () => DesignDemoState;
	setDesignState?: (state: DesignDemoState) => void;
	now?: () => Date;
	skills?: Skill[];
}

export interface ReadArtifactDetails {
	start: number;
	length: number;
	totalLength: number;
	truncated: boolean;
}

export interface SearchArtifactDetails {
	query: string;
	totalMatches: number;
}

export interface ReplaceArtifactDetails {
	previousLength: number;
	insertedLength: number;
	totalLength: number;
	version: number;
}

export interface ReplaceArtifactRangeDetails {
	start: number;
	removedLength: number;
	insertedLength: number;
	totalLength: number;
	version: number;
}

export interface ReadSkillDetails {
	name: string;
	filePath: string;
}

const DEFAULT_READ_LENGTH = 3000;
const MAX_READ_LENGTH = 12000;
const DEFAULT_SEARCH_LIMIT = 8;
const MAX_SEARCH_LIMIT = 20;

export function createDesignTools(options: DesignToolsOptions = {}): DesignTool[] {
	return [
		createGetArtifactSummaryTool(options),
		createReadArtifactTool(options),
		createReadFullArtifactTool(options),
		createSearchArtifactTool(options),
		createReplaceArtifactTool(options),
		createReplaceArtifactRangeTool(options),
		createReadSkillTool(options),
	];
}

function createGetArtifactSummaryTool(options: DesignToolsOptions): AgentTool<typeof getArtifactSummarySchema> {
	return {
		name: "get_artifact_summary",
		label: "获取画板摘要",
		description: "返回当前 artifact 概览：版本、HTML 长度和识别到的区块。用于在不加载全部 HTML 理解画板。",
		parameters: getArtifactSummarySchema,
		async execute(): Promise<AgentToolResult<undefined>> {
			const state = getDesignState(options);
			return {
				content: [{ type: "text", text: JSON.stringify(summarizeDesignTaskContext(state), null, 2) }],
				details: undefined,
			};
		},
	};
}

function createReadArtifactTool(
	options: DesignToolsOptions,
): AgentTool<typeof readArtifactSchema, ReadArtifactDetails> {
	return {
		name: "read_artifact",
		label: "读取画板内容",
		description: "查看现有 HTML 的局部区域。只需要局部时使用 start/length；不要用它重建整个页面。",
		parameters: readArtifactSchema,
		prepareArguments(args: unknown): ReadArtifactInput {
			if (isRecord(args)) {
				return {
					start: readNumber(args.start),
					length: readNumber(args.length),
				};
			}
			return {};
		},
		async execute(_toolCallId: string, params: ReadArtifactInput): Promise<AgentToolResult<ReadArtifactDetails>> {
			const state = getDesignState(options);
			const html = renderDesignPreviewHtml(state);
			const start = clampInteger(params.start ?? 0, 0, html.length);
			const length = clampInteger(params.length ?? DEFAULT_READ_LENGTH, 1, MAX_READ_LENGTH);
			const end = Math.min(start + length, html.length);
			return {
				content: [{ type: "text", text: html.slice(start, end) }],
				details: {
					start,
					length: end - start,
					totalLength: html.length,
					truncated: end < html.length,
				},
			};
		},
	};
}

function createReadFullArtifactTool(
	options: DesignToolsOptions,
): AgentTool<typeof readFullArtifactSchema, ReadArtifactDetails> {
	return {
		name: "read_full_artifact",
		label: "读取完整画板",
		description: "完整 HTML artifact。理解完整旧页面时使用；。",
		parameters: readFullArtifactSchema,
		async execute(): Promise<AgentToolResult<ReadArtifactDetails>> {
			const state = getDesignState(options);
			const html = renderDesignPreviewHtml(state);
			return {
				content: [{ type: "text", text: html }],
				details: {
					start: 0,
					length: html.length,
					totalLength: html.length,
					truncated: false,
				},
			};
		},
	};
}

function createSearchArtifactTool(
	options: DesignToolsOptions,
): AgentTool<typeof searchArtifactSchema, SearchArtifactDetails> {
	return {
		name: "search_artifact",
		label: "搜索画板内容",
		description: "搜索当前 HTML artifact，返回带字符偏移量的小段预览。用于在读取前定位具体区块。",
		parameters: searchArtifactSchema,
		prepareArguments(args: unknown): SearchArtifactInput {
			if (isRecord(args)) {
				return {
					query: typeof args.query === "string" ? args.query : "",
					limit: readNumber(args.limit),
				};
			}
			return { query: "" };
		},
		async execute(_toolCallId: string, params: SearchArtifactInput): Promise<AgentToolResult<SearchArtifactDetails>> {
			const query = params.query.trim();
			if (!query) throw new Error("query 是必填项");
			const state = getDesignState(options);
			const html = renderDesignPreviewHtml(state);
			const limit = clampInteger(params.limit ?? DEFAULT_SEARCH_LIMIT, 1, MAX_SEARCH_LIMIT);
			const matches = findArtifactMatches(html, query, limit);
			return {
				content: [
					{
						type: "text",
						text: matches.length === 0 ? "(no matches)" : matches.map(formatArtifactMatch).join("\n"),
					},
				],
				details: {
					query,
					totalMatches: matches.length,
				},
			};
		},
	};
}

function createReplaceArtifactRangeTool(
	options: DesignToolsOptions,
): AgentTool<typeof replaceArtifactRangeSchema, ReplaceArtifactRangeDetails> {
	return {
		name: "replace_artifact_range",
		label: "替换画板局部",
		description:
			"替换 HTML artifact 中的指定字符范围。偏移量来自 get_artifact_summary、search_artifact 或 read_artifact。局部编辑优先使用它。",
		parameters: replaceArtifactRangeSchema,
		prepareArguments(args: unknown): ReplaceArtifactRangeInput {
			if (!isRecord(args)) return { start: 0, length: 0, replacementHtml: "" };
			return {
				start: readNumber(args.start) ?? 0,
				length: readNumber(args.length) ?? 0,
				replacementHtml: typeof args.replacementHtml === "string" ? args.replacementHtml : "",
			};
		},
		async execute(
			_toolCallId: string,
			params: ReplaceArtifactRangeInput,
		): Promise<AgentToolResult<ReplaceArtifactRangeDetails>> {
			if (!options.setDesignState) throw new Error("当前会话不允许写入 replace_artifact_range");
			const state = getDesignState(options);
			const html = renderDesignPreviewHtml(state);
			const start = clampInteger(params.start, 0, html.length);
			const removedLength = clampInteger(params.length, 0, html.length - start);
			const replacementHtml = params.replacementHtml;
			const nextHtml = `${html.slice(0, start)}${replacementHtml}${html.slice(start + removedLength)}`;
			const nextState: DesignDemoState = {
				...state,
				artifactHtml: nextHtml,
				version: state.version + 1,
				updatedAt: (options.now?.() ?? new Date()).toISOString(),
			};
			options.setDesignState(nextState);
			return {
				content: [{ type: "text", text: JSON.stringify(summarizeDesignTaskContext(nextState), null, 2) }],
				details: {
					start,
					removedLength,
					insertedLength: replacementHtml.length,
					totalLength: nextHtml.length,
					version: nextState.version,
				},
				terminate: true,
			};
		},
	};
}

function createReplaceArtifactTool(
	options: DesignToolsOptions,
): AgentTool<typeof replaceArtifactSchema, ReplaceArtifactDetails> {
	return {
		name: "replace_artifact",
		label: "替换整个画板",
		description: "用完整 HTML 文档替换当前整个 HTML artifact。用于全新页面、格式转换、整页重做或大范围改写",
		parameters: replaceArtifactSchema,
		prepareArguments(args: unknown): ReplaceArtifactInput {
			if (!isRecord(args)) return { html: "" };
			return {
				html: typeof args.html === "string" ? args.html : "",
			};
		},
		async execute(
			_toolCallId: string,
			params: ReplaceArtifactInput,
		): Promise<AgentToolResult<ReplaceArtifactDetails>> {
			if (!options.setDesignState) throw new Error("当前会话不允许写入 replace_artifact");
			const html = params.html;
			const trimmedHtml = html.trim();
			if (!/^<!doctype html>/i.test(trimmedHtml) || !/<\/html>$/i.test(trimmedHtml)) {
				throw new Error("html 必须是完整 HTML 文档");
			}
			const state = getDesignState(options);
			const previousHtml = renderDesignPreviewHtml(state);
			const nextState: DesignDemoState = {
				...state,
				artifactHtml: html,
				version: state.version + 1,
				updatedAt: (options.now?.() ?? new Date()).toISOString(),
			};
			options.setDesignState(nextState);
			return {
				content: [{ type: "text", text: JSON.stringify(summarizeDesignTaskContext(nextState), null, 2) }],
				details: {
					previousLength: previousHtml.length,
					insertedLength: html.length,
					totalLength: html.length,
					version: nextState.version,
				},
				terminate: true,
			};
		},
	};
}

function createReadSkillTool(options: DesignToolsOptions): AgentTool<typeof readSkillSchema, ReadSkillDetails> {
	return {
		name: "read_skill",
		label: "读取设计技能",
		description:
			"读取指定设计 skill 的完整说明。当前任务匹配可用 skill 列表中的某个描述时，先调用它获取完整规则，再继续设计。",
		parameters: readSkillSchema,
		prepareArguments(args: unknown): ReadSkillInput {
			if (!isRecord(args)) return { name: "" };
			return {
				name: typeof args.name === "string" ? args.name : "",
			};
		},
		async execute(_toolCallId: string, params: ReadSkillInput): Promise<AgentToolResult<ReadSkillDetails>> {
			const skillName = params.name.trim();
			if (!skillName) throw new Error("name 是必填项");
			const skill = getDesignSkills(options).find((candidate) => candidate.name === skillName);
			if (!skill) throw new Error(`未知 skill：${skillName}`);
			return {
				content: [{ type: "text", text: formatDesignSkillInvocation(skill) }],
				details: {
					name: skill.name,
					filePath: skill.filePath,
				},
			};
		},
	};
}

function getDesignState(options: DesignToolsOptions): DesignDemoState {
	return (
		options.getDesignState?.() ?? {
			title: "设计工作室",
			body: "暂无可读取 artifact。",
			buttonLabel: "开始设计",
			theme: "clean",
			version: 0,
			updatedAt: new Date(0).toISOString(),
		}
	);
}

function getDesignSkills(options: DesignToolsOptions): Skill[] {
	return options.skills ?? createDefaultDesignSkills();
}

function formatDesignSkillInvocation(skill: Skill): string {
	return [
		`<skill name="${escapeXml(skill.name)}" location="${escapeXml(skill.filePath)}">`,
		`相对路径以 ${dirnamePath(skill.filePath)} 为基准。`,
		"",
		skill.content,
		"</skill>",
	].join("\n");
}

function dirnamePath(filePath: string): string {
	const index = filePath.lastIndexOf("/");
	return index <= 0 ? "/" : filePath.slice(0, index);
}

function readNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function clampInteger(value: number, min: number, max: number): number {
	return Math.min(Math.max(Math.trunc(value), min), max);
}

interface ArtifactMatch {
	start: number;
	length: number;
	preview: string;
}

function findArtifactMatches(html: string, query: string, limit: number): ArtifactMatch[] {
	const matches: ArtifactMatch[] = [];
	const lowerHtml = html.toLowerCase();
	const lowerQuery = query.toLowerCase();
	let start = lowerHtml.indexOf(lowerQuery);
	while (start >= 0 && matches.length < limit) {
		const previewStart = Math.max(0, start - 120);
		const previewEnd = Math.min(html.length, start + query.length + 120);
		matches.push({
			start,
			length: query.length,
			preview: html.slice(previewStart, previewEnd).replace(/\s+/g, " ").trim(),
		});
		start = lowerHtml.indexOf(lowerQuery, start + lowerQuery.length);
	}
	return matches;
}

function formatArtifactMatch(match: ArtifactMatch): string {
	return `start=${match.start} length=${match.length} preview=${JSON.stringify(match.preview)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}
