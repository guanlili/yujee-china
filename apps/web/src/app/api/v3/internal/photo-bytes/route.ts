import { requireAgentSecret } from '@/lib/auth/require-agent-secret';
import { fromException } from '@/lib/api/from-exception';
import { handlePhotoBytes } from './handler';

// design-agent 的 look_at_photos 取图口 —— 按需拿几张照片的字节喂视觉模型。
// 与 job-progress / agent-data / photo-profiles 同款鉴权:AGENT_SHARED_SECRET。
export async function POST(req: Request) {
  try {
    requireAgentSecret(req);
    return await handlePhotoBytes(req);
  } catch (e) {
    return fromException(e);
  }
}
