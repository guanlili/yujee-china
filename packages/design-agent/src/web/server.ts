import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { InMemorySessionRepo } from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import {
	applyDesignModelOutput,
	cloneDesignDemoState,
	createInitialDesignDemoState,
	createNoChangeDesignResult,
	type DesignDemoResult,
	type DesignDemoState,
	renderDesignPreviewHtml,
} from "../core/artifacts/design-demo.ts";
import { compactDesignContext } from "../core/context-compression.ts";
import { createDesignAgentSession, type DesignAgentSession } from "../core/design-agent-session.ts";
import { createDesignAgentModelRuntime } from "../core/models.ts";
import { buildDesignModelPrompt } from "../core/prompts/design-artifact-prompt.ts";
import { createDesignTools } from "../core/tools/index.ts";
import { buildChatResponse, type ChatResponse, extractAssistantText } from "./chat-response.ts";
import { TraceStore } from "./traces.ts";

interface WebRuntime {
	session: DesignAgentSession;
	traces: TraceStore;
	getDesignState(): DesignDemoState;
	renderPreview(): string;
	applyModelOutput(modelOutput: string): DesignDemoResult;
	setActiveTrace(traceId: string | undefined): void;
	setActiveStreamSink(sink: ((event: ChatStreamEvent) => void) | undefined): void;
	prepareModelResponse(prompt: string, state: DesignDemoState): void;
}

export interface DesignAgentWebServerOptions {
	host?: string;
	port?: number;
	cwd?: string;
	env?: Record<string, string | undefined>;
}

type ChatStreamEvent =
	| { type: "started"; traceId: string; prompt: string }
	| { type: "llm_start"; traceId: string; callIndex: number; model?: string; messageCount?: number }
	| { type: "llm_done"; traceId: string; callIndex: number; status: number }
	| { type: "tool_call"; traceId: string; toolCallId: string; toolName: string; input: unknown }
	| {
			type: "tool_result";
			traceId: string;
			toolCallId: string;
			toolName: string;
			isError: boolean;
			details: unknown;
	  }
	| { type: "artifact_updated"; traceId: string; committed: boolean; version: number; operations: string[] }
	| { type: "assistant_final"; traceId: string; text: string }
	| { type: "done"; response: ChatResponse }
	| { type: "error"; error: string };

const staticDir = join(dirname(fileURLToPath(import.meta.url)), "static");

async function readBody(request: IncomingMessage): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of request) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}
	return Buffer.concat(chunks).toString("utf8");
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
	response.writeHead(statusCode, {
		"cache-control": "no-store",
		"content-type": "application/json; charset=utf-8",
	});
	response.end(JSON.stringify(body));
}

function sendText(response: ServerResponse, statusCode: number, body: string, contentType: string): void {
	response.writeHead(statusCode, { "cache-control": "no-store", "content-type": contentType });
	response.end(body);
}

function sendNdjsonStart(response: ServerResponse): void {
	response.writeHead(200, {
		"cache-control": "no-store",
		"content-type": "application/x-ndjson; charset=utf-8",
		"x-accel-buffering": "no",
	});
}

function writeNdjson(response: ServerResponse, event: ChatStreamEvent): void {
	response.write(`${JSON.stringify(event)}\n`);
}

function staticContentType(pathname: string): string {
	if (pathname.endsWith(".js")) return "text/javascript; charset=utf-8";
	if (pathname.endsWith(".css")) return "text/css; charset=utf-8";
	return "text/html; charset=utf-8";
}

