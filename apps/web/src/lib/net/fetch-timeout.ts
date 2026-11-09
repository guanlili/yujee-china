// 网络调用的统一截止时间工具。
//
// 2026-11-09 的两次线上实测都指向同一个模式:**请求会挂住** —— 既不成功也不报错,
// 浏览器一直 inflight。客户端代码里凡是 `await fetch(...)` 的地方,一旦挂住,
// 上层的重试/兜底/进度回调全都不会执行,用户看到的是一个永远不动的进度条或一个
// 永远正在转的按钮,比直接报错更难自查。
//
// 所以:凡是"用户会等"的对外请求,都要有截止时间。到点 abort,把挂住变成一个
// 真实的、可重试的失败,让上层既有的失败分支接管。

export class DeadlineError extends Error {
  constructor(
    readonly label: string,
    readonly ms: number,
  ) {
    super(`${label} exceeded ${ms}ms`);
    this.name = 'DeadlineError';
  }
}

/** 带截止时间的 fetch:到点 abort,抛 AbortError(调用方按既有 catch 处理)。 */
export async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  ms: number,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(input, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 给任意 promise 加截止(不是所有挂住的环节都能 abort,比如字体解析、离屏栅格化)。
 * 到点 reject 成 DeadlineError,让调用方走既有的失败/兜底分支;原 promise 的
 * 后续结果被丢弃(不是取消,但至少用户能脱身、能重试)。
 */
export function withDeadline<T>(promise: Promise<T>, ms: number, label = 'task'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new DeadlineError(label, ms)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** 是否由超时引起(用来把 abort/DeadlineError 归一成同一条失败码)。 */
export function isTimeoutError(e: unknown): boolean {
  if (e instanceof DeadlineError) return true;
  return e instanceof Error && e.name === 'AbortError';
}
