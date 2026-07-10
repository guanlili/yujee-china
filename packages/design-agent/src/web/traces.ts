import { appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { AssistantMessage } from "@earendil-works/pi-ai";

// 统一 AI 观测 JSONL（与 engine 共写一份，给 :8788 trace 观测台）。AI_TRACE_JSONL 覆盖；
// 未设则按模块位置定位仓内 engine/ai-trace.jsonl（src/web 与 dist/web 深度一致，上四层到仓根）。
const moduleDir = dirname(fileURLToPath(import.meta.url));
const AI_TRACE_JSONL =
	process.env.AI_TRACE_JSONL ??
	join(moduleDir, "..", "..", "..", "..", "engine", "ai-trace.jsonl");

function assistantText(message: AssistantMessage): string {
	return (message.content ?? [])
		.map((part) => (part && (part as { type?: string }).type === "text" ? (part as { text?: string }).text ?? "" : ""))
		.filter(Boolean)
		.join("\n");
}

export interface ProviderResponseTrace {
	status: number;
	headers: Record<string, string>;
}

export interface LlmTrace {
	id: string;
	prompt: string;
	startedAt: string;
	endedAt?: string;
	requestPayloads: unknown[];
	providerResponses: ProviderResponseTrace[];
	assistantMessage?: AssistantMessage;
	assistantMessages: AssistantMessage[];
}

export class TraceStore {
	private traces: LlmTrace[] = [];
	private nextId = 1;

	startTrace(options: { prompt: string }): LlmTrace {
		const trace: LlmTrace = {
			id: String(this.nextId++),
			prompt: options.prompt,
			startedAt: new Date().toISOString(),
			requestPayloads: [],
			providerResponses: [],
			assistantMessages: [],
		};
		this.traces.push(trace);
		return trace;
	}

	recordProviderPayload(traceId: string, payload: unknown): void {
		const trace = this.findTrace(traceId);
		if (!trace) return;
		trace.requestPayloads.push(payload);
	}

	recordProviderResponse(traceId: string, response: ProviderResponseTrace): void {
		const trace = this.findTrace(traceId);
		if (!trace) return;
		trace.providerResponses.push({
			status: response.status,
			headers: { ...response.headers },
		});
	}

	recordAssistantMessage(traceId: string, message: AssistantMessage): void {
		const trace = this.findTrace(traceId);
		if (!trace) return;
		trace.assistantMessage = message;
		const lastMessage = trace.assistantMessages.at(-1);
		if (!lastMessage || !isSameAssistantMessage(lastMessage, message)) {
			trace.assistantMessages.push(message);
		}
	}

	finishTrace(traceId: string): void {
		const trace = this.findTrace(traceId);
		if (!trace) return;
		trace.endedAt = new Date().toISOString();
		// 收尾时把每条 assistant 消息落进统一观测 JSONL（真实 token + pi-ai 已算好的成本）。追踪失败绝不影响业务。
		try {
			for (const message of trace.assistantMessages) {
				const usage = message.usage as { input?: number; output?: number; cost?: { total?: number } } | undefined;
				const rec = {
					ts: Date.now() / 1000,
					time: new Date().toTimeString().slice(0, 8),
					source: "design-agent",
					model: message.model,
					input: trace.prompt,
					output: assistantText(message),
					inputTokens: usage?.input ?? null,
					outputTokens: usage?.output ?? null,
					costUsd: usage?.cost?.total ?? null,
					imageCount: 0,
				};
				appendFileSync(AI_TRACE_JSONL, `${JSON.stringify(rec)}\n`);
			}
		} catch {
			// swallow
		}
	}

	list(): LlmTrace[] {
		return this.traces.map((trace) => ({
			...trace,
			requestPayloads: [...trace.requestPayloads],
			providerResponses: trace.providerResponses.map((response) => ({
				status: response.status,
				headers: { ...response.headers },
			})),
			assistantMessages: [...trace.assistantMessages],
		}));
	}

	clear(): void {
		this.traces = [];
	}

	private findTrace(traceId: string): LlmTrace | undefined {
		return this.traces.find((trace) => trace.id === traceId);
	}
}

function isSameAssistantMessage(left: AssistantMessage, right: AssistantMessage): boolean {
	return (
		left === right ||
		(left.timestamp === right.timestamp &&
			left.provider === right.provider &&
			left.model === right.model &&
			left.stopReason === right.stopReason &&
			JSON.stringify(left.content) === JSON.stringify(right.content))
	);
}
