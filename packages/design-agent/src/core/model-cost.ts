import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 单次模型调用的成本估算,读 packages/contracts/pricing/model-prices.json ——
 * 与 engine 的 providers/pricing.py【同一张表】。
 *
 * 为什么不用 pi-ai 自带的 `usage.cost`:design-agent 走火山方舟
 * (DESIGN_AGENT_PROVIDER=volcengine),而 packages/ai 的方舟 provider 把所有模型的
 * 单价写死为 0(volcengine-ark.ts: cost {input:0, output:0, ...}) —— 于是每次调用
 * 都报 costUsd: 0。不是 null,是【零】,观测台把它当免费累加进总额。design-agent 是
 * 多轮带工具的设计对话循环,很可能是 token 消耗最大的一环,却在账上永远不花钱。
 *
 * 方舟按【输入长度】分档计价,所以这里必须支持 tiers,不能只存单价。
 */

export interface CostEstimate {
	currency: string;
	input: number;
	output: number;
	total: number;
}

interface Tier {
	maxInputTokens: number | null;
	input: number;
	output: number;
	cacheRead?: number | null;
}

interface ModelPricing {
	currency: string;
	tiers: Tier[];
}

function resolvePricesPath(): string {
	const explicit = process.env.YUJEE_MODEL_PRICES?.trim();
	if (explicit) return explicit;

	const containerPath = "/app/packages/contracts/pricing/model-prices.json";
	if (existsSync(containerPath)) return containerPath;

	// Walk up to the repo root looking for packages/contracts — same resolution
	// strategy the template loader uses on both sides.
	let dir = dirname(fileURLToPath(import.meta.url));
	for (let i = 0; i < 10; i += 1) {
		const candidate = join(dir, "packages", "contracts", "pricing", "model-prices.json");
		if (existsSync(candidate)) return candidate;
		const parent = resolve(dir, "..");
		if (parent === dir) break;
		dir = parent;
	}
	throw new Error("model-prices.json not found (set YUJEE_MODEL_PRICES)");
}

let cached: Record<string, ModelPricing> | undefined;

function table(): Record<string, ModelPricing> {
	if (!cached) {
		const raw = JSON.parse(readFileSync(resolvePricesPath(), "utf8")) as {
			models: Record<string, ModelPricing>;
		};
		cached = raw.models;
	}
	return cached;
}

/** Same normalisation + longest-prefix match as the Python side, so both agree. */
function lookup(model: string): ModelPricing | undefined {
	const name = model.trim().toLowerCase().replaceAll(".", "-");
	let best: string | undefined;
	for (const key of Object.keys(table())) {
		if (name.startsWith(key) && (best === undefined || key.length > best.length)) best = key;
	}
	return best ? table()[best] : undefined;
}

/**
 * `inputTokens` is the TOTAL input (cache hits included — that's how providers
 * report it). `cachedInputTokens` is the hit portion, priced at cacheRead.
 * Returns undefined when the model is unpriced or tokens are missing, so the
 * caller writes null rather than a wrong number.
 */
export function estimateCost(
	model: string,
	inputTokens: number | null | undefined,
	outputTokens: number | null | undefined,
	cachedInputTokens?: number | null,
): CostEstimate | undefined {
	if (!Number.isInteger(inputTokens) || !Number.isInteger(outputTokens)) return undefined;
	const inTok = inputTokens as number;
	const outTok = outputTokens as number;
	if (inTok < 0 || outTok < 0) return undefined;

	const pricing = lookup(model);
	if (!pricing) return undefined;

	const tier =
		pricing.tiers.find((t) => t.maxInputTokens === null || inTok <= t.maxInputTokens) ??
		pricing.tiers[pricing.tiers.length - 1];

	const cached = Number.isInteger(cachedInputTokens)
		? Math.max(0, Math.min(cachedInputTokens as number, inTok))
		: 0;
	const fresh = inTok - cached;
	const cacheRate = tier.cacheRead ?? tier.input;

	const costIn = (fresh * tier.input + cached * cacheRate) / 1_000_000;
	const costOut = (outTok * tier.output) / 1_000_000;
	const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

	return {
		currency: pricing.currency,
		input: round6(costIn),
		output: round6(costOut),
		total: round6(costIn + costOut),
	};
}
