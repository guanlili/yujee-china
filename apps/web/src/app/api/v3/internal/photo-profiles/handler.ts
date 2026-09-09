import { z } from 'zod';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { logger } from '@/lib/log/logger';
import { savePhotoProfiles } from '@/services/album/photo-profile-service';

// 信封只管 albumId + profiles 这层壳:**每条档案本身不在这里校验**,交给
// service 逐条 safeParse —— 在这里整批 parse 会让一张坏照片打掉整本书的档案。
// 壳子 .strict():与同目录其它 internal 口同强度,未知键(包括夹带的位置信息)
// 在 parse 期就被拒。
const PhotoProfilesCallback = z.object({
  albumId: z.string().min(1),
  profiles: z.record(z.string(), z.unknown()),
}).strict();

export async function handlePhotoProfilesCallback(req: Request) {
  const payload = await parseBody(PhotoProfilesCallback, req);
  const result = await savePhotoProfiles(payload.albumId, payload.profiles);
  logger.info({ albumId: payload.albumId, ...result }, 'photo profiles callback');
  return ok(result);
}
