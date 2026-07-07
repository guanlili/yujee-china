const TOKEN_PRICING_CNY_PER_1K = Object.freeze({
	input: 0.012,
	output: 0.024,
	cacheRead: 0.001,
});
const TOKEN_PRICING_LABEL = "输入 ¥0.012/千 tokens · 输出 ¥0.024/千 tokens · 缓存命中 ¥0.001/千 tokens";

export function createLlmInputSections(trace) {
	const payloads = Array.isArray(trace?.requestPayloads) ? trace.requestPayloads : [];
	const providerPayloads = payloads.filter(isProviderPayload);
	return providerPayloads.map((payload, index) => {
		const model = String(payload.model);
		const messages = payload.messages.map((message, messageIndex) => normalizeProviderMessage(message, messageIndex));
		return {
			title: `LLM 调用 ${index + 1} · ${model}`,
			model,
			messages,
			raw: payload,
			meta: createProviderMeta(payload, usageForProviderCall(trace, index, providerPayloads.length)),
		};
	});
}

export function createLlmTraceSections(trace) {
	const payloads = Array.isArray(trace?.requestPayloads) ? trace.requestPayloads : [];
	const providerPayloads = payloads.filter(isProviderPayload);
	return createLlmInputSections(trace).map((section, index) => ({
		...section,
		output: outputForProviderCall(trace, index, providerPayloads),
	}));
}

export function createLlmCallSummary(section) {
	if (!section) return undefined;
	const roleCounts = countProviderRoles(section.messages);
	const inputMessageCount = section.messages.length;
	const outputMessageCount = section.output ? 1 : 0;
	const inputChars = section.messages.reduce((sum, message) => sum + message.text.length, 0);
	const outputChars = section.output?.text.length ?? 0;
	const roleSummary = formatRoleCounts(roleCounts);
	const tokenSummary = formatCallTokenSummary(section.meta);
	const labelParts = [
		section.title,
		`输入 ${inputMessageCount} 条`,
		roleSummary,
		`输出 ${outputMessageCount} 条 / ${outputChars} chars`,
		tokenSummary,
	].filter(Boolean);
	return {
		label: labelParts.join(" · "),
		inputMessageCount,
		outputMessageCount,
		inputChars,
		outputChars,
		roleCounts,
	};
}

export function createTokenSummary(trace) {
	const usage = usageForTrace(trace);
	if (!usage) return undefined;
	const inputTokens = readNumber(usage.input);
	const outputTokens = readNumber(usage.output);
	const totalTokens = readNumber(usage.totalTokens);
	if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) return undefined;
	const cost = createUsageCost(usage);
	return {
		inputTokens,
		outputTokens,
		reasoningTokens: readNumber(usage.reasoning),
		cacheReadTokens: readNumber(usage.cacheRead),
		cacheWriteTokens: readNumber(usage.cacheWrite),
		totalTokens,
		...cost,
	};
}

export function createConversationSteps(trace) {
	return createNonProviderInputEvents(trace).flatMap((event) => {
		if (!isRecord(event)) return [];
		if (event.type === "tool_call") {
			return [`调用工具：${String(event.toolName ?? "unknown")}`];
		}
		if (event.type === "tool_result") {
			const status = event.isError ? "工具失败" : "工具完成";
			const version = isRecord(event.details) && typeof event.details.version === "number" ? `，版本 ${event.details.version}` : "";
			return [`${status}：${String(event.toolName ?? "unknown")}${version}`];
		}
		if (event.type === "design_demo_state") {
			if (!event.committed) return ["画板未更新"];
			const version = isRecord(event.design) && typeof event.design.version === "number" ? `：版本 ${event.design.version}` : "";
			return [`画板已更新${version}`];
		}
		return [];
	});
}

export function createTimelineItem(event) {
	if (!isRecord(event)) return undefined;
	if (event.type === "llm_start") {
		return {
			id: `llm:${readNumber(event.callIndex) ?? "current"}`,
			kind: "llm",
			status: "running",
			text: "AI 正在分析",
		};
	}
	if (event.type === "llm_done") {
		return {
			id: `llm:${readNumber(event.callIndex) ?? "current"}`,
			kind: "llm",
			status: event.status === "error" ? "error" : "done",
			text: "AI 完成分析",
		};
	}
	if (event.type === "tool_call") {
		const toolName = typeof event.toolName === "string" ? event.toolName : "unknown";
		return {
			id: `tool:${typeof event.toolCallId === "string" ? event.toolCallId : toolName}`,
			kind: kindForTool(toolName),
			status: "running",
			text: labelForTool(toolName),
		};
	}
	if (event.type === "tool_result") {
		const toolName = typeof event.toolName === "string" ? event.toolName : "unknown";
		return {
			id: `tool:${typeof event.toolCallId === "string" ? event.toolCallId : toolName}`,
			kind: kindForTool(toolName),
			status: event.isError ? "error" : "done",
			text: labelForTool(toolName),
		};
	}
	if (event.type === "artifact_updated") {
		const version = readNumber(event.version);
		return {
			id: `artifact:${version ?? "current"}`,
			kind: "artifact",
			status: event.committed === false ? "error" : "done",
			text: version === undefined ? "画板已更新" : `画板已更新 · 版本 ${version}`,
		};
	}
	return undefined;
}

