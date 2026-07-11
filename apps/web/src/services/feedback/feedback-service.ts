import { db } from '@/db/client';
import { feedbackRepo } from '@/db/repos/feedback-repo';
import { ERRORS } from '@/lib/api/error-codes';
import { sendEmail } from '@/lib/email/send-email';
import { renderFeedbackEmail } from '@/lib/email/templates';
import { env } from '@/lib/env';
import { logger } from '@/lib/log/logger';

// 用户反馈:落库存档(真相),再转发邮件到运营收件箱(FEEDBACK_INBOX,发件人复用
// AUTH_EMAIL_FROM)。邮件失败不影响提交结果 —— 反馈已在库里,发信失败只记日志。
const MAX_PER_HOUR = 5;

export const feedbackService = {
  async submit(
    user: { id: string; email: string; name?: string | null },
    input: { message: string; page?: string },
  ): Promise<void> {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recent = await feedbackRepo.countByUserSince(user.id, oneHourAgo);
    if (recent >= MAX_PER_HOUR) throw ERRORS.RATE_LIMITED();

    await feedbackRepo.create(db, {
      userId: user.id,
      message: input.message,
      page: input.page ?? null,
    });

    try {
      const email = renderFeedbackEmail({
        userEmail: user.email,
        userName: user.name,
        userId: user.id,
        message: input.message,
        page: input.page,
      });
      await sendEmail({ to: env.FEEDBACK_INBOX, ...email });
    } catch (e) {
      logger.warn({ userId: user.id, err: e instanceof Error ? e.message : String(e) }, 'feedback.email_failed');
    }
  },
};
