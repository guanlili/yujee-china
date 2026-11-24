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
  // register 会在 Node 和 Edge 两个 runtime 各跑一次。我们只关心 Node(API route、
  // server action、RSC);Edge 只有 middleware,init 了也只是让每次部署多发一条
  // 重复事件(2026-11-24 实测:同一次部署收到 node/edge 两条 boot)。
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENV ?? process.env.NODE_ENV,
    release: process.env.SENTRY_RELEASE,
    // 只做错误追踪,不开 tracing(自建实例不需要事务数据,开了只会灌库)
    tracesSampleRate: 0,
    // Next 内部的 abort/redirect 控制流异常不算错误
    ignoreErrors: ['NEXT_REDIRECT', 'NEXT_NOT_FOUND'],
  });

  // 链路自检:默认关闭。GlitchTip 会把 message 事件也建成 issue,常驻开着等于
  // 每次部署往面板塞一条"错误"。需要排查上报链路时临时在 env 里设
  // SENTRY_BOOT_PROBE=1 重启即可(2026-11-24 已用它验证过整条链路)。
  if (process.env.SENTRY_BOOT_PROBE === '1') {
    void Sentry.captureMessage(
      `[boot] web 上线 release=${process.env.SENTRY_RELEASE ?? 'unknown'}`,
      'info',
    );
  }
}

// App Router 的服务端异常统一入口(Next 15 约定)。
export const onRequestError = Sentry.captureRequestError;
