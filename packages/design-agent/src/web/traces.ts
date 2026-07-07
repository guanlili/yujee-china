import type { AssistantMessage } from "@earendil-works/pi-ai";

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
