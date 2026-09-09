import { PhotoProfileSchema, type PhotoProfile } from '@yujee/contracts';
import { albumPhotoRepo } from '@/db/repos/album-photo-repo';
import type { DbOrTx } from '@/db/client';
import { logger } from '@/lib/log/logger';

/**
 * 照片视觉档案的落库与读取。
 *
 * **逐条校验,坏的跳过不整批拒** —— engine 侧单张照片解析异常是常态(视觉模型
 * 偶发吐脏、某张图 EXIF 坏掉),整批拒会让整本书一张档案都没有,Agent 直接瞎回去。
 *
 * ⚠️ 隐私红线:带 location/place/gps/lat/lng/coordinate 的档案**整条拒收**,
 * 不在这里剥字段 —— 剥了等于默许上游继续发,红线就只剩一层纸。执行机制是契约
 * 的 `.strict()`(packages/contracts/src/photo-profile.ts),这里不重复实现。
 */
export type SavePhotoProfilesResult = { saved: number; skipped: number };

export async function savePhotoProfiles(
  albumId: string,
  profiles: unknown,
  tx?: DbOrTx,
): Promise<SavePhotoProfilesResult> {
  // 非对象(null / 数组 / 字符串)一律记 skipped,不抛 —— 这是 internal 回调的
  // 入口,上游发歪了不该把 500 甩回给 engine 触发无意义重试。
  if (
    typeof profiles !== 'object'
    || profiles === null
    || Array.isArray(profiles)
  ) {
    logger.warn({ albumId }, 'photo profiles payload is not an object');
    return { saved: 0, skipped: 1 };
  }

  const valid: Record<string, PhotoProfile> = {};
  let skipped = 0;
  for (const [photoId, candidate] of Object.entries(profiles as Record<string, unknown>)) {
    const parsed = PhotoProfileSchema.safeParse(candidate);
    if (parsed.success) valid[photoId] = parsed.data;
    else {
      skipped += 1;
      // 只记 photoId 和 issue 路径,**不记档案内容** —— 被拒的那条可能正是因为
      // 夹带了位置信息,写进日志等于把它落盘。
      logger.warn(
        { albumId, photoId, issues: parsed.error.issues.map((i) => i.path.join('.')) },
        'photo profile rejected by contract',
      );
    }
  }

  const saved = Object.keys(valid).length;
  if (saved > 0) await albumPhotoRepo.setProfiles(albumId, valid, tx);
  return { saved, skipped };
}

/** 读全书档案。没建档 / 坏档案的行不出现在结果里(repo 层跳过并 warn)。 */
export async function getPhotoProfiles(
  albumId: string,
  tx?: DbOrTx,
): Promise<Record<string, PhotoProfile>> {
  return albumPhotoRepo.findProfilesByAlbum(albumId, tx);
}
