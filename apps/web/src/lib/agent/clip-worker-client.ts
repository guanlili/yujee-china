import { env } from '@/lib/env';

/**
 * 2GB CLIP worker(`yujee-agent-clip`)的 internal 客户端。
 *
 * ⚠️ 它**不是** `AGENT_BASE_URL` 那台机器:`/internal/photo-profile` 只在装了
 * onnxruntime 与分割权重的 2GB worker 上开(普通 1GB Agent 的开关关着 => 404)。
 * 所以这里单开一个 base URL,与 engine 侧 `settings.grouping_clip_base_url` 指的是
 * 同一台机器、同一把钥匙(`grouping_clip_secret or agent_shared_secret`)。
 *
 * 没配 base URL = 这条能力不存在,调用方一律降级(抠图退回浏览器端),**不报错**。
 * 与 design-agent 的 seam 同一条口径:宁可没这个能力,也不能让主流程失败。
 */

export type PhotoProfileImage = { photoId: string; dataUrl: string };

export type PhotoProfileMaskResult = {
  /** photoId → 档案(形状由 PhotoProfileSchema 校验,这里不解析)。 */
  profiles: Record<string, unknown>;
  /** photoId → base64 PNG(alpha mask)。engine 只在 persistMask=true 时带。 */
  masks: Record<string, string>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const clipWorkerClient = {
  isConfigured(): boolean {
    return Boolean(env.AGENT_CLIP_BASE_URL);
  },

  /**
   * 跑一次**带 mask 的**建档(engine 侧 persistMask=true 会走 isnet-general-use /
   * 1024²,比建档用的 u2netp/320² 慢一个量级,单张 ~4s)。
   *
   * 失败一律抛 —— 调用方(photo-mask-service)负责吞掉并降级,这里不猜语义。
   */
  async buildProfilesWithMasks(
    images: PhotoProfileImage[],
    timeoutMs = 120_000,
  ): Promise<PhotoProfileMaskResult> {
    const baseUrl = env.AGENT_CLIP_BASE_URL;
    if (!baseUrl) throw new Error('AGENT_CLIP_BASE_URL is not configured');
    if (images.length === 0) return { profiles: {}, masks: {} };

    const secret = env.AGENT_CLIP_SECRET ?? env.AGENT_SHARED_SECRET;
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/internal/photo-profile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${secret}` },
      // 照片 base64 只在请求内存里,不落盘不进日志(与 engine 侧同一条隐私约定)。
      body: JSON.stringify({ images, persistMask: true }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`photo-profile worker returned ${res.status}`);

    const json = (await res.json().catch(() => null)) as unknown;
    const data = isRecord(json) ? json.data : null;
    if (!isRecord(data)) throw new Error('photo-profile worker returned an invalid envelope');

    const profiles = isRecord(data.profiles) ? data.profiles : {};
    const rawMasks = isRecord(data.masks) ? data.masks : {};
    const masks: Record<string, string> = {};
    for (const [photoId, value] of Object.entries(rawMasks)) {
      if (typeof value === 'string' && value.length > 0) masks[photoId] = value;
    }
    return { profiles, masks };
  },
};
