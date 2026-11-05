'use client';

// safeFetchJSON: 客户端 fetch JSON 的统一收口。把三类常见失败 ——
//   1) HTTP 非 2xx;
//   2) 响应体不是合法 JSON;
//   3) 网络超时(AbortController);
// 全部归一为 `{ ok: false, error, message? }`,调用方不用再 try/catch + res.ok +
// res.json() 三连。成功时返回 `{ ok: true, data }`,data 由调用方传泛型收窄。
//
// 注意:本 helper 只做传输层容错,不解析业务信封 `{ok,data,error}` —— 业务错误
// (如 INVITE_CODE_INVALID)仍走 HTTP 200 + envelope ok:false,由调用方按 data 形状判。

export type SafeFetchError = {
  ok: false;
  /** 机器可读错误码:'non_json' | 'timeout' | 对应 HTTP status 文本 */
  error: string;
  /** 人类可读消息,来自 upstream error.message 或截断后的响应文本 */
  message?: string;
  /** HTTP 状态码(超时/非 JSON 时可能缺省) */
  status?: number;
};

export type SafeFetchJSONResult<T> =
  | { ok: true; data: T; status: number }
  | SafeFetchError;

export interface SafeFetchInit extends RequestInit {
  /** 超时毫秒,默认 15000。超时返回 { ok:false, error:'timeout' }。 */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export async function safeFetchJSON<T = unknown>(
  input: string,
  init: SafeFetchInit = {},
): Promise<SafeFetchJSONResult<T>> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...fetchInit } = init;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // 调用方自己传了 signal 的情况:代理 abort 到外部 signal(避免覆盖调用方意图)。
  if (fetchInit.signal) {
    const external = fetchInit.signal;
    if (external.aborted) controller.abort();
    else external.addEventListener('abort', () => controller.abort(), { once: true });
  }

  let res: Response;
  try {
    res = await fetch(input, { ...fetchInit, signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, error: 'timeout', message: `request timed out after ${timeoutMs}ms` };
    }
    return { ok: false, error: 'network_error', message: err instanceof Error ? err.message : String(err) };
  }
  clearTimeout(timer);

  const status = res.status;
  const contentType = res.headers.get('content-type') ?? '';
  const rawText = await res.text();

  if (!res.ok) {
    // 尝试从错误响应里抠出 message(我们的 API 信封是 {error:{code,message}})。
    let message: string | undefined;
    if (rawText) {
      try {
        const parsed = JSON.parse(rawText) as { error?: { message?: string } | string };
        if (parsed.error && typeof parsed.error === 'object' && typeof parsed.error.message === 'string') {
          message = parsed.error.message;
        } else if (typeof parsed.error === 'string') {
          message = parsed.error;
        }
      } catch {
        // 非 JSON 错误体:截断前 200 字当 message
        message = rawText.slice(0, 200);
      }
    }
    return { ok: false, error: `http_${status}`, message, status };
  }

  if (!rawText) {
    // 204/空体:按 unknown 空数据返回
    return { ok: true, data: undefined as T, status };
  }
  if (!contentType.includes('application/json')) {
    return {
      ok: false,
      error: 'non_json',
      message: `expected application/json, got ${contentType || 'empty'}`,
      status,
    };
  }

  try {
    const data = JSON.parse(rawText) as T;
    return { ok: true, data, status };
  } catch {
    return { ok: false, error: 'non_json', message: 'response body is not valid JSON', status };
  }
}
