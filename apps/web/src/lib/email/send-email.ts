import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { env } from '@/lib/env';
import { logger } from '@/lib/log/logger';
import type { RenderedEmail } from './templates';

type SendEmailInput = RenderedEmail & {
  to: string;
};

export async function sendEmail(input: SendEmailInput): Promise<void> {
  if (env.EMAIL_DELIVERY === 'resend') {
    await sendViaResend(input);
    return;
  }

  if (env.EMAIL_DELIVERY === 'console') {
    logger.info({ to: input.to, subject: input.subject, text: input.text }, 'email.console');
    return;
  }

  const capturePath = resolve(process.cwd(), env.EMAIL_CAPTURE_FILE);
  await mkdir(dirname(capturePath), { recursive: true });
  await appendFile(
    capturePath,
    `${JSON.stringify({ ...input, capturedAt: new Date().toISOString() })}\n`,
    'utf8',
  );
}

async function sendViaResend(input: SendEmailInput): Promise<void> {
  if (!env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY is required when EMAIL_DELIVERY=resend');
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.AUTH_EMAIL_FROM,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    }),
  });

  if (!res.ok) {
    throw new Error(`Resend email failed with status ${res.status}`);
  }
}
