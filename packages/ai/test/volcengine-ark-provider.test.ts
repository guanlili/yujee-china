import { describe, expect, it } from "vitest";
import { volcengineArkProvider } from "../src/providers/volcengine-ark.ts";

describe("volcengineArkProvider", () => {
	it("creates an OpenAI-compatible Ark provider for the supplied endpoint model", () => {
		const provider = volcengineArkProvider("ep-test");
		const [model] = provider.getModels();

		expect(provider.id).toBe("volcengine");
		expect(provider.name).toBe("Volcengine Ark");
		expect(provider.baseUrl).toBe("https://ark.cn-beijing.volces.com/api/v3");
		expect(model).toMatchObject({
			id: "ep-test",
			name: "ep-test",
			api: "openai-completions",
			provider: "volcengine",
			baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
			contextWindow: 128000,
			maxTokens: 8192,
		});
	});
});
