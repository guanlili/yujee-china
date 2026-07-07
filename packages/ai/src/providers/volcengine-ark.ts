import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import { createProvider, type Provider } from "../models.ts";
import type { Model } from "../types.ts";

const VOLCENGINE_ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";

export function volcengineArkProvider(modelId: string): Provider<"openai-completions"> {
	return createProvider({
		id: "volcengine",
		name: "Volcengine Ark",
		baseUrl: VOLCENGINE_ARK_BASE_URL,
		auth: {
			apiKey: envApiKeyAuth("Volcengine Ark API key", [
				"ARK_API_KEY",
				"VOLCENGINE_API_KEY",
				"VOLCANO_ENGINE_API_KEY",
			]),
		},
		models: [createVolcengineArkModel(modelId)],
		api: openAICompletionsApi(),
	});
}

function createVolcengineArkModel(modelId: string): Model<"openai-completions"> {
	return {
		id: modelId,
		name: modelId,
		api: "openai-completions",
		provider: "volcengine",
		baseUrl: VOLCENGINE_ARK_BASE_URL,
		compat: { supportsStore: false, supportsDeveloperRole: false },
		reasoning: false,
		input: ["text"],
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
		},
		contextWindow: 128000,
		maxTokens: 8192,
	};
}
