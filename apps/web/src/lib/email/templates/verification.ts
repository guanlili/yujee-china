import { escapeHtml, renderButton, renderShell, type EmailLocale, type RenderedEmail } from './shared';

type VerificationEmailInput = {
  locale: EmailLocale;
  name?: string | null;
  actionUrl: string;
};

const copy = {
  en: {
    subject: 'Verify your Yujee email',
    title: 'Verify your email',
    greeting: (name: string) => `Hi ${name},`,
    body: 'Welcome to Yujee. Confirm your email address to finish setting up your account.',
    button: 'Verify email',
    validity: 'This link expires soon and can only be used once.',
    fallback: 'If the button does not work, paste this link into your browser:',
    ignore: 'If you did not create a Yujee account, you can ignore this email.',
  },
  zh: {
    subject: '验证你的 Yujee 邮箱',
    title: '验证你的邮箱',
    greeting: (name: string) => `你好 ${name}，`,
    body: '欢迎使用 Yujee。请确认你的邮箱地址以完成账户设置。',
    button: '验证邮箱',
    validity: '此链接即将过期，且只能使用一次。',
    fallback: '如果按钮无法打开，请复制以下链接到浏览器：',
    ignore: '如果你没有注册 Yujee，可以忽略这封邮件。',
  },
} as const;

export function renderVerificationEmail(input: VerificationEmailInput): RenderedEmail {
  const t = copy[input.locale];
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
