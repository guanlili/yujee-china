import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { InMemorySessionRepo } from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import {
	formatPageUserRef,
	pageUserRefs,
	type AlbumBookState,
	cloneAlbumBookState,
	parseAlbumBookInput,
	renderAlbumBookPreviewHtml,
	validateAlbumBook,
} from "../core/album/book-state.ts";
import { loadAlbumSkills } from "../core/album/skills-loader.ts";
import { buildAlbumSystemPrompt } from "../core/album/system-prompt.ts";
import { loadTemplateCatalog, type TemplateCatalog } from "../core/album/templates-catalog.ts";
import { createAlbumTools } from "../core/album/tools.ts";
import { compactDesignContext } from "../core/context-compression.ts";
import { createDesignAgentSession, type DesignAgentSession } from "../core/design-agent-session.ts";
import { createDesignAgentModelRuntime } from "../core/models.ts";
import { extractAssistantText } from "./chat-response.ts";
import { TraceStore } from "./traces.ts";

/**
 * Album 模式 dev/服务 server：画布是一本书（章节树 + 模板化页面）。
 *
 * 多书隔离：每个 albumId 一套独立的会话/trace/书状态（模型 runtime 与模板目录共享）。
 * Web 接线协议：先 POST /api/book 装书（Postgres 真相源 → Agent 画布），再 POST
 * /api/chat 对话；写入后的书由响应带回，由调用方负责持久化。不带 albumId 时使用
 * "default"（本地画布调试，启动时装 fixture 书）。
 */

export interface AlbumAgentWebServerOptions {
	host?: string;
	port?: number;
	cwd?: string;
	env?: Record<string, string | undefined>;
	/** 启动时装入 default 书的 JSON 文件路径；缺省用包内 fixtures/sample-book.json。 */
	bookPath?: string;
	contractsDir?: string;
	/** 设置后，/api/* 请求必须带 Authorization: Bearer <secret>。 */
	sharedSecret?: string;
}

type AlbumStreamEvent =
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
	| { type: "done"; response: AlbumChatResponse }
	| { type: "error"; error: string };

export interface AlbumChatResponse {
	prompt: string;
	albumId: string;
	assistant: { text: string };
	committed: boolean;
	book: AlbumBookState;
	artifact: { kind: "html"; content: string };
	traces: unknown[];
}

const moduleDir = dirname(fileURLToPath(import.meta.url));
const staticDir = join(moduleDir, "static");
const defaultBookPath = join(moduleDir, "..", "..", "fixtures", "sample-book.json");
const DEFAULT_ALBUM_ID = "default";

interface AlbumRuntime {
	albumId: string;
	session: DesignAgentSession;
	traces: TraceStore;
	/** 模板目录:用户口径页码换算(封面/目录/封尾不占号)需要模板类目。 */
	catalog: TemplateCatalog;
	getBook(): AlbumBookState;
	setBook(state: AlbumBookState): void;
	renderPreview(): string;
	setActiveTrace(traceId: string | undefined): void;
	setActiveStreamSink(sink: ((event: AlbumStreamEvent) => void) | undefined): void;
	/** 同一本书的请求串行化，避免并发对话交叉写状态。 */
	chatQueue: Promise<unknown>;
}

interface SharedRuntimeDeps {
	catalog: TemplateCatalog;
	models: Awaited<ReturnType<typeof createDesignAgentModelRuntime>>;
	cwd: string;
	env: Record<string, string | undefined>;
}

async function createSharedDeps(options: AlbumAgentWebServerOptions): Promise<SharedRuntimeDeps> {
	const cwd = options.cwd ?? process.cwd();
	const env = options.env ?? process.env;
	return {
		catalog: loadTemplateCatalog({ contractsDir: options.contractsDir, env }),
		models: await createDesignAgentModelRuntime({ cwd, env }),
		cwd,
		env,
	};
}

