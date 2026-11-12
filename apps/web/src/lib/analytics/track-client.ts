'use client';

import {
  ANALYTICS_MAX_BATCH,
  sanitizeAnalyticsMessage,
  type AnalyticsEventPayload,
} from './events';

// 浏览器侧埋点。三条硬规则:
//  1. 埋点绝不能影响业务:任何异常都吞掉,不抛、不阻塞、不重试。
//  2. 少发请求:内存排队,10 条或 5 秒冲一次,页面隐藏/卸载时立刻冲。
//  3. 不采集身份:不带 localStorage 内容、不带页面正文、不带 URL query。
//
// 不用第三方:数据留在自己的库里,也不引入外部脚本 —— 这条和 CSP 的取向一致。

const ENDPOINT = '/api/v1/events';
const FLUSH_INTERVAL_MS = 5_000;

type QueueItem = AnalyticsEventPayload;

let queue: QueueItem[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let installed = false;
// 同类错误 60 秒只报一次:一个渲染循环里的错误能把表刷爆,而且行数并不能说明严重性
const errorDedupe = new Map<string, number>();
const ERROR_DEDUPE_MS = 60_000;

function schedule(): void {
  if (timer !== null) return;
  timer = setTimeout(() => {
    timer = null;
    flush();
  }, FLUSH_INTERVAL_MS);
}

export function flush(): void {
  if (queue.length === 0) return;
  const batch = queue.slice(0, ANALYTICS_MAX_BATCH);
  queue = queue.slice(batch.length);
  const body = JSON.stringify({ events: batch });

  try {
    // sendBeacon 在页面卸载时也可靠投递;失败再退回 keepalive fetch
    const beacon = typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function'
      ? navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }))
      : false;
    if (!beacon) {
      void fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => undefined);
    }
  } catch {
    // 埋点失败不影响任何功能
  }

  if (queue.length > 0) schedule();
}

export function track(name: QueueItem['name'], props: Omit<QueueItem, 'name'> = {}): void {
  if (typeof window === 'undefined') return;
  queue.push({ name, ...props });
  if (queue.length >= ANALYTICS_MAX_BATCH) {
    flush();
    return;
  }
  schedule();
}

function shouldReportError(key: string): boolean {
  const now = Date.now();
  const last = errorDedupe.get(key);
  if (last !== undefined && now - last < ERROR_DEDUPE_MS) return false;
  if (errorDedupe.size > 50) errorDedupe.clear();
  errorDedupe.set(key, now);
  return true;
}

// 前端错误上报(替代第三方错误监控):只记消息、来源文件、类型。
// 消息先脱敏(去 query、替换邮箱/长数字),再截断 —— 保证不把用户内容带进库里。
export function installAnalyticsErrorHooks(): void {
  if (typeof window === 'undefined' || installed) return;
  installed = true;

  window.addEventListener('error', (event) => {
    const message = sanitizeAnalyticsMessage(event.message || 'unknown error');
    if (!shouldReportError(message)) return;
    track('client_error', {
      result: 'fail',
      meta: {
        message,
        kind: 'error',
        source: (event.filename || '').split('/').pop()?.slice(0, 40) || 'inline',
      },
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const raw = reason instanceof Error ? reason.message : String(reason ?? 'unknown rejection');
    const message = sanitizeAnalyticsMessage(raw);
    if (!shouldReportError(`reject:${message}`)) return;
    track('client_error', {
      result: 'fail',
      meta: {
        message,
        kind: 'unhandledrejection',
      },
    });
  });

  // 页面不可见/卸载时立刻冲一次,别把最后几条留在内存里丢掉
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  window.addEventListener('pagehide', () => flush());
}
