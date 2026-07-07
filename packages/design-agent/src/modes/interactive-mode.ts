import type { DesignAgentRuntime } from "../core/design-agent-runtime.ts";

export class InteractiveMode {
	private readonly runtime: DesignAgentRuntime;

	constructor(runtime: DesignAgentRuntime) {
		this.runtime = runtime;
	}

	getRuntime(): DesignAgentRuntime {
		return this.runtime;
	}

	async run(): Promise<void> {
		throw new Error("Interactive mode scaffold is not implemented yet.");
	}
}
