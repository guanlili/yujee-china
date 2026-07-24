'use client';

/* 移动端编辑器预览的「手机外壳」:电脑上直接打开就是 390×844 的手机比例,
   不用开 DevTools 切视口。真机请直接访问 /dev/mobile/frame。 */

import { use } from 'react';

import { defaultLocale, isLocale, type Locale } from '@/lib/i18n/routing';

export default function DevMobileShell({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = use(params);
  const locale: Locale = isLocale(raw) ? raw : defaultLocale;
  const src = `/${locale}/dev/mobile/frame`;

  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        padding: 24,
        background: '#14131a',
        color: '#cfcabb',
        fontFamily: "'Noto Sans SC', sans-serif",
      }}
    >
      <div style={{ fontSize: 13, letterSpacing: '.08em', opacity: 0.75 }}>
        DEV 预览 · 移动端编辑器(样例数据,非最终视觉稿)
      </div>
      <div
        style={{
          width: 390,
          height: 844,
          maxHeight: '82dvh',
          borderRadius: 40,
          border: '10px solid #000',
          overflow: 'hidden',
          boxShadow: '0 30px 80px rgba(0,0,0,.55)',
          background: '#000',
        }}
      >
        <iframe
          src={src}
          title="移动端编辑器预览"
          style={{ width: '100%', height: '100%', border: 0, display: 'block' }}
        />
      </div>
      <div style={{ fontSize: 12, opacity: 0.55 }}>
        真机直接开：<code>/{locale}/dev/mobile/frame</code>
      </div>
    </div>
  );
}
