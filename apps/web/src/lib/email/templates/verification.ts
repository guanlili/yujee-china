import { getEmailCopy } from './copy';
import { escapeHtml, renderButton, renderShell, type EmailLocale, type RenderedEmail } from './shared';

type VerificationEmailInput = {
  locale: EmailLocale;
  name?: string | null;
  actionUrl: string;
};

export function renderVerificationEmail(input: VerificationEmailInput): RenderedEmail {
  const t = getEmailCopy(input.locale).verification;
  const name = input.name?.trim() || 'there';
  const html = renderShell(
    t.title,
    [
      `<p style="font-size:16px;line-height:1.6;margin:0 0 14px;">${escapeHtml(t.greeting(name))}</p>`,
      `<p style="font-size:16px;line-height:1.6;margin:0 0 14px;">${escapeHtml(t.body)}</p>`,
      renderButton(t.button, input.actionUrl),
      `<p style="font-size:14px;color:#64748b;line-height:1.6;margin:14px 0 0;">${escapeHtml(t.validity)}</p>`,
      `<p style="font-size:13px;color:#64748b;line-height:1.6;margin:14px 0 0;">${escapeHtml(t.fallback)} ${escapeHtml(input.actionUrl)}</p>`,
      `<p style="font-size:13px;color:#64748b;line-height:1.6;margin:14px 0 0;">${escapeHtml(t.ignore)}</p>`,
    ].join(''),
  );

  const text = [
    t.title,
    '',
    t.greeting(name),
    '',
    t.body,
    '',
    `${t.button}: ${input.actionUrl}`,
    t.validity,
    t.ignore,
  ].join('\n');

  return { subject: t.subject, html, text };
}
