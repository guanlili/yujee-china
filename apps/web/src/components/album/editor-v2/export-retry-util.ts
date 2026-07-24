// Pure 导出失败重试逻辑(WP5.3 / §4.5d),split out of EditorPort.tsx so the
// retry / counting / logging contract can be unit-tested under `tsx --test`
// without importing the JSX/React component tree (same pattern as
// export-gate-util.ts / zoom-util.ts).
//
// 需求(§4.5d):出 PDF / 上传 R2 失败时,前端**自动重试,最多 3 次**;**连续 3 次
// 失败**触发:① 弹安抚弹框 ② 记录错误日志(当前阶段只到这一步)。失败**不涉及积分**
// (积分早在 init 成功时已实扣,导出既不扣也不退;本模块刻意不引用任何 creditService)。
//
// 飞书服务台推送 = 后置(§4.5d):**当前只做日志,不实现飞书推送**。方案已记录在需求
// §4.5d(走飞书自定义机器人 Webhook、薄 route + lib、HMAC 签名、脱敏 + 截断、带 env
// 字段),上线后视真实失败率再加。**本任务不新建任何飞书 route/lib/调用**;onExhausted
// 的调用点(EditorPort.exportPdf)只 logger.error 落日志,届时在那一处加一次告警端点调用即可。

// 自动重试的上限:连续失败满 3 次才算"导出失败"(§4.5d「最多 3 次」)。
export const MAX_EXPORT_ATTEMPTS = 3;

// §3 隐私:错误日志**不得记** base64 图片数据 / GPS / place。只记必要的非敏感信息:
// 失败环节(render = 本地出 PDF / upload = R2 上传)、HTTP 状态码、相册 id、
// 白名单 reason code、第几次尝试。
export type ExportFailurePhase = 'render' | 'upload';

export class ExportError extends Error {
  readonly phase: ExportFailurePhase;
  readonly status?: number;
  constructor(phase: ExportFailurePhase, message: string, status?: number) {
    super(message);
    this.name = 'ExportError';
    this.phase = phase;
    this.status = status;
  }
}

// 失败归类的**封闭词表**(#307):`render_failed` 这一个 reason 说明不了任何问题
// (2026-07-24 生产事故:线上导出连挂 3 次,日志里只有 render_failed,无从下手)。
// §3 隐私仍是硬红线,所以**绝不**把 message 原文或"脱敏后的原文"写进日志 ——
// 地名/坐标不可预测,正则兜不住。改成把 message 匹配成下面这几个固定 code:
// 词表封闭 ⇒ 用户数据在结构上就不可能泄漏,同时线上一眼能看出是哪一类失败。
// 认不出的一律 'other'(绝不回落成原文)。新增类别请只加常量,别改成透传。
export type ExportFailureCode =
  | 'stale_bundle'
  | 'canvas_unavailable'
  | 'image_decode_failed'
  | 'canvas_too_large'
  | 'photo_missing'
  | 'network'
  | 'other';

const FAILURE_PATTERNS: [RegExp, ExportFailureCode][] = [
  // 必须排在 network 前面:两者措辞重叠("failed to fetch..."),但补救办法完全不同 ——
  // 陈旧构建包要的是提示用户刷新,重试再多次也没用(旧 chunk 不会回到 CDN)。
  [/dynamically imported module|importing a module script|chunkloaderror|loading chunk .* failed/i, 'stale_bundle'],
  [/canvas context unavailable/i, 'canvas_unavailable'],
  [/could not decode stored photo|decode failed|bitmap decode/i, 'image_decode_failed'],
  [/exceeds the maximum|canvas (area|size)|out of memory|allocation (failed|size)/i, 'canvas_too_large'],
  [/photo (not found|missing)|no such photo/i, 'photo_missing'],
  [/network|fetch failed|load failed|ERR_/i, 'network'],
];

export function classifyExportFailure(err: unknown): ExportFailureCode {
  const message = err instanceof Error ? err.message : '';
  for (const [pattern, code] of FAILURE_PATTERNS) {
    if (pattern.test(message)) return code;
  }
  return 'other';
}

// 把任意错误规整成「只含非敏感字段」的日志负载。刻意只保留枚举/状态码/相册 id/
// 白名单 reason/次数 —— 永不展开原始对象或 message(避免 base64 / GPS / place 混入,§3)。
export function buildExportFailureLog(
  err: unknown,
  ctx: { albumId: string; attempts: number },
): {
  event: 'pdf_export_failed';
  albumId: string;
  phase: ExportFailurePhase | 'unknown';
  status?: number;
  attempts: number;
  reason: string;
  failureCode: ExportFailureCode;
} {
  const phase: ExportFailurePhase | 'unknown' =
    err instanceof ExportError ? err.phase : 'unknown';
  const status = err instanceof ExportError ? err.status : undefined;
  const reason =
    err instanceof ExportError
      ? err.phase === 'upload' && status !== undefined
        ? `upload_http_${status}`
        : `${err.phase}_failed`
      : 'unknown_error';
  return {
    event: 'pdf_export_failed',
    albumId: ctx.albumId,
    phase,
    ...(status !== undefined ? { status } : {}),
    attempts: ctx.attempts,
    reason,
    failureCode: classifyExportFailure(err),
  };
}

export type RetryResult =
  | { ok: true; attempts: number }
  | { ok: false; attempts: number; lastError: unknown };

// 自动重试 ≤ MAX_EXPORT_ATTEMPTS 次的纯逻辑。
//   • attempt() 成功(resolve)→ 立即停,返回 { ok:true, attempts: 该次次数 }。
//   • attempt() 抛错 → 计数 +1,未满上限则再试;满上限(连续 maxAttempts 次失败)→
//     调一次 onExhausted(lastError, attempts) 并返回 { ok:false }。
// onExhausted **恰好调用一次**(只在第 maxAttempts 次仍失败时),成功路径绝不调用。
// 不在此引入定时器/退避以保持可测;调用方若要退避可在 attempt 内自理。
export async function runExportWithRetry(
  attempt: (attemptNo: number) => Promise<void>,
  opts: {
    maxAttempts?: number;
    onExhausted: (lastError: unknown, attempts: number) => void;
  },
): Promise<RetryResult> {
  const maxAttempts = opts.maxAttempts ?? MAX_EXPORT_ATTEMPTS;
  let lastError: unknown;
  for (let n = 1; n <= maxAttempts; n++) {
    try {
      await attempt(n);
      return { ok: true, attempts: n };
    } catch (e) {
      lastError = e;
    }
  }
  opts.onExhausted(lastError, maxAttempts);
  return { ok: false, attempts: maxAttempts, lastError };
}
