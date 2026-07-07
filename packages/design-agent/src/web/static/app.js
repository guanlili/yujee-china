import {
	createChatFinalText,
	createLlmCallSummary,
	createLlmTraceSections,
	createTimelineItem,
	createTokenSummary,
} from "./trace-presenter.js";

// ?albumId=<uuid> 时面板跟踪该相册的书与 trace（web 编辑器对话也记在这里）。
// 注意：从本面板直接发消息会绕过 Web 的落库——改动只进 Agent 画布，编辑器下一轮
// 对话会用 Postgres 的书覆盖它。看 trace 用，别当编辑入口。
const albumId = new URLSearchParams(location.search).get("albumId");
const albumQuery = albumId ? `albumId=${encodeURIComponent(albumId)}` : "";

const form = document.querySelector("#chat-form");
const promptInput = document.querySelector("#prompt");
const messages = document.querySelector("#messages");
const previewFrame = document.querySelector("#preview-frame");
const designMeta = document.querySelector("#design-meta");
const traces = document.querySelector("#traces");

function appendMessage(role, text) {
	const item = document.createElement("div");
	item.className = `message ${role}`;
	const label = document.createElement("strong");
	label.textContent = role === "user" ? "你" : "助手";
	const body = document.createElement("p");
	body.textContent = text;
	const steps = document.createElement("ul");
	steps.className = "timeline";
	steps.hidden = true;
	const timelineRows = new Map();
	let latestLlmCallIndex;
	item.append(label, steps, body);
	messages.append(item);
	messages.scrollTop = messages.scrollHeight;
	return {
		item,
		setText(nextText) {
			body.textContent = nextText;
			messages.scrollTop = messages.scrollHeight;
		},
		setTimelineEvent(event) {
			if (event.type === "llm_start") {
				latestLlmCallIndex = event.callIndex;
			} else if (latestLlmCallIndex !== undefined && event.type !== "llm_done") {
				this.setTimelineEvent({ type: "llm_done", callIndex: latestLlmCallIndex });
			}
			const timelineItem = createTimelineItem(event);
			if (!timelineItem) return;
			let row = timelineRows.get(timelineItem.id);
			if (!row) {
				row = document.createElement("li");
				row.className = "timeline-item";
				const icon = document.createElement("span");
				icon.className = "timeline-icon";
				const text = document.createElement("span");
				text.className = "timeline-text";
				const status = document.createElement("span");
				status.className = "timeline-status";
				row.append(icon, text, status);
				timelineRows.set(timelineItem.id, row);
				steps.append(row);
			}
			row.className = `timeline-item ${timelineItem.kind} ${timelineItem.status}`;
			row.querySelector(".timeline-icon").textContent = iconForTimelineItem(timelineItem);
			row.querySelector(".timeline-text").textContent = timelineItem.text;
			row.querySelector(".timeline-status").textContent = statusForTimelineItem(timelineItem);
			steps.hidden = false;
			messages.scrollTop = messages.scrollHeight;
		},
	};
}

function renderKeyValueList(items) {
	const list = document.createElement("dl");
	list.className = "key-values";
	for (const [key, value] of Object.entries(items)) {
		if (value === undefined) continue;
		const term = document.createElement("dt");
		term.textContent = labelForMetaKey(key);
		const description = document.createElement("dd");
		description.textContent = String(value);
		list.append(term, description);
	}
	return list;
}

function renderProviderMessage(message, title) {
	const details = document.createElement("details");
	details.className = `llm-message ${message.role}`;
	const summary = document.createElement("summary");
	const text = message.text || "";
	summary.textContent = title || `${message.index + 1}. ${labelForProviderRole(message.role)} · ${text.length} chars`;
	const pre = document.createElement("pre");
	pre.textContent = truncateText(text, 5000);
	details.append(summary, pre);
	return details;
}

