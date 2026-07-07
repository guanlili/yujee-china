import { z } from 'zod';
import { requireAuth } from '@/lib/auth/require-auth';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { albumService } from '@/services/album/album-service';

// 设计 Agent 全书对话：装书 → 对话 → committed 时 pages 已在 service 里写回 draft_json。
const BodySchema = z
  .object({
    userMessage: z.string().min(1).max(500),
  })
  .strict();

// 多工具轮次（读页 + 写入 + 模型往返）可能超过 60s。
export const maxDuration = 120;

export async function POST(req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  try {
    const user = await requireAuth(req);
    const { uuid } = await ctx.params;
    const body = await parseBody(BodySchema, req);
    const result = await albumService.designChatTurn(user.id, uuid, {
      userMessage: body.userMessage,
    });
    return ok(result);
  } catch (e) {
    return fromException(e);
  }
}
