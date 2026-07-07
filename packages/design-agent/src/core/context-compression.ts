import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { TextContent } from "@earendil-works/pi-ai";

export interface DesignContextCompressionStats {
	changed: boolean;
	originalMessageCount: number;
	compactedMessageCount: number;
	summarizedMessageCount: number;
	omittedOlderMessageCount: number;
}

export interface DesignContextCompressionResult {
	messages: AgentMessage[];
	stats: DesignContextCompressionStats;
}

const MAX_HISTORY_SUMMARY_LINES = 12;
const MAX_USER_TEXT_CHARS = 320;
const MAX_ASSISTANT_TEXT_CHARS = 220;

export function compactDesignContextMessages(messages: AgentMessage[]): AgentMessage[] {
	return compactDesignContext(messages).messages;
}

export function compactDesignContext(messages: AgentMessage[]): DesignContextCompressionResult {
	const lastUserIndex = findLastUserMessageIndex(messages);
	if (lastUserIndex <= 0) {
		return {
			messages,
			stats: createStats(messages.length, messages.length, 0, 0, false),
		};
	}

	const historyMessages = messages.slice(0, lastUserIndex);
	const activeTurnMessages = messages.slice(lastUserIndex);
	const summary = summarizeHistoryMessages(historyMessages);
	const compactedMessages = summary ? [summary.message, ...activeTurnMessages] : activeTurnMessages;

	return {
		messages: compactedMessages,
		stats: createStats(
			messages.length,
			compactedMessages.length,
			historyMessages.length,
			summary?.omittedOlderMessageCount ?? historyMessages.length,
			true,
		),
	};
}

function createStats(
	originalMessageCount: number,
	compactedMessageCount: number,
	summarizedMessageCount: number,
	omittedOlderMessageCount: number,
	changed: boolean,
): DesignContextCompressionStats {
	return {
		changed,
		originalMessageCount,
		compactedMessageCount,
		summarizedMessageCount,
		omittedOlderMessageCount,
	};
}

function findLastUserMessageIndex(messages: AgentMessage[]): number {
	for (let index = messages.length - 1; index >= 0; index--) {
		if (messages[index]?.role === "user") return index;
	}
	return -1;
}

function summarizeHistoryMessages(
	messages: AgentMessage[],
): { message: AgentMessage; omittedOlderMessageCount: number } | undefined {
	const lines: string[] = [];
	let scannedCount = 0;

	for (let index = messages.length - 1; index >= 0 && lines.length < MAX_HISTORY_SUMMARY_LINES; index--) {
		scannedCount += 1;
		const line = summarizeMessage(messages[index]!);
		if (line) lines.unshift(line);
	}

	if (lines.length === 0) return undefined;

	const omittedOlderMessageCount = Math.max(0, messages.length - scannedCount);
	if (omittedOlderMessageCount > 0) {
		lines.unshift(`更早还有 ${omittedOlderMessageCount} 条历史消息已省略。`);
	}

	return {
		message: {
			role: "user",
			content: [
				{
					type: "text",
					text: [
						"之前对话摘要（已压缩）：",
						"历史只保留用户输入和 AI 最终文本回复；完整页面 HTML 不在历史上下文中保留，需要页面细节时读取当前画板。",
						...lines.map((line) => `- ${line}`),
					].join("\n"),
				},
			],
			timestamp: messages.at(-1)?.timestamp ?? Date.now(),
		},
		omittedOlderMessageCount,
	};
}

function summarizeMessage(message: AgentMessage): string | undefined {
	if (message.role === "user") {
		const text = truncateText(stripArtifactContent(readText(message)), MAX_USER_TEXT_CHARS);
		return text ? `用户：${text}` : undefined;
	}

	if (message.role === "assistant") {
		const text = truncateText(stripArtifactContent(readText(message)), MAX_ASSISTANT_TEXT_CHARS);
		return isUsefulAssistantText(text) ? `AI 最终回复：${text}` : undefined;
	}

	return undefined;
}

function readText(message: AgentMessage): string {
	if (message.role === "user") {
		return readContentText(message.content);
	}
	if (message.role === "assistant" || message.role === "toolResult") {
		return readContentText(message.content);
	}
	return "";
}

function readContentText(content: string | unknown[]): string {
	if (typeof content === "string") return content;
	return content
		.filter(isTextContent)
		.map((block) => block.text)
		.join("\n");
}

function isTextContent(block: unknown): block is TextContent {
	return isRecord(block) && block.type === "text" && typeof block.text === "string";
}

function stripArtifactContent(text: string): string {
	return text
		.replace(/<artifact\b[^>]*>[\s\S]*?<\/artifact>/gi, "[HTML artifact omitted]")
		.replace(/```html\s*[\s\S]*?```/gi, "[HTML artifact omitted]")
		.replace(/"artifactHtml"\s*:\s*"(?:(?:\\.|[^"\\])*)"/gi, '"artifactHtml":"[HTML artifact omitted]"')
		.replace(/<!doctype html[\s\S]*?<\/html>/gi, "[HTML artifact omitted]")
		.replace(/<html\b[\s\S]*?<\/html>/gi, "[HTML artifact omitted]")
		.replace(/\s+/g, " ")
		.trim();
}

function isUsefulAssistantText(text: string): boolean {
	return text.length > 0 && text !== "[HTML artifact omitted]";
}

function truncateText(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	return `${text.slice(0, maxChars).trimEnd()}...`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