async function createAlbumRuntime(
	deps: SharedRuntimeDeps,
	albumId: string,
	initialBook: AlbumBookState,
): Promise<AlbumRuntime> {
	let bookState = cloneAlbumBookState(initialBook);
	const skills = loadAlbumSkills({ env: deps.env });
	const sessionRepo = new InMemorySessionRepo();
	const harnessSession = await sessionRepo.create();
	const traces = new TraceStore();
	const session = createDesignAgentSession({
		env: new NodeExecutionEnv({ cwd: deps.cwd }),
		session: harnessSession,
		models: deps.models.models,
		model: deps.models.model,
		thinkingLevel: "off",
		resources: { skills, promptTemplates: [] },
		systemPrompt: buildAlbumSystemPrompt,
		tools: createAlbumTools({
			catalog: deps.catalog,
			skills,
			getBookState: () => cloneAlbumBookState(bookState),
			setBookState: (nextState) => {
				bookState = cloneAlbumBookState(nextState);
			},
		}),
	});

	let activeTraceId: string | undefined;
	let activeStreamSink: ((event: AlbumStreamEvent) => void) | undefined;
	let activeLlmCallIndex = 0;

	session.on("before_agent_start", (event) => {
		if (activeTraceId) {
			traces.recordProviderPayload(activeTraceId, {
				type: "before_agent_start",
				prompt: event.prompt,
				systemPrompt: event.systemPrompt,
				resources: event.resources,
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
		albumId,
		session,
		traces,
		catalog: deps.catalog,
		getBook(): AlbumBookState {
			return cloneAlbumBookState(bookState);
		},
		setBook(state: AlbumBookState): void {
			bookState = cloneAlbumBookState(state);
		},
		renderPreview(): string {
			return renderAlbumBookPreviewHtml(bookState, deps.catalog);
		},
		setActiveTrace(traceId: string | undefined): void {
			activeTraceId = traceId;
			if (traceId) activeLlmCallIndex = 0;
		},
		setActiveStreamSink(sink: ((event: AlbumStreamEvent) => void) | undefined): void {
			activeStreamSink = sink;
		},
		chatQueue: Promise.resolve(),
	};
}

class AlbumRuntimeManager {
	private readonly runtimes = new Map<string, AlbumRuntime>();
	private readonly creating = new Map<string, Promise<AlbumRuntime>>();

	private readonly deps: SharedRuntimeDeps;
	private readonly defaultBook: AlbumBookState | undefined;

	constructor(deps: SharedRuntimeDeps, defaultBook: AlbumBookState | undefined) {
		this.deps = deps;
		this.defaultBook = defaultBook;
	}

	get(albumId: string): AlbumRuntime | undefined {
		return this.runtimes.get(albumId);
	}

	/** 观测用：列出各 albumId 的 trace 概览（含最近一轮时间/指令），供观测台自动认最近活跃相册。 */
	listAlbums(): Array<{ albumId: string; traceCount: number; lastStartedAt: string | null; lastPrompt: string | null }> {
		const out: Array<{ albumId: string; traceCount: number; lastStartedAt: string | null; lastPrompt: string | null }> = [];
		for (const [albumId, runtime] of this.runtimes) {
			const traces = runtime.traces.list();
			const last = traces.at(-1);
			out.push({
				albumId,
				traceCount: traces.length,
				lastStartedAt: last?.startedAt ?? null,
				lastPrompt: last?.prompt ?? null,
			});
		}
		return out;
	}

	/** 装书：runtime 已存在则只换书（保留对话上下文），否则新建。 */
	async loadBook(albumId: string, book: AlbumBookState): Promise<AlbumRuntime> {
		const existing = this.runtimes.get(albumId);
		if (existing) {
			existing.setBook(book);
			return existing;
		}
		return this.create(albumId, book);
	}

	/** default 书在首次访问时懒加载 fixture。 */
	async getOrCreateDefault(albumId: string): Promise<AlbumRuntime | undefined> {
		const existing = this.runtimes.get(albumId);
		if (existing) return existing;
		if (albumId === DEFAULT_ALBUM_ID && this.defaultBook) {
			return this.create(albumId, this.defaultBook);
		}
		return undefined;
	}

	private async create(albumId: string, book: AlbumBookState): Promise<AlbumRuntime> {
		const pending = this.creating.get(albumId);
		if (pending) {
			const runtime = await pending;
			runtime.setBook(book);
			return runtime;
		}
		const creation = createAlbumRuntime(this.deps, albumId, book).then((runtime) => {
			this.runtimes.set(albumId, runtime);
			this.creating.delete(albumId);
			return runtime;
		});
		this.creating.set(albumId, creation);
		return creation;
	}
}

// 把「用户正看着哪页」拼进本轮用户消息:模型据此消解"这页/这一页/当前页"的指代,
// 不再瞎猜。作为消息前缀(而非独立 system 轮)进入会话历史 —— 历史里保留"说这句话时
// 用户停在哪页"本身就是有效语境;Web 落库的聊天记录存的是原始 userMessage,不受影响。
export function composeChatTurn(
	message: string,
	currentPageIndex: number | undefined,
	brief?: import("../core/album/book-state.ts").AlbumBookBrief,
	// 用户口径称呼(封面/目录/封尾/第 N 页):由调用方按书状态+模板类目换算;
	// 缺省时退化为自然页序(仅测试/异常兜底)。
	currentPageLabel?: string,
): string {
	const parts: string[] = [];
	// 书级设计简报:AI 的全局语境(主题/配色主题/封面氛围)。chapter 概念不进上下文。
	if (brief && (brief.theme || brief.palette || brief.coverMood)) {
		const briefBits: string[] = [];
		if (brief.theme) briefBits.push(`主题:${brief.theme}`);
		if (brief.palette?.colors) {
			briefBits.push(`配色:${Object.entries(brief.palette.colors).map(([k, v]) => `${k}=${v}`).join(" ")}`);
		}
		if (brief.palette?.fonts) {
			briefBits.push(`字体:${Object.entries(brief.palette.fonts).map(([k, v]) => `${k}=${v}`).join(" ")}`);
		}
		if (brief.coverMood) briefBits.push(`封面氛围:${brief.coverMood}`);
		parts.push(`【设计简报】${briefBits.join(";")}`);
	}
	if (currentPageIndex != null) {
		const label = currentPageLabel ?? `第 ${currentPageIndex + 1} 页`;
		parts.push(
			`【界面上下文】用户当前停留在${label}。用户说"这页/这一页/当前页"时即指它。` +
				`对用户提及页码一律用用户口径(内页第 N 页,封面/目录/封尾不占页码),不要提内部 pageIndex。`,
		);
	}
	if (parts.length === 0) return message;
	return `${parts.join("\n")}\n\n${message}`;
}

async function runAlbumChat(
	runtime: AlbumRuntime,
	message: string,
	stream: ((event: AlbumStreamEvent) => void) | undefined,
	currentPageIndex?: number,
): Promise<AlbumChatResponse> {
	const trace = runtime.traces.startTrace({ prompt: message });
	runtime.setActiveTrace(trace.id);
	runtime.setActiveStreamSink(stream);
	stream?.({ type: "started", traceId: trace.id, prompt: message });
	const bookBefore = runtime.getBook();
	runtime.traces.recordProviderPayload(trace.id, {
		type: "album_input",
		userMessage: message,
		currentPageIndex: currentPageIndex ?? null,
		bookVersion: bookBefore.version,
	});

	try {
		const currentPageLabel =
			currentPageIndex != null
				? (() => {
						const ref = pageUserRefs(bookBefore, (templateId) => runtime.catalog.get(templateId)?.category)[
							currentPageIndex
						];
						return ref === undefined ? undefined : formatPageUserRef(ref);
					})()
				: undefined;
		const assistantMessage = await runtime.session.prompt(
			composeChatTurn(message, currentPageIndex, runtime.getBook().brief, currentPageLabel),
		);
		runtime.traces.recordAssistantMessage(trace.id, assistantMessage);
		const assistantText = extractAssistantText(assistantMessage);
		const bookAfter = runtime.getBook();
		const committed =
			assistantMessage.stopReason !== "error" &&
			assistantMessage.stopReason !== "aborted" &&
			bookAfter.version !== bookBefore.version;
		runtime.traces.recordProviderPayload(trace.id, {
			type: "album_state",
			committed,
			versionBefore: bookBefore.version,
			versionAfter: bookAfter.version,
		});
		// 只有真的发生写入才广播画板更新；读-答轮次不发事件（否则前端会把
		// committed:false 渲染成"更新失败"的红色 error 行）。
		if (committed) {
			stream?.({
				type: "artifact_updated",
				traceId: trace.id,
				committed,
				version: bookAfter.version,
				operations: [`v${bookBefore.version}->v${bookAfter.version}`],
			});
		}
		runtime.traces.finishTrace(trace.id);
		const response: AlbumChatResponse = {
			prompt: message,
			albumId: runtime.albumId,
			assistant: { text: assistantText.trim() || "（无文字回复）" },
			committed,
			book: bookAfter,
			artifact: { kind: "html", content: runtime.renderPreview() },
			traces: runtime.traces.list(),
		};
		stream?.({ type: "assistant_final", traceId: trace.id, text: response.assistant.text });
		return response;
	} catch (error) {
		runtime.traces.finishTrace(trace.id);
		throw error;
	} finally {
		runtime.setActiveTrace(undefined);
		runtime.setActiveStreamSink(undefined);
	}
}

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

function staticContentType(pathname: string): string {
	if (pathname.endsWith(".js")) return "text/javascript; charset=utf-8";
	if (pathname.endsWith(".css")) return "text/css; charset=utf-8";
	return "text/html; charset=utf-8";
}

function readAlbumId(source: Record<string, unknown> | URL): string {
	if (source instanceof URL) {
		return source.searchParams.get("albumId")?.trim() || DEFAULT_ALBUM_ID;
	}
	return typeof source.albumId === "string" && source.albumId.trim() ? source.albumId.trim() : DEFAULT_ALBUM_ID;
}

async function resolveRuntime(
	manager: AlbumRuntimeManager,
	albumId: string,
	response: ServerResponse,
): Promise<AlbumRuntime | undefined> {
	const runtime = (await manager.getOrCreateDefault(albumId)) ?? manager.get(albumId);
	if (!runtime) {
		sendJson(response, 409, {
			error: `album "${albumId}" 尚未装书。先 POST /api/book {albumId, book} 装入当前书状态。`,
		});
		return undefined;
	}
	return runtime;
}

async function handleAlbumChat(
	manager: AlbumRuntimeManager,
	request: IncomingMessage,
	response: ServerResponse,
	options: { stream: boolean },
): Promise<void> {
	const body = await readBody(request);
	const parsed = JSON.parse(body || "{}") as Record<string, unknown>;
	const message = typeof parsed.message === "string" ? parsed.message.trim() : "";
	if (!message) {
		sendJson(response, 400, { error: "message is required" });
		return;
	}
	// 用户当前停留页(编辑器焦点页,可选):用于"这页"类指代消解。非法值按未提供处理。
	const rawPageIndex = parsed.currentPageIndex;
	const currentPageIndex =
		typeof rawPageIndex === "number" && Number.isInteger(rawPageIndex) && rawPageIndex >= 0
			? rawPageIndex
			: undefined;
	const albumId = readAlbumId(parsed);
	const runtime = await resolveRuntime(manager, albumId, response);
	if (!runtime) return;

	// 同一本书的对话串行执行；不同书互不阻塞。
	const execution = runtime.chatQueue.then(async () => {
		if (options.stream) {
			response.writeHead(200, {
				"cache-control": "no-store",
				"content-type": "application/x-ndjson; charset=utf-8",
				"x-accel-buffering": "no",
			});
			const write = (event: AlbumStreamEvent): void => {
				response.write(`${JSON.stringify(event)}\n`);
			};
			try {
				const result = await runAlbumChat(runtime, message, write, currentPageIndex);
				write({ type: "done", response: result });
			} catch (error) {
				write({ type: "error", error: error instanceof Error ? error.message : String(error) });
			} finally {
				response.end();
			}
			return;
		}
		try {
			const result = await runAlbumChat(runtime, message, undefined, currentPageIndex);
			sendJson(response, 200, result);
		} catch (error) {
			sendJson(response, 500, {
				error: error instanceof Error ? error.message : String(error),
				traces: runtime.traces.list(),
			});
		}
	});
	runtime.chatQueue = execution.catch(() => undefined);
	await execution;
}

async function handleLoadBook(
	manager: AlbumRuntimeManager,
	catalog: TemplateCatalog,
	request: IncomingMessage,
	response: ServerResponse,
): Promise<void> {
	const body = await readBody(request);
	try {
		const parsed = JSON.parse(body || "{}") as Record<string, unknown>;
		const albumId = readAlbumId(parsed);
		// 兼容两种形态：{albumId, book: {...}} 或直接就是书对象。
		const bookInput = isRecord(parsed.book) ? parsed.book : parsed;
		const { book, warnings } = parseAlbumBookInput(bookInput);
		// 文案一律原样装书，不做任何字数校验（模板已不声明字数上限）。版面装不下由渲染层
		// 的 fit-text 解决（固定高度的文字框自动缩字号），而不是砍掉用户/AI 写的字。
		// 结构性错误仍硬失败。
		const errors = validateAlbumBook(book, catalog);
		if (errors.length > 0) {
			sendJson(response, 422, { error: "book 契约不合法", details: errors });
			return;
		}
		await manager.loadBook(albumId, book);
		sendJson(response, 200, {
			ok: true,
			albumId,
			warnings,
			version: book.version,
		});
	} catch (error) {
		sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
	}
}

async function handleStatic(pathname: string, response: ServerResponse): Promise<void> {
	const filename = pathname === "/" ? "index.html" : pathname.slice(1);
	try {
		const content = await readFile(join(staticDir, filename), "utf8");
		sendText(response, 200, content, staticContentType(filename));
	} catch {
		sendJson(response, 404, { error: "not found" });
	}
}

function isAuthorized(request: IncomingMessage, sharedSecret: string | undefined): boolean {
	if (!sharedSecret) return true;
	const header = request.headers.authorization ?? "";
	return header === `Bearer ${sharedSecret}`;
}

export async function createAlbumAgentWebServer(options: AlbumAgentWebServerOptions = {}): Promise<Server> {
	const env = options.env ?? process.env;
	const sharedSecret = options.sharedSecret ?? env.DESIGN_AGENT_SHARED_SECRET ?? undefined;
	const deps = await createSharedDeps(options);

	let defaultBook: AlbumBookState | undefined;
	try {
		const bookRaw = JSON.parse(await readFile(options.bookPath ?? defaultBookPath, "utf8")) as unknown;
		const parsed = parseAlbumBookInput(bookRaw);
		const errors = validateAlbumBook(parsed.book, deps.catalog);
		if (errors.length > 0) throw new Error(errors.join("\n"));
		defaultBook = parsed.book;
	} catch (error) {
		if (options.bookPath) throw error; // 显式指定的书必须合法
		defaultBook = undefined; // fixture 缺失时 default 画布不可用，但服务照常启动
	}

	const manager = new AlbumRuntimeManager(deps, defaultBook);

	return createServer((request, response) => {
		void (async () => {
			const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
			if (url.pathname.startsWith("/api/") && !isAuthorized(request, sharedSecret)) {
				sendJson(response, 401, { error: "unauthorized" });
				return;
			}
			// 免鉴权健康探针（Fly http check 用；不在 /api/ 下，故不过 Bearer 门）。
			if (request.method === "GET" && url.pathname === "/health") {
				sendJson(response, 200, { status: "ok" });
				return;
			}
			if (request.method === "POST" && url.pathname === "/api/chat") {
				await handleAlbumChat(manager, request, response, {
					stream: url.searchParams.get("stream") === "1",
				});
				return;
			}
			if (request.method === "POST" && url.pathname === "/api/book") {
				await handleLoadBook(manager, deps.catalog, request, response);
				return;
			}
			if (request.method === "GET" && url.pathname === "/api/albums") {
				sendJson(response, 200, { albums: manager.listAlbums() });
				return;
			}
			if (request.method === "GET" && url.pathname === "/api/traces") {
				const runtime = await resolveRuntime(manager, readAlbumId(url), response);
				if (!runtime) return;
				sendJson(response, 200, { traces: runtime.traces.list() });
				return;
			}
			if (request.method === "GET" && url.pathname === "/api/state") {
				const runtime = await resolveRuntime(manager, readAlbumId(url), response);
				if (!runtime) return;
				sendJson(response, 200, {
					albumId: runtime.albumId,
					book: runtime.getBook(),
					artifact: { kind: "html", content: runtime.renderPreview() },
					traces: runtime.traces.list(),
				});
				return;
			}
			if (request.method === "GET" && url.pathname === "/preview") {
				const runtime = await resolveRuntime(manager, readAlbumId(url), response);
				if (!runtime) return;
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

export async function startAlbumAgentWebServer(options: AlbumAgentWebServerOptions = {}): Promise<Server> {
	const host = options.host ?? "127.0.0.1";
	const port = options.port ?? 8787;
	const server = await createAlbumAgentWebServer(options);
	await new Promise<void>((resolve) => {
		server.listen(port, host, resolve);
	});
	return server;
}

function parseCliOptions(args: string[]): AlbumAgentWebServerOptions {
	const options: AlbumAgentWebServerOptions = {};
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
		} else if (arg === "--book") {
			options.bookPath = args[++index];
		}
	}
	return options;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const options = parseCliOptions(process.argv.slice(2));
	const host = options.host ?? "127.0.0.1";
	const port = options.port ?? 8787;
	await startAlbumAgentWebServer(options);
	process.stdout.write(`Album Design Agent listening on http://${host}:${port}\n`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