function renderTokenSummary(trace) {
	const summary = createTokenSummary(trace);
	const container = document.createElement("div");
	container.className = "token-summary";
	if (!summary) {
		const empty = document.createElement("p");
		empty.textContent = "Token usage 未返回";
		container.append(empty);
		return container;
	}
	for (const item of [
		["输入", summary.inputTokens],
		["输出", summary.outputTokens],
		["总计", summary.totalTokens],
		["Reasoning", summary.reasoningTokens],
		["Cache read", summary.cacheReadTokens],
		["Cache write", summary.cacheWriteTokens],
		["输入费用", summary.inputCost],
		["输出费用", summary.outputCost],
		["缓存命中费用", summary.cacheReadCost],
		["费用合计", summary.totalCost],
	]) {
		const [label, value] = item;
		if (value === undefined) continue;
		const metric = document.createElement("div");
		metric.className = "token-metric";
		const valueNode = document.createElement("strong");
		valueNode.textContent = formatMetricValue(value);
		const labelNode = document.createElement("span");
		labelNode.textContent = label;
		metric.append(valueNode, labelNode);
		container.append(metric);
	}
	if (summary.pricing) {
		const pricing = document.createElement("p");
		pricing.className = "token-pricing";
		pricing.textContent = `单价：${summary.pricing}`;
		container.append(pricing);
	}
	return container;
}

function renderLlmTraceSections(trace) {
	const container = document.createElement("div");
	container.className = "llm-input-sections";
	const sections = createLlmTraceSections(trace);
	if (sections.length === 0) {
		const empty = document.createElement("p");
		empty.className = "empty-trace";
		empty.textContent = "没有 LLM 调用。";
		container.append(empty);
		return container;
	}

	for (const section of sections) {
		const call = document.createElement("details");
		call.className = "llm-call";
		const summary = document.createElement("summary");
		const callSummary = createLlmCallSummary(section);
		const outputLength = callSummary?.outputChars ?? 0;
		summary.className = "llm-call-summary";
		summary.textContent = callSummary?.label ?? section.title;
		call.append(summary);
		call.append(renderKeyValueList(section.meta));

		const inputTitle = document.createElement("div");
		inputTitle.className = "llm-subtitle";
		inputTitle.textContent = "输入";
		call.append(inputTitle);

		const inputList = document.createElement("div");
		inputList.className = "llm-message-list";
		for (const message of section.messages) {
			inputList.append(renderProviderMessage(message));
		}
		call.append(inputList);

		const outputTitle = document.createElement("div");
		outputTitle.className = "llm-subtitle";
		outputTitle.textContent = "输出";
		call.append(outputTitle);

		const outputList = document.createElement("div");
		outputList.className = "llm-message-list";
		if (section.output) {
			outputList.append(
				renderProviderMessage(section.output, `${labelForProviderRole(section.output.role)} · ${outputLength} chars`),
			);
		} else {
			const empty = document.createElement("p");
			empty.className = "empty-trace";
			empty.textContent = "没有捕获到输出。";
			outputList.append(empty);
		}
		call.append(outputList);
		container.append(call);
	}

	return container;
}

function renderTraces(items) {
	traces.replaceChildren();
	for (const [index, trace] of items.toReversed().entries()) {
		const group = document.createElement("details");
		group.className = "trace";
		group.open = index === 0;
		const summary = document.createElement("summary");
		summary.textContent = `第 ${trace.id} 轮：${trace.prompt}`;
		group.append(summary);
		group.append(renderTokenSummary(trace));
		group.append(renderLlmTraceSections(trace));
		traces.append(group);
	}
}

function refreshPreview() {
	previewFrame.src = `/preview?t=${Date.now()}${albumQuery ? `&${albumQuery}` : ""}`;
}

function renderDesignMeta(design) {
	if (!design) return;
	designMeta.textContent = `版本 ${design.version}`;
}

async function loadState() {
	const response = await fetch(`/api/state${albumQuery ? `?${albumQuery}` : ""}`);
	const payload = await response.json();
	if (!response.ok) {
		throw new Error(payload.error || "State request failed");
	}
	renderDesignMeta(payload.design ?? payload.book);
	renderTraces(payload.traces || []);
	refreshPreview();
}

