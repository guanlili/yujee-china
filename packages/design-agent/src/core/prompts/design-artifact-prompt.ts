import { type DesignDemoState, summarizeDesignTaskContext } from "../artifacts/design-demo.ts";

export function buildDesignModelPrompt(current: DesignDemoState, userMessage: string): string {
	return [
		"<task_context>",
		"<current_artifact_summary>",
		JSON.stringify(summarizeDesignTaskContext(current)),
		"</current_artifact_summary>",
		"<user_request>",
		userMessage,
		"</user_request>",
		"</task_context>",
	].join("\n");
}
