import { requireRealUser } from '@/lib/auth/require-auth';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { photoMaskService } from '@/services/album/photo-mask-service';

// 手工抠图那条路的 mask 生成触发口(2026-09-10)。
//
// 为什么单独一个口、而不是在滤镜 PATCH 里顺手做:isnet 单张 ~4s,一轮最多 8 张 ——
// 挂在 PATCH 上用户点一下要等几十秒。浏览器在滤镜存好之后**不等结果**地打这一枪,
// PATCH 的响应一点不受影响。(Vercel 上「响应后再跑」的浮空 Promise 不保证执行,
// 所以必须是独立的一次函数调用,不能在 PATCH 里 fire-and-forget。)
//
// 请求体是空的:要给哪几张生成,服务端自己从 albums.photo_filter.cutouts 读 ——
// 既不给一个「替任意 photoId 烧推理」的口,也天然与「开着抠图但还没 maskKey」这个
// 判据对齐。幂等,重复打不产生额外成本。
export const maxDuration = 120;

export async function POST(req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  try {
    const user = await requireRealUser(req);
    const { uuid } = await ctx.params;
    const result = await photoMaskService.ensureCutoutMasksForAlbum(user.id, uuid);
    return ok(result);
  } catch (e) {
    return fromException(e);
  }
}