export function createChatFinalText(payload) {
	const assistantText = compactAssistantText(payload?.assistant?.text || "");
	if (assistantText) return assistantText;
	const trace = latestTrace(payload?.traces);
	if (traceHasCommittedArtifact(trace)) {
		return traceUsedTool(trace, "replace_artifact_range") ? "这个部分已经做好了。" : "画好了。";
	}
	return "已完成。";
}

export function createNonProviderInputEvents(trace) {
	const payloads = Array.isArray(trace?.requestPayloads) ? trace.requestPayloads : [];
	return payloads.filter((payload) => !isProviderPayload(payload));
}

export function createTraceEventSummaries(trace) {
	return createNonProviderInputEvents(trace).map((event) => {
		if (!isRecord(event)) {
			return { kind: "event", label: "Runtime event", detail: stringify(event), raw: event };
		}
		if (event.type === "design_demo_input") {
			const message = typeof event.userMessage === "string" ? event.userMessage : "";
			return {
				kind: "input",
				label: "用户输入",
				detail: `${message.length} chars · ${message.slice(0, 80)}`,
				raw: event,
			};
		}
		if (event.type === "before_agent_start") {
			return {
				kind: "agent",
				label: "Agent prompt",
				detail: `prompt ${textLength(event.prompt)} chars · system ${textLength(event.systemPrompt)} chars`,
				raw: event,
			};
		}
		if (event.type === "context") {
			const messages = Array.isArray(event.messages) ? event.messages : [];
			return {
				kind: "context",
				label: "会话上下文",
				detail: `${messages.length} messages`,
				raw: event,
			};
		}
		if (event.type === "tool_call") {
			return {
				kind: "tool_call",
				label: `Tool call · ${String(event.toolName ?? "unknown")}`,
				detail: compactInline(event.input),
				raw: event,
			};
		}
		if (event.type === "tool_result") {
			return {
				kind: "tool_result",
				label: `Tool result · ${String(event.toolName ?? "unknown")}`,
				detail: `${event.isError ? "error" : "ok"} · ${compactInline(event.details)}`,
				raw: event,
			};
		}
		if (event.type === "design_demo_state") {
			const operations = Array.isArray(event.operations) ? event.operations.join(", ") : "none";
			const version = isRecord(event.design) ? event.design.version : undefined;
			const htmlLength = isRecord(event.design) ? textLength(event.design.artifactHtml) : 0;
			return {
				kind: "artifact",
				label: "Artifact commit",
				detail: `operations ${operations || "none"} · version ${version ?? "unknown"} · html ${htmlLength} chars · committed ${Boolean(event.committed)}`,
				raw: event,
			};
		}
		return {
			kind: String(event.type ?? "event"),
			label: String(event.type ?? "Runtime event"),
			detail: Object.keys(event).join(", "),
			raw: event,
		};
	});
}

export function compactTraceValue(value, options = {}) {
	const maxStringLength = options.maxStringLength ?? 2000;
	const maxArrayLength = options.maxArrayLength ?? 30;
	const maxDepth = options.maxDepth ?? 8;
	return compactValue(value, { maxStringLength, maxArrayLength, maxDepth }, 0);
}

function isProviderPayload(payload) {
	return isRecord(payload) && typeof payload.model === "string" && Array.isArray(payload.messages);
}

function normalizeProviderMessage(message, index) {
	if (!isRecord(message)) {
		return {
			index,
			role: "unknown",
			text: stringify(message),
			raw: message,
		};
	}
	const text = providerContentToText(message.content);
	const toolCallNames = Array.isArray(message.tool_calls)
		? message.tool_calls.map((toolCall) => toolCall?.function?.name).filter((name) => typeof name === "string")
		: [];
	return {
		index,
		role: typeof message.role === "string" ? message.role : "unknown",
		text: text || (toolCallNames.length > 0 ? `Tool calls: ${toolCallNames.join(", ")}` : ""),
		raw: message,
	};
}

function normalizeAssistantMessage(message) {
	if (!isRecord(message)) return undefined;
	return {
		index: 0,
		role: typeof message.role === "string" ? message.role : "assistant",
		text: providerContentToText(message.content),
		raw: message,
	};
}