form.addEventListener("submit", async (event) => {
	event.preventDefault();
	const prompt = promptInput.value.trim();
	if (!prompt) return;

	appendMessage("user", prompt);
	const pendingMessage = appendMessage("assistant", "处理中...");
	promptInput.value = "";
	designMeta.textContent = "处理中...";

	try {
		const response = await fetch("/api/chat?stream=1", {
			method: "POST",
			headers: { accept: "application/x-ndjson", "content-type": "application/json" },
			body: JSON.stringify({ message: prompt, ...(albumId ? { albumId } : {}) }),
		});
		if (!response.ok) {
			const payload = await response.json();
			throw new Error(payload.error || "Request failed");
		}
		await readNdjsonStream(response, (streamEvent) => {
			if (streamEvent.type === "started") {
				pendingMessage.setText("正在处理...");
				return;
			}
			if (
				streamEvent.type === "llm_start" ||
				streamEvent.type === "llm_done" ||
				streamEvent.type === "tool_call" ||
				streamEvent.type === "tool_result" ||
				streamEvent.type === "artifact_updated"
			) {
				pendingMessage.setTimelineEvent(streamEvent);
				return;
			}
			if (streamEvent.type === "assistant_final") {
				pendingMessage.setText(createChatFinalText({ assistant: { text: streamEvent.text }, traces: [] }));
				return;
			}
			if (streamEvent.type === "done") {
				const payload = streamEvent.response;
				renderDesignMeta(payload.design ?? payload.book);
				renderTraces(payload.traces);
				refreshPreview();
				return;
			}
			if (streamEvent.type === "error") {
				throw new Error(streamEvent.error || "Stream failed");
			}
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		pendingMessage.setText(`Error: ${message}`);
		designMeta.textContent = "错误";
	}
});

loadState().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	appendMessage("assistant", `Error: ${message}`);
});

function truncateText(value, maxLength) {
	if (value.length <= maxLength) return value;
	return `${value.slice(0, maxLength)}\n...[truncated ${value.length - maxLength} chars]`;
}

function formatTokenCount(value) {
	return new Intl.NumberFormat("en-US").format(value);
}

function formatMetricValue(value) {
	return typeof value === "number" ? formatTokenCount(value) : String(value);
}

function labelForMetaKey(key) {
	const labels = {
		model: "模型",
		stream: "流式",
		inputTokens: "输入 tokens",
		outputTokens: "输出 tokens",
		cacheReadTokens: "缓存命中 tokens",
		cacheWriteTokens: "缓存写入 tokens",
		totalTokens: "总 tokens",
		inputCost: "输入费用",
		outputCost: "输出费用",
		cacheReadCost: "缓存命中费用",
		totalCost: "费用合计",
		pricing: "单价",
		messageCount: "消息数",
	};
	return labels[key] ?? key;
}

function labelForProviderRole(role) {
	if (role === "system") return "System";
	if (role === "user") return "Task context";
	if (role === "assistant") return "Assistant";
	if (role === "tool") return "Tools";
	return role || "Unknown";
}

async function readNdjsonStream(response, onEvent) {
	if (!response.body) {
		throw new Error("Streaming response body is unavailable");
	}
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		buffer = consumeNdjsonLines(buffer, onEvent);
	}
	buffer += decoder.decode();
	consumeNdjsonLines(`${buffer}\n`, onEvent);
}

function consumeNdjsonLines(buffer, onEvent) {
	const lines = buffer.split("\n");
	const rest = lines.pop() ?? "";
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		onEvent(JSON.parse(trimmed));
	}
	return rest;
}

function iconForTimelineItem(item) {
	if (item.kind === "read") return "⌕";
	if (item.kind === "write") return "✎";
	if (item.kind === "artifact") return "□";
	if (item.kind === "llm") return "◎";
	return "•";
}

function statusForTimelineItem(item) {
	if (item.status === "done") return "done ✓";
	if (item.status === "error") return "error";
	return "running";
}
