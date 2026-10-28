import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	createDesignAgentModelRuntime,
	loadLocalEnvFile,
	parseLocalEnvContent,
	resolveDesignAgentModelConfig,
} from "../src/core/models.ts";

test("parseLocalEnvContent reads simple dotenv assignments", () => {
	const parsed = parseLocalEnvContent(
		[
			"# local credentials",
			"OPENAI_API_KEY=sk-test",
			'DESIGN_AGENT_PROVIDER="openai"',
			"DESIGN_AGENT_MODEL='gpt-5-mini'",
		].join("\n"),
	);

	assert.deepEqual(parsed, {
		OPENAI_API_KEY: "sk-test",
		DESIGN_AGENT_PROVIDER: "openai",
		DESIGN_AGENT_MODEL: "gpt-5-mini",
	});
});

test("loadLocalEnvFile loads .env.local without overriding existing env values", async () => {
	const dir = await mkdtemp(join(tmpdir(), "design-agent-env-"));
	try {
		await writeFile(join(dir, ".env.local"), "OPENAI_API_KEY=from-file\nDESIGN_AGENT_PROVIDER=openai\n", "utf8");
		const targetEnv: Record<string, string | undefined> = { OPENAI_API_KEY: "from-shell" };

		const loaded = await loadLocalEnvFile(dir, targetEnv);

		assert.deepEqual(loaded, ["DESIGN_AGENT_PROVIDER"]);
		assert.equal(targetEnv.OPENAI_API_KEY, "from-shell");
		assert.equal(targetEnv.DESIGN_AGENT_PROVIDER, "openai");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("resolveDesignAgentModelConfig defaults to mock and supports real provider env config", () => {
	assert.deepEqual(resolveDesignAgentModelConfig({}), { provider: "mock", modelId: "faux-1" });
	assert.deepEqual(
		resolveDesignAgentModelConfig({
			DESIGN_AGENT_PROVIDER: "openai",
			DESIGN_AGENT_MODEL: "gpt-5-mini",
		}),
		{ provider: "openai", modelId: "gpt-5-mini" },
	);
	assert.deepEqual(
		resolveDesignAgentModelConfig({
			DESIGN_AGENT_PROVIDER: "deepseek",
			DESIGN_AGENT_MODEL: "deepseek-v4-flash",
		}),
		{ provider: "deepseek", modelId: "deepseek-v4-flash" },
	);
	assert.deepEqual(
		resolveDesignAgentModelConfig({
			DESIGN_AGENT_PROVIDER: "volcengine",
			DESIGN_AGENT_MODEL: "ep-test",
		}),
		{ provider: "volcengine", modelId: "ep-test" },
	);
	assert.deepEqual(
		resolveDesignAgentModelConfig({
			DESIGN_AGENT_PROVIDER: "openai-compat",
		}),
		{ provider: "openai-compat", modelId: "deepseek-v4-pro" },
	);
	assert.deepEqual(
		resolveDesignAgentModelConfig({
			DESIGN_AGENT_PROVIDER: "openai-compatible",
			DESIGN_AGENT_MODEL: "doubao-seed-2-1-pro-260628",
		}),
		{ provider: "openai-compat", modelId: "doubao-seed-2-1-pro-260628" },
	);
});

test("createDesignAgentModelRuntime registers Volcengine Ark through the core model layer", async () => {
	const runtime = await createDesignAgentModelRuntime({
		env: {
			DESIGN_AGENT_PROVIDER: "volcengine",
			DESIGN_AGENT_MODEL: "ep-test",
		},
	});

	assert.equal(runtime.model.provider, "volcengine");
	assert.equal(runtime.model.id, "ep-test");
	assert.equal(runtime.models.getProvider("volcengine")?.name, "Volcengine Ark");
});

test("createDesignAgentModelRuntime registers the OpenAI-compatible relay with an env-overridable base URL", async () => {
	const runtime = await createDesignAgentModelRuntime({
		env: {
			DESIGN_AGENT_PROVIDER: "openai-compat",
			DESIGN_AGENT_MODEL: "deepseek-v4-pro",
			DESIGN_AGENT_API_BASE_URL: "https://relay.example.com/api/v1",
		},
	});

	assert.equal(runtime.model.provider, "openai-compat");
	assert.equal(runtime.model.id, "deepseek-v4-pro");
	assert.equal(runtime.model.baseUrl, "https://relay.example.com/api/v1");
	assert.equal(runtime.models.getProvider("openai-compat")?.name, "OpenAI Compatible");

	const defaultRuntime = await createDesignAgentModelRuntime({
		env: { DESIGN_AGENT_PROVIDER: "openai-compat" },
	});
	assert.equal(defaultRuntime.model.baseUrl, "https://kexiangai.com/api/v1");
});
