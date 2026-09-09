import { requireAgentSecret } from '@/lib/auth/require-agent-secret';
import { fromException } from '@/lib/api/from-exception';
import { handlePhotoProfilesCallback } from './handler';

// 照片视觉档案回调 sink —— engine 建完档把 { albumId, profiles } 送到这里落库。
// 与 job-progress 同款鉴权:AGENT_SHARED_SECRET(§3 secret,绝不打进客户端包)。
export async function POST(req: Request) {
  try {
    requireAgentSecret(req);
    return await handlePhotoProfilesCallback(req);
  } catch (e) {
    return fromException(e);
  }
}