async function createDefaultRuntime(cwd: string, env: Record<string, string | undefined>): Promise<WebRuntime> {
	const modelRuntime = await createDesignAgentModelRuntime({ cwd, env });
	const sessionRepo = new InMemorySessionRepo();
	const harnessSession = await sessionRepo.create();
	const traces = new TraceStore();
	let designState = createInitialDesignDemoState();
	const session = createDesignAgentSession({
		env: new NodeExecutionEnv({ cwd }),
		session: harnessSession,
		models: modelRuntime.models,
		model: modelRuntime.model,
		thinkingLevel: "off",
		tools: createDesignTools({
			getDesignState: () => cloneDesignDemoState(designState),
			setDesignState: (nextState) => {
				designState = cloneDesignDemoState(nextState);
			},
		}),
	});

	let activeTraceId: string | undefined;
	let activeStreamSink: ((event: ChatStreamEvent) => void) | undefined;
	let activeLlmCallIndex = 0;

	session.on("before_agent_start", (event) => {
		if (activeTraceId) {
			traces.recordProviderPayload(activeTraceId, {
				type: "before_agent_start",
				prompt: event.prompt,
				systemPrompt: event.systemPrompt,
				resources: event.resources,
				images: event.images,
			});
		}
		return undefined;
	});

	session.on("context", (event) => {
		const compacted = compactDesignContext(event.messages);
		if (activeTraceId) {
			traces.recordProviderPayload(activeTraceId, {
				type: "context",
				messages: compacted.messages,
				compression: compacted.stats,
			});
		}
		return { messages: compacted.messages };
	});

	session.on("before_provider_payload", (event) => {
		if (activeTraceId) {
			traces.recordProviderPayload(activeTraceId, event.payload);
			activeLlmCallIndex += 1;
			const payload = isRecord(event.payload) ? event.payload : {};
			activeStreamSink?.({
				type: "llm_start",
				traceId: activeTraceId,
				callIndex: activeLlmCallIndex,
				model: typeof payload.model === "string" ? payload.model : undefined,
				messageCount: Array.isArray(payload.messages) ? payload.messages.length : undefined,
			});
		}
		return { payload: event.payload };
	});

	session.on("after_provider_response", (event) => {
		if (activeTraceId) {
			traces.recordProviderResponse(activeTraceId, { status: event.status, headers: event.headers });
			activeStreamSink?.({
				type: "llm_done",
				traceId: activeTraceId,
				callIndex: activeLlmCallIndex,
				status: event.status,
			});
		}
		return undefined;
	});

	session.on("tool_call", (event) => {
		if (activeTraceId) {
			traces.recordProviderPayload(activeTraceId, {
				type: "tool_call",
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				input: event.input,
			});
			activeStreamSink?.({
				type: "tool_call",
				traceId: activeTraceId,
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				input: event.input,
			});
		}
		return undefined;
	});

	session.on("tool_result", (event) => {
		if (activeTraceId) {
			traces.recordProviderPayload(activeTraceId, {
				type: "tool_result",
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				input: event.input,
				content: event.content,
				details: event.details,
				isError: event.isError,
			});
			activeStreamSink?.({
				type: "tool_result",
				traceId: activeTraceId,
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				isError: event.isError,
				details: event.details,
			});
		}
		return undefined;
	});

	session.subscribe((event) => {
		if (event.type === "message_end" && event.message.role === "assistant" && activeTraceId) {
			traces.recordAssistantMessage(activeTraceId, event.message);
		}
	});

	return {
		session,
		traces,
		getDesignState(): DesignDemoState {
			return cloneDesignDemoState(designState);
		},
		renderPreview(): string {
			return renderDesignPreviewHtml(designState);
		},
		applyModelOutput(modelOutput: string): DesignDemoResult {
			const result = applyDesignModelOutput(designState, modelOutput);
			designState = cloneDesignDemoState(result.state);
			return result;
		},
		setActiveTrace(traceId: string | undefined): void {
			activeTraceId = traceId;
			if (traceId) activeLlmCallIndex = 0;
		},
		setActiveStreamSink(sink: ((event: ChatStreamEvent) => void) | undefined): void {
			activeStreamSink = sink;
		},
		prepareModelResponse: modelRuntime.prepareModelResponse,
	};
}

async function runChat(
	runtime: WebRuntime,
	message: string,
	stream: ((event: ChatStreamEvent) => void) | undefined,
): Promise<ChatResponse> {
	const trace = runtime.traces.startTrace({ prompt: message });
	runtime.setActiveTrace(trace.id);
	runtime.setActiveStreamSink(stream);
	stream?.({ type: "started", traceId: trace.id, prompt: message });
	const currentDesign = runtime.getDesignState();
	runtime.traces.recordProviderPayload(trace.id, {
		type: "design_demo_input",
		userMessage: message,
		design: currentDesign,
	});
	runtime.prepareModelResponse(message, currentDesign);

	try {
		const modelPrompt = buildDesignModelPrompt(currentDesign, message);
		const assistantMessage = await runtime.session.prompt(modelPrompt);
		runtime.traces.recordAssistantMessage(trace.id, assistantMessage);
		const assistantText = extractAssistantText(assistantMessage);
		const toolUpdatedDesign = runtime.getDesignState();
		const designResult =
			assistantMessage.stopReason === "error" || assistantMessage.stopReason === "aborted"
				? createNoChangeDesignResult(currentDesign, assistantText)
				: hasDesignStateChanged(currentDesign, toolUpdatedDesign)
					? createToolUpdatedDesignResult(currentDesign, toolUpdatedDesign, runtime.renderPreview(), assistantText)
					: runtime.applyModelOutput(assistantText);
		runtime.traces.recordProviderPayload(trace.id, {
			type: "design_demo_state",
			operations: designResult.operations,
			design: designResult.state,
			committed: assistantMessage.stopReason !== "error" && assistantMessage.stopReason !== "aborted",
		});
		stream?.({
			type: "artifact_updated",
			traceId: trace.id,
			committed: assistantMessage.stopReason !== "error" && assistantMessage.stopReason !== "aborted",
			version: designResult.state.version,
			operations: designResult.operations,
		});
		runtime.traces.finishTrace(trace.id);
		const result: ChatResponse = buildChatResponse({
			prompt: message,
			assistantMessage,
			assistantText: designResult.assistantText,
			design: designResult.state,
			artifactHtml: designResult.html,
			traces: runtime.traces.list(),
		});
		stream?.({ type: "assistant_final", traceId: trace.id, text: result.assistant.text });
		return result;
	} catch (error) {
		runtime.traces.finishTrace(trace.id);
		throw error;
	} finally {
		runtime.setActiveTrace(undefined);
		runtime.setActiveStreamSink(undefined);
	}
}