function outputForProviderCall(trace, index, providerPayloads) {
	const nextPayload = providerPayloads[index + 1];
	if (nextPayload) {
		const currentMessageCount = providerPayloads[index]?.messages.length ?? 0;
		const outputMessage = nextPayload.messages
			.slice(currentMessageCount)
			.find((message) => isRecord(message) && message.role === "assistant");
		return outputMessage ? normalizeProviderMessage(outputMessage, 0) : undefined;
	}
	return normalizeAssistantMessage(trace?.assistantMessage);
}

function providerContentToText(content) {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content.map(providerContentPartToText).filter(Boolean).join("\n\n");
	}
	if (content === undefined || content === null) return "";
	return stringify(content);
}

function providerContentPartToText(part) {
	if (!isRecord(part)) return stringify(part);
	if (typeof part.thinking === "string") return `[thinking]\n${part.thinking}`;
	if (typeof part.text === "string") return part.text;
	if (typeof part.input_text === "string") return part.input_text;
	if (typeof part.content === "string") return part.content;
	return stringify(part);
}

function createProviderMeta(payload, usage) {
	const cost = createUsageCost(usage);
	return {
		model: typeof payload.model === "string" ? payload.model : undefined,
		stream: typeof payload.stream === "boolean" ? payload.stream : undefined,
		inputTokens: usage?.input,
		outputTokens: usage?.output,
		cacheReadTokens: usage?.cacheRead,
		cacheWriteTokens: usage?.cacheWrite,
		totalTokens: usage?.totalTokens,
		...cost,
		messageCount: Array.isArray(payload.messages) ? payload.messages.length : 0,
	};
}

function countProviderRoles(messages) {
	const counts = {
		system: 0,
		user: 0,
		assistant: 0,
		tool: 0,
		other: 0,
	};
	for (const message of messages) {
		if (message.role === "system") counts.system += 1;
		else if (message.role === "user") counts.user += 1;
		else if (message.role === "assistant") counts.assistant += 1;
		else if (message.role === "tool") counts.tool += 1;
		else counts.other += 1;
	}
	return counts;
}

function formatRoleCounts(counts) {
	return [
		["System", counts.system],
		["Task context", counts.user],
		["Assistant", counts.assistant],
		["Tools", counts.tool],
		["Other", counts.other],
	]
		.filter(([, count]) => count > 0)
		.map(([label, count]) => `${label} ${count}`)
		.join(" / ");
}

function formatCallTokenSummary(meta) {
	const parts = [];
	if (meta?.inputTokens !== undefined) parts.push(`输入 ${formatNumber(meta.inputTokens)}`);
	if (meta?.outputTokens !== undefined) parts.push(`输出 ${formatNumber(meta.outputTokens)}`);
	if (meta?.totalTokens !== undefined) parts.push(`总计 ${formatNumber(meta.totalTokens)}`);
	if (meta?.totalCost !== undefined) parts.push(`费用 ${meta.totalCost}`);
	return parts.length > 0 ? `Tokens ${parts.join(" / ")}` : "";
}

function usageForProviderCall(trace, index, providerCallCount) {
	const assistantMessage = Array.isArray(trace?.assistantMessages) ? trace.assistantMessages[index] : undefined;
	if (isRecord(assistantMessage?.usage)) {
		return normalizeUsage(assistantMessage.usage);
	}
	if (providerCallCount !== 1 && index !== providerCallCount - 1) return undefined;
	const usage = trace?.assistantMessage?.usage;
	if (!isRecord(usage)) return undefined;
	return normalizeUsage(usage);
}

function usageForTrace(trace) {
	const assistantMessages = Array.isArray(trace?.assistantMessages) ? trace.assistantMessages : [];
	const usages = assistantMessages
		.map((message) => (isRecord(message?.usage) ? normalizeUsage(message.usage) : undefined))
		.filter(Boolean);
	if (usages.length > 0) return aggregateUsages(usages);
	const usage = trace?.assistantMessage?.usage;
	return isRecord(usage) ? normalizeUsage(usage) : undefined;
}

function aggregateUsages(usages) {
	const result = {};
	for (const key of ["input", "output", "reasoning", "cacheRead", "cacheWrite", "totalTokens"]) {
		let sum = 0;
		let seen = false;
		for (const usage of usages) {
			const value = readNumber(usage[key]);
			if (value === undefined) continue;
			sum += value;
			seen = true;
		}
		if (seen) result[key] = sum;
	}
	return result;
}

