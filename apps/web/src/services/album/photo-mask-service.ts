import { PhotoProfileSchema, type PhotoProfile } from '@yujee/contracts';
import { db } from '@/db/client';
import { albumPhotoRepo } from '@/db/repos/album-photo-repo';
import { clipWorkerClient } from '@/lib/agent/clip-worker-client';
import { ERRORS } from '@/lib/api/error-codes';
import { logger } from '@/lib/log/logger';
import { collaborationService } from '@/services/collaboration/collaboration-service';
import { r2 } from '@/lib/r2/r2-client';
import {
  PHOTO_MASK_CONTENT_TYPE,
  PHOTO_ORIGINAL_CONTENT_TYPE,
  photoMaskKey,
  photoOriginalKey,
} from './photo-original-util';

/**
 * 抠图 mask 的按需生成(web 这一半)。
 *
 * ## 为什么必须有这条路
 * 浏览器端的 `lib/photo/cutout/cutout-math.ts` 是从四边漫水填充,**没有语义** ——
 * 背景杂乱、主体与背景同色一律失手。2026-08-29 实测棚拍人像 5 张 0 张能用,自动抠图
 * 因此被否决。现在 Agent 能自动开抠图,不接服务端 isnet 的分割结果,用户拿到的就是
 * 一个被啃残的自己。
 *
 * ## 这一层的三条铁律
 * 1. **尽力而为,绝不抛**:拿不到 mask 只是渲染退回浏览器端,不能让「这轮对话」失败。
 * 2. **R2 写成功才回填 maskKey**:maskKey 指向一个不存在的对象比没有 maskKey 更糟 ——
 *    渲染侧会以为有服务端 mask,取 404 之后才退回,白白多一趟网络。
 * 3. **判据是「现在开着抠图但还没 maskKey」,不是「这一轮刚开的那几张」**:这样一轮
 *    没跑完(超上限 / 推理挂了)下一轮会自己补上,不需要额外的补跑任务。
 */

/**
 * 一轮最多跑几张。isnet 在 shared-cpu-1x 上单张 ~4s,而这段跑在 design-chat 的
 * 流式路由里(maxDuration 300s,对话本身已经可能吃掉 240s)。跑不完的留给下一轮 ——
 * 见上面第 3 条。与 engine 的 PROFILE_MAX_CONCURRENCY / PROFILE_BATCH_SIZE 同为 8
 * 时批内一次并发跑完,不必分批。
 */
export const PHOTO_MASK_MAX_PER_RUN = 8;

export type EnsureCutoutMasksDeps = {
  /** 注入点只为测试:生产恒是 r2.getObject / r2.putObject / clipWorkerClient。 */
  readOriginal?: (key: string) => Promise<Uint8Array | null>;
  putObject?: (key: string, bytes: Uint8Array, contentType: string) => Promise<void>;
  requestMasks?: (
    images: { photoId: string; dataUrl: string }[],
  ) => Promise<{ profiles: Record<string, unknown>; masks: Record<string, string> }>;
};

export type EnsureCutoutMasksResult = {
  /** 这一轮真的写成了 mask 的照片。 */
  created: string[];
  /** 因为超过单轮上限而留给下一轮的张数。 */
  deferred: number;
};

const EMPTY: EnsureCutoutMasksResult = { created: [], deferred: 0 };

