import { escapeHtml, renderButton, renderShell, type EmailLocale, type RenderedEmail } from './shared';

type OrderReceiptEmailInput = {
  locale: EmailLocale;
  orderId: string;
  amountLabel: string;
  albumTitle?: string | null;
  receiptUrl?: string | null;
};

const copy = {
  en: {
    subject: 'Yujee order confirmation',
    title: 'Order confirmed',
    body: 'Your Yujee order is paid and ready.',
    orderId: 'Order ID',
    amount: 'Amount',
    album: 'Album',
    button: 'View album',
    footer: 'Keep this email as your receipt.',
  },
  zh: {
    subject: 'Yujee 订单确认',
    title: '订单已确认',
    body: '你的 Yujee 订单已支付完成。',
    orderId: '订单号',
    amount: '金额',
    album: '相册',
    button: '查看相册',
    footer: '请保留这封邮件作为收据。',
  },
} as const;

export function renderOrderReceiptEmail(input: OrderReceiptEmailInput): RenderedEmail {
  const t = copy[input.locale];
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
