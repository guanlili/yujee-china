import {
	createDesignAgentSession,
	type DesignAgentSession,
	type DesignAgentSessionOptions,
} from "./design-agent-session.ts";

export interface DesignAgentRuntimeOptions {
	session: DesignAgentSession;
}

export class DesignAgentRuntime {
	readonly session: DesignAgentSession;

	constructor(options: DesignAgentRuntimeOptions) {
		this.session = options.session;
	}
}

export function createDesignAgentRuntime(options: DesignAgentSessionOptions): DesignAgentRuntime {
	return new DesignAgentRuntime({
		session: createDesignAgentSession(options),
	});
}
