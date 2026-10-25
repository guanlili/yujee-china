import type { Metadata } from 'next';
import { getRequestLocale } from '@/lib/i18n/server-locale';
import { SITE_URL } from '@/lib/seo/site';
import '@/styles/globals.css';

// Display / heading typeface (DESIGN.md §3) was loaded via next/font/google
// (Bricolage Grotesque). That fetches from fonts.googleapis.com at compile time,
// which is unreachable behind the GFW and hangs every first compile. Disabled for
// local dev; --font-display in globals.css already falls back to system-ui.
// TODO: self-host the woff2 via next/font/local (download through a proxy) to
// restore the brand font without the network fetch.

export const metadata: Metadata = {
  // Resolves every relative canonical/OG URL against the apex rather than the
  // deployment host.
  metadataBase: new URL(SITE_URL),
  title: 'Yujee — Your AI Memoir',
  // Fallback for pages that don't set their own (auth, app surfaces). Kept
  // 120–160 chars — Bing flags shorter ones — and deliberately different from
  // the landing page's metaDesc so inheriting pages never duplicate it.
  description:
    'Yujee is an AI memoir studio: upload your photos, tell your story in chat, and turn them into a magazine-style keepsake you can export as a print-ready PDF.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Was hardcoded to "en", so /zh declared itself English to every crawler and
  // screen reader.
  const locale = await getRequestLocale();

  return (
    <html lang={locale}>
      <head>
        {/*
          crypto.randomUUID 只在安全上下文(HTTPS/localhost)存在 —— IP 明文 HTTP
          阶段(国内试点 http://<ip>:8080)它在 Chromium/Safari 全系 undefined,
          上传流程第一步(生成 photoId)就抛 TypeError,页面永远停在「正在处理」
          (2026-10-25 实测)。crypto.getRandomValues 不受此限,用它补一个等价的
          UUID v4;上了 HTTPS 后原生实现优先生效,polyfill 静默退位。
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
if (typeof crypto !== 'undefined' && !crypto.randomUUID) {
  crypto.randomUUID = function () {
    var b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var h = Array.prototype.map.call(b, function (x) {
      return ('0' + x.toString(16)).slice(-2);
    }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  };
}`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
