import { z } from 'zod';
import { requireRealUser } from '@/lib/auth/require-auth';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { shareService } from '@/services/album/share-service';

// 生成/重新生成相册分享链接(免登只读)。已登录 + 归属校验在 shareService 里。
// 前置:浏览器已按当前滤镜版本备份所有页面引用照片;缺少精确版本时拒绝创建新分享。
const Schema = z.object({ locale: z.string().min(2).max(10).default('zh') });
type RouteCtx = { params: Promise<{ uuid: string }> };

export async function POST(req: Request, ctx: RouteCtx) {
  try {
    const user = await requireRealUser(req);
    const { uuid } = await ctx.params;
    const { locale } = await parseBody(Schema, req);
    return ok(await shareService.createShare(user.id, uuid, locale ?? 'zh'));
  } catch (e) {
    return fromException(e);
  }
}
