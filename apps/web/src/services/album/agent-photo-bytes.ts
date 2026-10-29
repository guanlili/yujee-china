// design-agent 的 look_at_photos 取图 seam(web 这一半)。
//
// 为什么是「按需取」而不是装书时一起发:一本书几十张,base64 全塞进 /api/book 太贵,
// 而看图是**兜底**路径 —— 绝大多数对话一张都不看。
//
// 为什么请求只带 photoId 而不是 R2 key:这个口的鉴权只有 AGENT_SHARED_SECRET
// (与 job-progress / agent-data / photo-profiles 同款)。收 key 等于把那把钥匙升格
// 成整桶任意对象的读取权(别人的原图、PDF、备份快照都在同一个桶)。收 photoId 则
// 天然被 album_photos 的归属关系框住:key 由 (albumId, photoId) 推导,越权 id 连
// R2 都碰不到。
//
// ⚠️ 已知欠账:这里返回的是**规范原图**(长边 3400 / q0.82),没有服务端缩图 ——
// apps/web 没装图像库(sharp 不在依赖里,加它是一笔要单独拍板的原生依赖)。所以用
// 「单张上限 + 单次总预算」兜住模型请求体,超了就跳过并如实报给模型。真要治本是给
// 这条路加一步服务端缩图(长边 ~1024),那时这两个常量可以大幅放宽。

import { db } from '@/db/client';
import { albumPhotoRepo } from '@/db/repos/album-photo-repo';
import { ERRORS } from '@/lib/api/error-codes';
import { r2 } from '@/lib/r2/r2-client';
import { PHOTO_ORIGINAL_CONTENT_TYPE, photoOriginalKey } from './photo-original-util';

/** 与 design-agent 的 look_at_photos 上限同口径(一次最多看 6 张)。 */
export const AGENT_PHOTO_BYTES_MAX = 6;

/**
 * ⚠️ 预算一律按 **base64 之后**的大小算,不是原始字节。
 *
 * 这个口用普通 JSON 返回 base64(`handler.ts` 走 `ok(result)`),编码后涨 4/3。
 * 按原始字节记预算的话,6MB 的「总预算」到线上就是 8MB 响应体 —— 顶穿 Vercel 的
 * 4.5MB,于是取 4 张 1.5MB 的原图不是「跳过几张」,是整次请求 500,兜底路径直接废。
 *
 * 余量:4.5MB 上限,总预算 3.5MiB,留约 1MB 给信封/skipped 列表/未来字段。
 *
 * ⚠️ 已知欠账(与文件抬头同一条):这里返回的是**规范原图**(长边 3400/q0.82),
 * 没有服务端缩图,所以预算一紧就会有照片被跳过。治本是给这条路加一步服务端缩图
 * (长边 ~1024),那时这两个常量可以大幅放宽。
 */
export const AGENT_PHOTO_MAX_BASE64_BYTES = Math.floor(2.5 * 1024 * 1024);
export const AGENT_PHOTO_TOTAL_BASE64_BYTES = Math.floor(3.5 * 1024 * 1024);

/** base64 编码后的长度(每 3 字节 → 4 字符,含 padding)。 */
export function base64Length(rawBytes: number): number {
  return Math.ceil(rawBytes / 3) * 4;
}

/** base64 预算换算回原始字节 —— 只为让调用方/测试有个可读的等价数,判定仍走 base64。 */
function rawBudgetOf(base64Budget: number): number {
  return Math.floor(base64Budget / 4) * 3;
}

/** 单张原始字节上限(由 base64 上限换算)。一张巨图能把整个模型请求顶爆。 */
export const AGENT_PHOTO_MAX_BYTES = rawBudgetOf(AGENT_PHOTO_MAX_BASE64_BYTES);
/** 单次请求的原始字节总预算(由 base64 总预算换算)。 */
export const AGENT_PHOTO_TOTAL_BYTES = rawBudgetOf(AGENT_PHOTO_TOTAL_BASE64_BYTES);

export type AgentPhotoSkipReason =
  | 'not-in-album'
  | 'not-uploaded'
  | 'missing-object'
  | 'too-large'
  | 'over-budget';

export type AgentPhotoBytesResult = {
  photos: { photoId: string; data: string; mimeType: string }[];
  skipped: { photoId: string; reason: AgentPhotoSkipReason }[];
};

export type AgentPhotoBytesDeps = {
  /** 注入点只为测试:生产恒是 r2.getObject。 */
  readObject?: (key: string) => Promise<Uint8Array | null>;
};

export async function getAgentPhotoBytes(
  albumId: string,
  photoIds: string[],
  deps: AgentPhotoBytesDeps = {},
): Promise<AgentPhotoBytesResult> {
  // 去重后再判上限:模型重复列同一张不该白占名额。
  const wanted = [...new Set(photoIds)];
  if (wanted.length === 0) throw ERRORS.VALIDATION_FAILED('photoIds 至少要有一张');
  if (wanted.length > AGENT_PHOTO_BYTES_MAX) {
    throw ERRORS.VALIDATION_FAILED(`一次最多取 ${AGENT_PHOTO_BYTES_MAX} 张,收到 ${wanted.length} 张`);
  }

  const readObject = deps.readObject ?? ((key: string) => r2.getObject(key));
  const rows = await albumPhotoRepo.findByAlbum(albumId, db);
  const statusById = new Map(rows.map((row) => [row.photoId, row.status]));

  const photos: AgentPhotoBytesResult['photos'] = [];
  const skipped: AgentPhotoBytesResult['skipped'] = [];
  let spent = 0;

  // 并发预读(2026-10-29):R2 get 是网络 IO,此前 for-of 里逐张串行等,20 张
  // 照片 = 20×RTT;先按归属/状态闸筛出候选,并发拉完字节再串行做大小判定/编码。
  const candidates = wanted.filter((photoId) => statusById.get(photoId) === 'uploaded');
  const bytesByPhoto = new Map(
    await Promise.all(
      candidates.map(async (photoId) => [photoId, await readObject(photoOriginalKey(albumId, photoId))] as const),
    ),
  );

  for (const photoId of wanted) {
    const status = statusById.get(photoId);
    // 归属闸:不在这本相册的照片账本里 = 越权,连 R2 都不碰。
    if (status === undefined) {
      skipped.push({ photoId, reason: 'not-in-album' });
      continue;
    }
    if (status !== 'uploaded') {
      skipped.push({ photoId, reason: 'not-uploaded' });
      continue;
    }

    const bytes = bytesByPhoto.get(photoId) ?? null;
    if (!bytes) {
      skipped.push({ photoId, reason: 'missing-object' });
      continue;
    }
    // 判定用编码**后**的大小 —— 响应体里躺的是 base64,不是这些原始字节。
    const encodedSize = base64Length(bytes.byteLength);
    if (encodedSize > AGENT_PHOTO_MAX_BASE64_BYTES) {
      skipped.push({ photoId, reason: 'too-large' });
      continue;
    }
    if (spent + encodedSize > AGENT_PHOTO_TOTAL_BASE64_BYTES) {
      skipped.push({ photoId, reason: 'over-budget' });
      continue;
    }

    spent += encodedSize;
    photos.push({
      photoId,
      data: Buffer.from(bytes).toString('base64'),
      mimeType: PHOTO_ORIGINAL_CONTENT_TYPE,
    });
  }

  return { photos, skipped };
}
