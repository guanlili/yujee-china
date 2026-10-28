import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
	type Api,
	type AuthContext,
	createModels,
	createProvider,
	envApiKeyAuth,
	fauxAssistantMessage,
	fauxProvider,
	type Model,
	type MutableModels,
	type Provider,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { volcengineArkProvider } from "@earendil-works/pi-ai/providers/volcengine-ark";
import { createMockDesignModelOutput, type DesignDemoState } from "./artifacts/design-demo.ts";

export type DesignAgentModelProvider = "mock" | "openai" | "deepseek" | "volcengine" | "openai-compat";

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
const DEFAULT_OPENAI_COMPAT_MODEL = "deepseek-v4-pro";
const DEFAULT_OPENAI_COMPAT_BASE_URL = "https://kexiangai.com/api/v1";

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
	} else if (modelConfig.provider === "openai-compat") {
		const baseUrl = resolveOpenaiCompatBaseUrl(runtimeEnv);
		models.setProvider(openaiCompatProvider(modelConfig.modelId, baseUrl));
		selectedModel = models.getModel("openai-compat", modelConfig.modelId);
		if (!selectedModel) {
			throw new Error(`Unknown OpenAI-compatible model: ${modelConfig.modelId}`);
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
	if (provider === "openai-compat") {
		return {
			provider,
			modelId: env.DESIGN_AGENT_MODEL?.trim() || DEFAULT_OPENAI_COMPAT_MODEL,
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
	if (normalized === "openai-compat" || normalized === "openai-compatible") return "openai-compat";
	return "mock";
}

/**
 * OpenAI 兼容中转站 provider(生产 = kexiangai.com,base URL 可用
 * DESIGN_AGENT_API_BASE_URL 覆盖)。与 vendored 的 volcengine-ark 同构:
 * 同一条 openai-completions 通路,只是 baseUrl/key 不写死。
 * 已实测(2026-10-28):中转会吞掉 thinking 类参数,思考型模型(如
 * deepseek-v4-pro)每轮必然先思考;pi-ai 的流式解析原生处理
 * reasoning_content,tool_calls 也正常透传,无需额外兼容层。
 */
function openaiCompatProvider(modelId: string, baseUrl: string): Provider<"openai-completions"> {
	return createProvider({
		id: "openai-compat",
		name: "OpenAI Compatible",
		baseUrl,
		auth: {
			apiKey: envApiKeyAuth("OpenAI-compatible API key", ["DESIGN_AGENT_API_KEY"]),
		},
		models: [createOpenaiCompatModel(modelId, baseUrl)],
		api: openAICompletionsApi(),
	});
}

function createOpenaiCompatModel(modelId: string, baseUrl: string): Model<"openai-completions"> {
	return {
		id: modelId,
		name: modelId,
		api: "openai-completions",
		provider: "openai-compat",
		baseUrl,
		compat: { supportsStore: false, supportsDeveloperRole: false },
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 8192,
	};
}

function resolveOpenaiCompatBaseUrl(env: MutableEnv): string {
	return env.DESIGN_AGENT_API_BASE_URL?.trim() || DEFAULT_OPENAI_COMPAT_BASE_URL;
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
