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

  // saved = **真落了几行**,不是「校验过了几条」。setProfiles 只 UPDATE 不 INSERT,
  // 所以回调早于照片行落库时(engine 建完档而上传 confirm 还没到)这两个数字差一
  // 整批 —— 报 {saved:100, skipped:0} 而库里一条没有,排障会往完全错的方向查。
  // 校验过了但没落成的那些并进 skipped,让 saved + skipped 恒等于收到的条数。
  const validCount = Object.keys(valid).length;
  const saved = validCount > 0 ? await albumPhotoRepo.setProfiles(albumId, valid, tx) : 0;
  return { saved, skipped: skipped + (validCount - saved) };
}

/** 读全书档案。没建档 / 坏档案的行不出现在结果里(repo 层跳过并 warn)。 */
export async function getPhotoProfiles(
  albumId: string,
  tx?: DbOrTx,
): Promise<Record<string, PhotoProfile>> {
  return albumPhotoRepo.findProfilesByAlbum(albumId, tx);
}

/** 载荷里的一张照片:原样带过树里的字段,外加档案。 */
export type ChapterPhotoPayload = { photoId: string; profile?: PhotoProfile } & Record<string, unknown>;
export type ChapterPayload = { photos: ChapterPhotoPayload[] } & Record<string, unknown>;

/**
 * 把档案合进**发给 design-agent 的章节树载荷**。
 *
 * ⚠️ 只用于组装载荷,**绝不写回 `draft_json`**:`V3ChapterPhoto`(packages/contracts)
 * 是 `.strict()` 且没有 profile 字段,塞进树里会让整棵树 parse 失败。design-agent 的
 * `AlbumChapterPhoto.profile` 就是这一步的收货口。
 *
 * 没建档的照片**不带这个键**(而不是带一个空档案)—— 读取方一律要能降级到「没档案」。
 */
export function withPhotoProfiles(
  chapters: ReadonlyArray<{ photos?: ReadonlyArray<{ photoId: string }> }>,
  profiles: Record<string, PhotoProfile>,
): ChapterPayload[] {
  return chapters.map((chapter) => ({
    ...chapter,
    photos: (chapter.photos ?? []).map((photo) => {
      const profile = profiles[photo.photoId];
      return profile ? { ...photo, profile } : { ...photo };
    }),
  }));
}
