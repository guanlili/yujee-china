// 错误上报（自建 GlitchTip,协议与 Sentry 兼容）。
// 只在 Server 侧接入:instrumentation.ts 的 register 会在 Node/Edge runtime 启动时跑,
// onRequestError 拿到 App Router 里未捕获的服务端异常(API route、server action、RSC 渲染)。
// 浏览器侧暂不接 —— 先跑一周看服务端噪音量,再决定客户端要不要开 tunnelRoute。
//
// DSN 从环境变量来,没配就完全不初始化(本地开发/CI 保持零副作用)。
// release 由部署时注入的 SENTRY_RELEASE(commit sha)标记,便于"修完这一版还有没有"。
import * as Sentry from '@sentry/nextjs';

export function register() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENV ?? process.env.NODE_ENV,
    release: process.env.SENTRY_RELEASE,
    // 只做错误追踪,不开 tracing(自建实例不需要事务数据,开了只会灌库)
    tracesSampleRate: 0,
    // Next 内部的 abort/redirect 控制流异常不算错误
    ignoreErrors: ['NEXT_REDIRECT', 'NEXT_NOT_FOUND'],
  });
}

// App Router 的服务端异常统一入口(Next 15 约定)。
export const onRequestError = Sentry.captureRequestError;
