import type { Locale } from '@/lib/i18n/routing';

export type RenderedEmail = {
  subject: string;
  html: string;
  text: string;
};

export type EmailLocale = Locale;

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderShell(title: string, body: string): string {
  return [
    '<!doctype html>',
    '<html>',
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>',
    '<body style="margin:0;background:#f7f4ef;font-family:Arial,sans-serif;color:#1f2933;">',
    '<main style="max-width:560px;margin:0 auto;padding:32px 20px;">',
    '<section style="background:#ffffff;border:1px solid #e5ded4;border-radius:8px;padding:32px;">',
    '<p style="font-size:24px;font-weight:700;margin:0 0 28px;">Yujee</p>',
    `<h1 style="font-size:24px;line-height:1.3;margin:0 0 18px;">${escapeHtml(title)}</h1>`,
    body,
    '<hr style="border:none;border-top:1px solid #e5ded4;margin:28px 0;">',
    '<p style="font-size:13px;color:#64748b;margin:0;">Yujee Team</p>',
    '</section>',
    '</main>',
    '</body>',
    '</html>',
  ].join('');
}

export function renderButton(label: string, href: string): string {
  return [
    `<a href="${escapeHtml(href)}"`,
    ' style="display:inline-block;background:#1f2933;color:#ffffff;text-decoration:none;',
    'border-radius:999px;padding:12px 22px;font-weight:700;margin:16px 0;">',
    escapeHtml(label),
    '</a>',
  ].join('');
}
