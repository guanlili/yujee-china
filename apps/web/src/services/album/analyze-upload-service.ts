// 建书照片直传 R2 的服务层。刻意做成 photo-original-service.ts 那样的小独立单例,
// 不去继续撑大 album-service.ts。纯逻辑全在 analyze-upload-util.ts,这里只负责把
// r2 客户端接上去。
//
// 与 photo-original-service 的区别:那条链路是「已建好的书 → 3400px 规范原图」,
// 按 albumId 组织、要校验归属;这条是建书**之前**的中转,书还不存在,只能按
// userId + 服务端签发的 sessionId 组织。两者互不影响,共用同一个桶不同前缀。

import { r2 } from '@/lib/r2/r2-client';
import {
  ANALYZE_UPLOAD_CONTENT_TYPE,
  AnalyzeUploadSignBodySchema,
  analyzeUploadKey,
  assembleAnalyzePhotos,
  newUploadSessionId,
  type AnalyzePhotoMeta,
  type AssembledAnalyzePhoto,
} from './analyze-upload-util';
import { ERRORS } from '@/lib/api/error-codes';
import { ANON_MAX_PHOTOS_PER_GENERATION } from '@/config/anon';

// 预签名有效期。整批传完要多久取决于网速和张数 —— 100 张、弱网、并发 3 的情况下
// 5 分钟不够用,给 30 分钟;它只是一个写权限窗口,key 里带 userId,越不了权。
const PUT_URL_TTL_SECONDS = 30 * 60;

export const analyzeUploadService = {
  // 换一批预签名 PUT。这里**不建书、不扣积分、不写任何一行库** —— 用户中途放弃
  // 只会在 R2 留下几个待过期的对象,不会留下一本没发车的空相册和一笔挂着的积分。
  async signUpload(
    userId: string,
    photoIds: string[],
    opts: { isAnonymous?: boolean } = {},
  ): Promise<{ sessionId: string; uploads: { photoId: string; putUrl: string }[] }> {
    // 路由的 parseBody 已经跑过一遍,service 不信任路由以外的调用方,再跑一次。
    const parsed = AnalyzeUploadSignBodySchema.safeParse({ photoIds });
    if (!parsed.success) {
      throw ERRORS.VALIDATION_FAILED(parsed.error.issues.map((i) => i.message).join('; '));
    }
    // 游客上限在这里就卡住,而不是等到建书。任何人打开首页都会自动拿到一个匿名
    // session,不卡的话这个端点就是一条「不建书、不扣积分、纯写 R2」的白嫖通道:
    // 一个 20 张封顶的游客照样能换 100 个 30 分钟有效的 PUT。
    if (opts.isAnonymous === true && parsed.data.photoIds.length > ANON_MAX_PHOTOS_PER_GENERATION) {
      throw ERRORS.ANON_PHOTO_LIMIT();
    }

    const sessionId = newUploadSessionId();
    const uploads = await Promise.all(
      parsed.data.photoIds.map(async (photoId) => ({
        photoId,
        putUrl: await r2.signPutUrl(
          analyzeUploadKey(userId, sessionId, photoId),
          ANALYZE_UPLOAD_CONTENT_TYPE,
          PUT_URL_TTL_SECONDS,
        ),
      })),
    );
    return { sessionId, uploads };
  },

  // 把这批预览从 R2 取回来拼成 data URL。少一张就抛 ANALYZE_UPLOAD_INCOMPLETE。
  async collect(
    userId: string,
    sessionId: string,
    photos: AnalyzePhotoMeta[],
  ): Promise<AssembledAnalyzePhoto[]> {
    return assembleAnalyzePhotos({
      userId,
      sessionId,
      photos,
      fetchObject: (key) => r2.getObject(key),
    });
  },
};