export async function ensureCutoutMasks(
  albumId: string,
  photoIds: string[],
  deps: EnsureCutoutMasksDeps = {},
): Promise<EnsureCutoutMasksResult> {
  const requestMasks = deps.requestMasks
    ?? (clipWorkerClient.isConfigured()
      ? (images: { photoId: string; dataUrl: string }[]) => clipWorkerClient.buildProfilesWithMasks(images)
      : null);
  // 没配 CLIP worker = 这条能力不存在,安静降级(渲染退回浏览器端抠图)。
  if (!requestMasks) return EMPTY;

  const wanted = [...new Set(photoIds)];
  if (wanted.length === 0) return EMPTY;

  try {
    const readOriginal = deps.readOriginal ?? ((key: string) => r2.getObject(key));
    const putObject = deps.putObject
      ?? ((key: string, bytes: Uint8Array, contentType: string) => r2.putObject(key, bytes, contentType));

    // 归属闸:不在这本相册的照片账本里 = 越权,连 R2 都不碰(与 agent-photo-bytes 同口径)。
    const rows = await albumPhotoRepo.findByAlbum(albumId, db);
    const uploaded = new Set(rows.filter((row) => row.status === 'uploaded').map((row) => row.photoId));
    const profiles = await albumPhotoRepo.findProfilesByAlbum(albumId, db);

    const todo = wanted.filter((photoId) => uploaded.has(photoId) && !profiles[photoId]?.maskKey);
    if (todo.length === 0) return EMPTY;

    const batch = todo.slice(0, PHOTO_MASK_MAX_PER_RUN);
    const deferred = todo.length - batch.length;

    const images: { photoId: string; dataUrl: string }[] = [];
    for (const photoId of batch) {
      const bytes = await readOriginal(photoOriginalKey(albumId, photoId));
      if (!bytes) continue;
      images.push({
        photoId,
        dataUrl: `data:${PHOTO_ORIGINAL_CONTENT_TYPE};base64,${Buffer.from(bytes).toString('base64')}`,
      });
    }
    if (images.length === 0) return { created: [], deferred };

    const { profiles: freshProfiles, masks } = await requestMasks(images);

    const updates: Record<string, PhotoProfile> = {};
    const created: string[] = [];
    for (const { photoId } of images) {
      const encoded = masks[photoId];
      if (!encoded) continue;
      // 档案:优先用库里已有的那份(这次推理只为 mask,别拿新算的语义覆盖旧档案);
      // 没建过档的照片才收下这次带回来的档案。两者都没有就跳过 —— 没有档案就没有
      // 地方挂 maskKey。
      const existing = profiles[photoId];
      const fresh = existing ?? PhotoProfileSchema.safeParse(freshProfiles[photoId]).data;
      if (!fresh) continue;

      const key = photoMaskKey(albumId, photoId);
      try {
        await putObject(key, new Uint8Array(Buffer.from(encoded, 'base64')), PHOTO_MASK_CONTENT_TYPE);
      } catch (error) {
        // 写失败就当没这张 —— 绝不回填一个指向不存在对象的 maskKey。
        logger.warn({ albumId, photoId, err: String(error) }, 'cutout mask upload failed');
        continue;
      }
      updates[photoId] = { ...fresh, maskKey: key };
      created.push(photoId);
    }

    if (created.length > 0) await albumPhotoRepo.setProfiles(albumId, updates, db);
    logger.info({ albumId, requested: wanted.length, created: created.length, deferred }, 'cutout masks');
    return { created, deferred };
  } catch (error) {
    // 尽力而为:推理挂了/网络断了只影响抠图质量,渲染会退回浏览器端那套。
    logger.warn({ albumId, err: String(error) }, 'ensureCutoutMasks failed; falling back to browser cutout');
    return EMPTY;
  }
}

/** 一次最多问几张 mask 的 URL。与画板一屏能显示的图槽数量同量级,足够用。 */
export const PHOTO_MASK_URLS_MAX = 60;

export type MaskUrlDeps = {
  /** 注入点只为测试:生产恒是 r2.signGetUrl(300s 预签名,私有桶)。 */
  signUrl?: (key: string) => Promise<string>;
};

/**
 * 按 photoId 换 mask 的签名 GET(TTL 300s)。**只有真的有 maskKey 的照片才出 URL**,
 * 其余的键直接不出现 —— 调用方(浏览器)把「没有这个键」当成「没有服务端 mask」,
 * 退回浏览器端抠图。
 *
 * 归属:走 `collaborationService.requireAccess`(owner|editor 都是 Creator)。
 * key 由 (albumId, photoId) 推导,调用方给不了 key。
 */
export async function getCutoutMaskUrls(
  userId: string,
  albumId: string,
  photoIds: string[],
  deps: MaskUrlDeps = {},
): Promise<Record<string, string>> {
  await collaborationService.requireAccess(userId, albumId);
  if (photoIds.length === 0) return {};
  if (photoIds.length > PHOTO_MASK_URLS_MAX) {
    throw ERRORS.VALIDATION_FAILED(`一次最多问 ${PHOTO_MASK_URLS_MAX} 张,收到 ${photoIds.length} 张`);
  }

  const signUrl = deps.signUrl ?? ((key: string) => r2.signGetUrl(key, 300));
  const requested = new Set(photoIds);
  const profiles = await albumPhotoRepo.findProfilesByAlbum(albumId, db);

  const out: Record<string, string> = {};
  for (const [photoId, profile] of Object.entries(profiles)) {
    if (!requested.has(photoId) || !profile.maskKey) continue;
    // 存库的 maskKey 不直接拿去签名:重新按 (albumId, photoId) 推导一遍,
    // 库里万一被写进别的前缀也签不出别人的对象。
    out[photoId] = await signUrl(photoMaskKey(albumId, photoId));
  }
  return out;
}

/**
 * 可打桩的门面。`album-service` 经它调用,测试才能换掉实现 ——
 * ESM 的具名函数导入是只读绑定,打不了桩(同 designAgentClient 的先例)。
 */
export const photoMaskService = {
  ensureCutoutMasks,
  getCutoutMaskUrls,
};
