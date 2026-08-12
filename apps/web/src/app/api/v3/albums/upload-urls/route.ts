import { getAuthUser } from '@/lib/auth/require-auth';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { analyzeUploadService } from '@/services/album/analyze-upload-service';
import { AnalyzeUploadSignBodySchema } from '@/services/album/analyze-upload-util';

// 建书照片直传 R2 第一步:拿一批预签名 PUT。照片字节从此不再走 Vercel 的请求体
// (旧版把 base64 内联进 POST /api/v3/albums,27~50 张就撞 4.5MB 的
// FUNCTION_PAYLOAD_TOO_LARGE)。
//
// getAuthUser 而不是 requireRealUser:游客也走这条路(一条链路,不养两套)。游客
// 的量本来就封顶 20 张 / 1 本,且未转正的匿名账号 7 天后连相册一起被 cron 清掉。
export async function POST(req: Request) {
  try {
    const user = await getAuthUser(req);
    const { photoIds } = await parseBody(AnalyzeUploadSignBodySchema, req);
    const data = await analyzeUploadService.signUpload(user.id, photoIds, {
      isAnonymous: user.isAnonymous,
    });
    return ok(data);
  } catch (e) {
    return fromException(e);
  }
}