function hasDesignStateChanged(before: DesignDemoState, after: DesignDemoState): boolean {
	return (
		before.title !== after.title ||
		before.body !== after.body ||
		before.buttonLabel !== after.buttonLabel ||
		before.theme !== after.theme ||
		before.artifactHtml !== after.artifactHtml ||
		before.version !== after.version
	);
}

function createToolUpdatedDesignResult(
	before: DesignDemoState,
	after: DesignDemoState,
	html: string,
	assistantText: string,
): DesignDemoResult {
	return {
		state: after,
		html,
		assistantText: assistantText.trim() || "画好了。",
		operations: inferDesignOperations(before, after),
	};
}

function inferDesignOperations(before: DesignDemoState, after: DesignDemoState): string[] {
	const operations: string[] = [];
	if (before.title !== after.title) operations.push("title");
	if (before.body !== after.body) operations.push("body");
	if (before.buttonLabel !== after.buttonLabel) operations.push("button");
	if (before.theme !== after.theme) operations.push("theme");
	if (before.artifactHtml !== after.artifactHtml) operations.push("artifact");
	if (operations.length === 0 && before.version !== after.version) operations.push("artifact");
	return operations;
}

async function handleChat(
	runtime: WebRuntime,
	request: IncomingMessage,
	response: ServerResponse,
	options: { stream: boolean },
): Promise<void> {
	const body = await readBody(request);
	const parsed = JSON.parse(body || "{}") as { message?: unknown };
	const message = typeof parsed.message === "string" ? parsed.message.trim() : "";
	if (!message) {
		sendJson(response, 400, { error: "message is required" });
		return;
	}

	if (options.stream) {
		sendNdjsonStart(response);
		const write = (event: ChatStreamEvent): void => {
			writeNdjson(response, event);
		};
		try {
			const result = await runChat(runtime, message, write);
			write({ type: "done", response: result });
		} catch (error) {
			write({ type: "error", error: error instanceof Error ? error.message : String(error) });
		} finally {
			response.end();
		}
		return;
	}

	try {
		const result = await runChat(runtime, message, undefined);
		sendJson(response, 200, result);
	} catch (error) {
		sendJson(response, 500, {
			error: error instanceof Error ? error.message : String(error),
			traces: runtime.traces.list(),
		});
	}
}

async function handleStatic(pathname: string, response: ServerResponse): Promise<void> {
	const filename = pathname === "/" ? "index.html" : pathname.slice(1);
	const filePath = join(staticDir, filename);
	try {
		const content = await readFile(filePath, "utf8");
		sendText(response, 200, content, staticContentType(filePath));
	} catch {
		sendJson(response, 404, { error: "not found" });
	}
}

export async function createDesignAgentWebServer(options: DesignAgentWebServerOptions = {}): Promise<Server> {
	const runtime = await createDefaultRuntime(options.cwd ?? process.cwd(), options.env ?? process.env);
	return createServer((request, response) => {
		void (async () => {
			const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
			if (request.method === "POST" && url.pathname === "/api/chat") {
				await handleChat(runtime, request, response, {
					stream: url.searchParams.get("stream") === "1",
				});
				return;
			}
			if (request.method === "GET" && url.pathname === "/api/traces") {
				sendJson(response, 200, { traces: runtime.traces.list() });
				return;
			}
			if (request.method === "GET" && url.pathname === "/api/state") {
				const design = runtime.getDesignState();
				sendJson(response, 200, {
					design,
					artifact: {
						kind: "html",
						content: runtime.renderPreview(),
					},
					traces: runtime.traces.list(),
				});
				return;
			}
			if (request.method === "GET" && url.pathname === "/preview") {
				sendText(response, 200, runtime.renderPreview(), "text/html; charset=utf-8");
				return;
			}
			if (request.method === "GET") {
				await handleStatic(url.pathname, response);
				return;
			}
			sendJson(response, 405, { error: "method not allowed" });
		})().catch((error: unknown) => {
			sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
		});
	});
}

export async function startDesignAgentWebServer(options: DesignAgentWebServerOptions = {}): Promise<Server> {
	const host = options.host ?? "127.0.0.1";
	const port = options.port ?? 8787;
	const server = await createDesignAgentWebServer(options);
	await new Promise<void>((resolve) => {
		server.listen(port, host, resolve);
	});
	return server;
}

function parseCliOptions(args: string[]): DesignAgentWebServerOptions {
	const options: DesignAgentWebServerOptions = {};
	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (arg === "--host") {
			options.host = args[++index];
		} else if (arg === "--port") {
			const rawPort = args[++index];
			const port = Number(rawPort);
			if (!Number.isInteger(port) || port <= 0) {
				throw new Error(`Invalid port: ${rawPort}`);
			}
			options.port = port;
		}
	}
	return options;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const options = parseCliOptions(process.argv.slice(2));
	const host = options.host ?? "127.0.0.1";
	const port = options.port ?? 8787;
	await startDesignAgentWebServer(options);
	process.stdout.write(`Design Agent Web listening on http://${host}:${port}\n`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
