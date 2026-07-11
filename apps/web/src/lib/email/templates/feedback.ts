import { escapeHtml, renderShell, type RenderedEmail } from './shared';

// 用户反馈转发邮件(发给运营者收件箱,固定中文)。发件人复用 AUTH_EMAIL_FROM。

type FeedbackEmailInput = {
  userEmail: string;
  userName?: string | null;
  userId: string;
  message: string;
  page?: string | null;
};

export function renderFeedbackEmail(input: FeedbackEmailInput): RenderedEmail {
  const subject = `【Yujee 反馈】${input.message.slice(0, 24)}${input.message.length > 24 ? '…' : ''}`;
  const meta = [
    `用户:${input.userName || '(未署名)'} <${input.userEmail}>`,
    `用户 ID:${input.userId}`,
    ...(input.page ? [`所在页面:${input.page}`] : []),
    `时间:${new Date().toISOString()}`,
  ];
  const body = [
    `<p style="white-space:pre-wrap;font-size:15px;line-height:1.7">${escapeHtml(input.message)}</p>`,
    `<hr style="border:none;border-top:1px solid #e5e0d8;margin:20px 0" />`,
    `<p style="color:#8a857c;font-size:12px;line-height:1.8">${meta.map((line) => escapeHtml(line)).join('<br/>')}</p>`,
  ].join('\n');

  return {
    subject,
    html: renderShell('用户反馈', body),
    text: `${input.message}\n\n---\n${meta.join('\n')}`,
  };
}
