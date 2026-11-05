'use client';

import { useEffect } from 'react';

/**
 * 根级兜底:root layout 本身崩溃时,[locale]/error.tsx 已经没有父 layout 可挂,
 * Next.js 渲染这个文件。它必须自带 <html>/<body>,且不能依赖任何 provider、
 * CSS 变量或 next-intl(此时都不可用)。文案用中英双行静态兜底,reset 重渲染。
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[global-error]', error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f5f5f5',
          color: '#111',
          fontFamily:
            'system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif',
        }}
      >
        <main
          style={{
            maxWidth: 420,
            width: '100%',
            margin: 24,
            padding: '40px 32px',
            background: '#fff',
            borderRadius: 16,
            boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.06)',
            textAlign: 'center',
          }}
        >
          <h1 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 800 }}>
            Something went wrong
          </h1>
          <p style={{ margin: '0 0 4px', fontSize: 15, color: '#333' }}>
            出了点问题，请重试。
          </p>
          <p style={{ margin: '0 0 24px', fontSize: 14, color: '#777' }}>
            We hit an unexpected error. Please try again.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              width: '100%',
              padding: '12px 20px',
              fontSize: 15,
              fontWeight: 600,
              color: '#fff',
              background: '#13B8A6',
              border: 'none',
              borderRadius: 999,
              cursor: 'pointer',
            }}
          >
            Try again · 重试
          </button>
        </main>
      </body>
    </html>
  );
}
