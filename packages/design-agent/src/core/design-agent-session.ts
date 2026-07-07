import {
	AgentHarness,
	type AgentHarnessEvent,
	type AgentHarnessEventResultMap,
	type AgentHarnessOptions,
	type AgentHarnessOwnEvent,
	type AgentTool,
	type PromptTemplate,
	type Skill,
} from "@earendil-works/pi-agent-core";
import type { AssistantMessage, ImageContent } from "@earendil-works/pi-ai";
import { createDefaultDesignResources } from "./resources/index.ts";
import { buildDesignSystemPrompt } from "./system-prompt.ts";
import { createDesignTools, type DesignTool } from "./tools/index.ts";

export type DesignSkill = Skill;
export type DesignPromptTemplate = PromptTemplate;
export type DesignAgentEvent = AgentHarnessEvent<DesignSkill, DesignPromptTemplate>;
export type DesignAgentOwnEvent = AgentHarnessOwnEvent<DesignSkill, DesignPromptTemplate>;
export type DesignAgentEventResultMap = AgentHarnessEventResultMap;

export interface DesignAgentSessionOptions extends AgentHarnessOptions<DesignSkill, DesignPromptTemplate, DesignTool> {}

export class DesignAgentSession {
	private readonly harness: AgentHarness<DesignSkill, DesignPromptTemplate, DesignTool>;

	constructor(options: DesignAgentSessionOptions) {
		this.harness = new AgentHarness({
			...options,
			resources: options.resources ?? createDefaultDesignResources(),
			systemPrompt: options.systemPrompt ?? buildDesignSystemPrompt,
			tools: options.tools ?? createDesignTools(),
		});
	}

	getHarness(): AgentHarness<DesignSkill, DesignPromptTemplate, DesignTool> {
		return this.harness;
	}

	prompt(text: string, options?: { images?: ImageContent[] }): Promise<AssistantMessage> {
		return this.harness.prompt(text, options);
	}

	steer(text: string, options?: { images?: ImageContent[] }): Promise<void> {
		return this.harness.steer(text, options);
	}

	followUp(text: string, options?: { images?: ImageContent[] }): Promise<void> {
		return this.harness.followUp(text, options);
	}

	waitForIdle(): Promise<void> {
		return this.harness.waitForIdle();
	}

	subscribe(listener: (event: DesignAgentEvent, signal?: AbortSignal) => Promise<void> | void): () => void {
		return this.harness.subscribe(listener);
	}

	on<TType extends keyof DesignAgentEventResultMap>(
		type: TType,
		handler: (
			event: Extract<DesignAgentOwnEvent, { type: TType }>,
		) => Promise<DesignAgentEventResultMap[TType]> | DesignAgentEventResultMap[TType],
	): () => void {
		return this.harness.on(type, handler);
	}
}

export function createDesignAgentSession(options: DesignAgentSessionOptions): DesignAgentSession {
	return new DesignAgentSession(options);
}

export type { AgentTool };
