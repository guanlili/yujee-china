import { z } from 'zod';
import { requireAuth } from '@/lib/auth/require-auth';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { feedbackService } from '@/services/feedback/feedback-service';

const FeedbackBody = z
  .object({
    message: z.string().trim().min(1).max(2000),
    page: z.string().trim().max(200).optional(),
  })
  .strict();

// 用户菜单「反馈与问题」表单:登录 + 每用户每小时限 5 条(服务端判),
// 落库并转发邮件到 FEEDBACK_INBOX。
export async function POST(req: Request) {
  try {
    const user = await requireAuth(req);
    const body = await parseBody(FeedbackBody, req);
    await feedbackService.submit({ id: user.id, email: user.email }, body);
    return ok({ submitted: true });
  } catch (e) {
    return fromException(e);
  }
}
