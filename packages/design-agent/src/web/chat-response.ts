import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { DesignDemoState } from "../core/artifacts/design-demo.ts";
import type { LlmTrace } from "./traces.ts";

export interface ChatResponse {
	prompt: string;
	assistant: {
		text: string;
		message: AssistantMessage;
	};
	design: DesignDemoState;
	artifact: {
		kind: "html";
		content: string;
	};
	traces: LlmTrace[];
}

export function extractAssistantText(message: AssistantMessage): string {
	const text = message.content
		.filter((block): block is { type: "text"; text: string } => block.type === "text")
		.map((block) => block.text)
		.join("");
	if (text) return text;
	return message.errorMessage ?? "";
}

export function buildChatResponse(options: {
	prompt: string;
	assistantMessage: AssistantMessage;
	assistantText?: string;
	design: DesignDemoState;
	artifactHtml: string;
	traces: LlmTrace[];
}): ChatResponse {
	const text = options.assistantText ?? extractAssistantText(options.assistantMessage);
	return {
		prompt: options.prompt,
		assistant: {
			text,
			message: options.assistantMessage,
		},
		design: options.design,
		artifact: {
			kind: "html",
			content: options.artifactHtml,
		},
		traces: options.traces,
	};
}
