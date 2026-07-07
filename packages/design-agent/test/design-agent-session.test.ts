import assert from "node:assert/strict";
import test from "node:test";
import { InMemorySessionRepo } from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { createInitialDesignDemoState } from "../src/core/artifacts/design-demo.ts";
import { createDesignAgentSession } from "../src/core/design-agent-session.ts";
import { createDesignTools } from "../src/core/tools/index.ts";

test("write tool calls can finish a turn with the same assistant text", async () => {
	const initialHtml = "<!doctype html><html><body><main>旧配色</main></body></html>";
	const nextHtml = "<!doctype html><html><body><main>青草绿配色</main></body></html>";
	let state = {
		...createInitialDesignDemoState(new Date("2026-07-06T00:00:00.000Z")),
		artifactHtml: initialHtml,
	};
	const faux = fauxProvider();
	faux.setResponses([
		fauxAssistantMessage(
			[
				fauxText("我已经把页面主色调整为夏天青草绿。"),
				fauxToolCall("replace_artifact_range", {
					start: 0,
					length: initialHtml.length,
					replacementHtml: nextHtml,
				}),
			],
			{ stopReason: "toolUse" },
		),
		fauxAssistantMessage("不应该再调用模型"),
	]);
	const models = createModels();
	models.setProvider(faux.provider);
	const sessionRepo = new InMemorySessionRepo();
	const harnessSession = await sessionRepo.create();
	const session = createDesignAgentSession({
		env: new NodeExecutionEnv({ cwd: process.cwd() }),
		session: harnessSession,
		models,
		model: faux.getModel(),
		thinkingLevel: "off",
		tools: createDesignTools({
			getDesignState: () => state,
			setDesignState: (nextState) => {
				state = nextState;
			},
			now: () => new Date("2026-07-06T01:00:00.000Z"),
		}),
	});

	const message = await session.prompt("把当前页面改成青草绿配色");

	assert.equal(faux.state.callCount, 1);
	assert.equal(message.content.find((block) => block.type === "text")?.text, "我已经把页面主色调整为夏天青草绿。");
	assert.equal(state.artifactHtml, nextHtml);
	assert.equal(state.version, 2);
});