function normalizeUsage(usage) {
	return {
		input: readNumber(usage.input),
		output: readNumber(usage.output),
		reasoning: readNumber(usage.reasoning),
		cacheRead: readNumber(usage.cacheRead),
		cacheWrite: readNumber(usage.cacheWrite),
		totalTokens: readNumber(usage.totalTokens),
	};
}

function createUsageCost(usage) {
	if (!usage) return {};
	const inputTokens = readNumber(usage.input);
	const outputTokens = readNumber(usage.output);
	const cacheReadTokens = readNumber(usage.cacheRead);
	if (inputTokens === undefined && outputTokens === undefined && cacheReadTokens === undefined) return {};
	const inputCost = ((inputTokens ?? 0) / 1000) * TOKEN_PRICING_CNY_PER_1K.input;
	const outputCost = ((outputTokens ?? 0) / 1000) * TOKEN_PRICING_CNY_PER_1K.output;
	const cacheReadCost = ((cacheReadTokens ?? 0) / 1000) * TOKEN_PRICING_CNY_PER_1K.cacheRead;
	return {
		inputCost: formatCurrency(inputCost),
		outputCost: formatCurrency(outputCost),
		cacheReadCost: formatCurrency(cacheReadCost),
		totalCost: formatCurrency(inputCost + outputCost + cacheReadCost),
		pricing: TOKEN_PRICING_LABEL,
	};
}

function readNumber(value) {
	return typeof value === "number" ? value : undefined;
}

function formatNumber(value) {
	return new Intl.NumberFormat("en-US").format(value);
}

function formatCurrency(value) {
	return `¥${value.toFixed(6)}`;
}

function kindForTool(toolName) {
	if (
		toolName === "read_artifact" ||
		toolName === "read_full_artifact" ||
		toolName === "get_artifact_summary" ||
		toolName === "search_artifact"
	) {
		return "read";
	}
	if (toolName === "replace_artifact" || toolName === "replace_artifact_range") return "write";
	return "tool";
}

function labelForTool(toolName) {
	if (toolName === "get_artifact_summary") return "查看当前页面";
	if (toolName === "read_artifact") return "读取画板内容";
	if (toolName === "read_full_artifact") return "读取完整画板";
	if (toolName === "search_artifact") return "查找画板内容";
	if (toolName === "replace_artifact") return "更新画板 · Replace all";
	if (toolName === "replace_artifact_range") return "更新画板 · Replace range";
	return `调用工具 · ${toolName}`;
}

function compactValue(value, options, depth) {
	if (typeof value === "string") return compactString(value, options.maxStringLength);
	if (!isRecord(value) && !Array.isArray(value)) return value;
	if (depth >= options.maxDepth) return "[truncated: max depth]";
	if (Array.isArray(value)) {
		const items = value.slice(0, options.maxArrayLength).map((item) => compactValue(item, options, depth + 1));
		if (value.length > options.maxArrayLength) {
			items.push(`[truncated: ${value.length - options.maxArrayLength} more items]`);
		}
		return items;
	}
	const result = {};
	for (const [key, child] of Object.entries(value)) {
		result[key] = compactValue(child, options, depth + 1);
	}
	return result;
}

function compactString(value, maxLength) {
	if (value.length <= maxLength) return value;
	const omitted = value.length - maxLength;
	return `${value.slice(0, maxLength)}\n...[truncated ${omitted} chars]`;
}

function textLength(value) {
	return typeof value === "string" ? value.length : 0;
}

function compactInline(value) {
	const text = stringify(compactTraceValue(value, { maxStringLength: 160, maxArrayLength: 6, maxDepth: 3 }));
	return text.length > 240 ? `${text.slice(0, 240)}...` : text;
}

function stringify(value) {
	const text = JSON.stringify(value, null, 2);
	return typeof text === "string" ? text : String(value);
}

function latestTrace(items) {
	return Array.isArray(items) && items.length > 0 ? items[items.length - 1] : undefined;
}

function traceHasCommittedArtifact(trace) {
	return Boolean(
		trace?.requestPayloads?.some(
			(event) => event?.type === "design_demo_state" && event.committed && event.design?.artifactHtml,
		),
	);
}

function traceUsedTool(trace, toolName) {
	return Boolean(trace?.requestPayloads?.some((event) => event?.type === "tool_call" && event.toolName === toolName));
}

function compactAssistantText(text) {
	const withoutArtifact = text.replace(/<artifact\b[^>]*>[\s\S]*?<\/artifact>/gi, "").trim();
	const firstParagraph = withoutArtifact
		.split(/\n{2,}/)
		.map((part) => part.trim())
		.find(Boolean);
	if (!firstParagraph) return "";
	return firstParagraph.length > 220 ? `${firstParagraph.slice(0, 220)}...` : firstParagraph;
}

function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
