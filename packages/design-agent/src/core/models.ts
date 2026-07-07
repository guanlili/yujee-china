import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
	type Api,
	type AuthContext,
	createModels,
	fauxAssistantMessage,
	fauxProvider,
	type Model,
	type MutableModels,
} from "@earendil-works/pi-ai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { volcengineArkProvider } from "@earendil-works/pi-ai/providers/volcengine-ark";
import { createMockDesignModelOutput, type DesignDemoState } from "./artifacts/design-demo.ts";

export type DesignAgentModelProvider = "mock" | "openai" | "deepseek" | "volcengine";

export interface DesignAgentModelConfig {
	provider: DesignAgentModelProvider;
	modelId: string;
}

export interface DesignAgentModelRuntimeOptions {
	cwd?: string;
	env?: MutableEnv;
	config?: DesignAgentModelConfig;
}

export interface DesignAgentModelRuntime {
	models: MutableModels;
	model: Model<Api>;
	prepareModelResponse(prompt: string, state: DesignDemoState): void;
}

type MutableEnv = Record<string, string | undefined>;

const DEFAULT_MOCK_MODEL = "faux-1";
const DEFAULT_OPENAI_MODEL = "gpt-5-mini";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-flash";
const DEFAULT_VOLCENGINE_MODEL = "deepseek-v4-flash";

export async function createDesignAgentModelRuntime(
	options: DesignAgentModelRuntimeOptions = {},
): Promise<DesignAgentModelRuntime> {
	const runtimeEnv = options.env ?? process.env;
	if (options.cwd) {
		await loadLocalEnvFile(options.cwd, runtimeEnv);
	}
	const modelConfig = options.config ?? resolveDesignAgentModelConfig(runtimeEnv);
	const models = createModels({ authContext: createEnvAuthContext(runtimeEnv) });
	let selectedModel: Model<Api> | undefined;
	let prepareModelResponse = (_prompt: string, _state: DesignDemoState): void => {};

	if (modelConfig.provider === "openai") {
		models.setProvider(openaiProvider());
		selectedModel = models.getModel("openai", modelConfig.modelId);
		if (!selectedModel) {
			throw new Error(`Unknown OpenAI model: ${modelConfig.modelId}`);
		}
	} else if (modelConfig.provider === "deepseek") {
		models.setProvider(deepseekProvider());
		selectedModel = models.getModel("deepseek", modelConfig.modelId);
		if (!selectedModel) {
			throw new Error(`Unknown DeepSeek model: ${modelConfig.modelId}`);
		}
	} else if (modelConfig.provider === "volcengine") {
		models.setProvider(volcengineArkProvider(modelConfig.modelId));
		selectedModel = models.getModel("volcengine", modelConfig.modelId);
		if (!selectedModel) {
			throw new Error(`Unknown Volcengine Ark model: ${modelConfig.modelId}`);
		}
	} else {
		const faux = fauxProvider();
		models.setProvider(faux.provider);
		selectedModel = faux.getModel();
		prepareModelResponse = (prompt: string, state: DesignDemoState): void => {
			faux.appendResponses([fauxAssistantMessage(createMockDesignModelOutput(state, prompt))]);
		};
	}

	return {
		models,
		model: selectedModel,
		prepareModelResponse,
	};
}

export function parseLocalEnvContent(content: string): Record<string, string> {
	const values: Record<string, string> = {};
	for (const rawLine of content.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		const separatorIndex = line.indexOf("=");
		if (separatorIndex <= 0) continue;
		const key = line.slice(0, separatorIndex).trim();
		const value = stripQuotes(line.slice(separatorIndex + 1).trim());
		if (isValidEnvKey(key)) {
			values[key] = value;
		}
	}
	return values;
}

export async function loadLocalEnvFile(cwd: string, targetEnv: MutableEnv = process.env): Promise<string[]> {
	let content: string;
	try {
		content = await readFile(join(cwd, ".env.local"), "utf8");
	} catch (error) {
		if (isMissingFileError(error)) return [];
		throw error;
	}

	const loadedKeys: string[] = [];
	const parsed = parseLocalEnvContent(content);
	for (const [key, value] of Object.entries(parsed)) {
		if (targetEnv[key] === undefined) {
			targetEnv[key] = value;
			loadedKeys.push(key);
		}
	}
	return loadedKeys;
}

export function resolveDesignAgentModelConfig(env: MutableEnv = process.env): DesignAgentModelConfig {
	const provider = normalizeProvider(env.DESIGN_AGENT_PROVIDER);
	if (provider === "openai") {
		return {
			provider,
			modelId: env.DESIGN_AGENT_MODEL?.trim() || DEFAULT_OPENAI_MODEL,
		};
	}
	if (provider === "deepseek") {
		return {
			provider,
			modelId: env.DESIGN_AGENT_MODEL?.trim() || DEFAULT_DEEPSEEK_MODEL,
		};
	}
	if (provider === "volcengine") {
		return {
			provider,
			modelId: env.DESIGN_AGENT_MODEL?.trim() || DEFAULT_VOLCENGINE_MODEL,
		};
	}
	return {
		provider: "mock",
		modelId: DEFAULT_MOCK_MODEL,
	};
}

export function createEnvAuthContext(env: MutableEnv): AuthContext {
	return {
		async env(name: string): Promise<string | undefined> {
			const value = env[name];
			return typeof value === "string" && value.trim().length > 0 ? value : undefined;
		},
		async fileExists(path: string): Promise<boolean> {
			void path;
			return false;
		},
	};
}

function normalizeProvider(value: string | undefined): DesignAgentModelProvider {
	const normalized = value?.trim().toLowerCase();
	if (normalized === "openai") return "openai";
	if (normalized === "deepseek") return "deepseek";
	if (normalized === "volcengine" || normalized === "ark" || normalized === "volcengine-ark") return "volcengine";
	return "mock";
}

function stripQuotes(value: string): string {
	if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
		return value.slice(1, -1);
	}
	return value;
}

function isValidEnvKey(key: string): boolean {
	return /^[A-Z_][A-Z0-9_]*$/.test(key);
}

function isMissingFileError(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
