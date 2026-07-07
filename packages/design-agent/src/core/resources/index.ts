import type { AgentHarnessResources, PromptTemplate } from "@earendil-works/pi-agent-core";
import { createDefaultDesignSkills, type DesignCoreSkill } from "../skills/index.ts";

export type DesignAgentResources = AgentHarnessResources<DesignCoreSkill, PromptTemplate>;

export function createDefaultDesignResources(): DesignAgentResources {
	return {
		skills: createDefaultDesignSkills(),
		promptTemplates: [],
	};
}
