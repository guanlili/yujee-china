import { getEmailCopy } from './copy';
import { escapeHtml, renderButton, renderShell, type EmailLocale, type RenderedEmail } from './shared';

type OrderReceiptEmailInput = {
  locale: EmailLocale;
  orderId: string;
  amountLabel: string;
  albumTitle?: string | null;
  receiptUrl?: string | null;
};

export function renderOrderReceiptEmail(input: OrderReceiptEmailInput): RenderedEmail {
  const t = getEmailCopy(input.locale).order;
  const rows = [
    [t.orderId, input.orderId],
    [t.amount, input.amountLabel],
    input.albumTitle ? [t.album, input.albumTitle] : null,
  ].filter((row): row is [string, string] => row !== null);

  const table = rows
    .map(([label, value]) => (
      '<tr>' +
      `<td style="padding:8px 0;color:#64748b;">${escapeHtml(label)}</td>` +
      `<td style="padding:8px 0;text-align:right;font-weight:700;">${escapeHtml(value)}</td>` +
      '</tr>'
    ))
    .join('');

  const html = renderShell(
    t.title,
    [
      `<p style="font-size:16px;line-height:1.6;margin:0 0 14px;">${escapeHtml(t.body)}</p>`,
      `<table style="width:100%;border-collapse:collapse;margin:18px 0;">${table}</table>`,
      input.receiptUrl ? renderButton(t.button, input.receiptUrl) : '',
      `<p style="font-size:13px;color:#64748b;line-height:1.6;margin:14px 0 0;">${escapeHtml(t.footer)}</p>`,
    ].join(''),
  );

  const text = [
    t.title,
    '',
    t.body,
    ...rows.map(([label, value]) => `${label}: ${value}`),
    input.receiptUrl ? `${t.button}: ${input.receiptUrl}` : '',
    t.footer,
  ].filter(Boolean).join('\n');

  return { subject: t.subject, html, text };
}
