import type { DesignAgentRuntime } from "../core/design-agent-runtime.ts";

export async function runRpcMode(_runtime: DesignAgentRuntime): Promise<never> {
	throw new Error("RPC mode scaffold is not implemented yet.");
}
