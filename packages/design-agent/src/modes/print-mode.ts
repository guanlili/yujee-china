import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { DesignAgentSession } from "../core/design-agent-session.ts";

export interface PrintModeOptions {
	prompt: string;
}

function getAssistantText(message: AssistantMessage): string {
	return message.content
		.filter((block): block is { type: "text"; text: string } => block.type === "text")
		.map((block) => block.text)
		.join("");
}

export async function runPrintMode(session: DesignAgentSession, options: PrintModeOptions): Promise<number> {
	const response = await session.prompt(options.prompt);
	const text = getAssistantText(response);
	if (text.length > 0) {
		process.stdout.write(`${text}\n`);
	}
	return 0;
}
