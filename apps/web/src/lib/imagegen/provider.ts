// 按环境选生图 provider。**不做跨家回落**:生产误把 ARK_API_KEY 配上而
// IMAGE_PROVIDER 仍是 gemini 时,宁可关掉生图入口,也不能把用户描述和产出
// 悄悄改发到另一个国家的服务商 —— 那是合规问题,不是可用性问题。

import { createGeminiProvider } from './gemini';
import { createKexiangProvider } from './kexiang';
import { createSeedreamProvider } from './seedream';
import type { ImageProvider } from './types';

export type ImageProviderEnv = {
  IMAGE_PROVIDER?: 'gemini' | 'ark' | 'kexiang';
  GEMINI_API_KEY?: string;
  ARK_API_KEY?: string;
  ARK_IMAGE_API_KEY?: string;
  KEXIANG_API_KEY?: string;
};

/** 返回 null = 这套环境下生图不可用(缺 key),调用方据此隐藏入口 / 回 501。 */
export function resolveImageProvider(env: ImageProviderEnv): ImageProvider | null {
  const choice = env.IMAGE_PROVIDER ?? 'gemini';
  if (choice === 'kexiang') {
    // 生产主力(2026-10-28 起):中转站异步任务 API,鉴权用 x-api-key **原始 key**
    // (不带 sk-),所以这里把 chat 用的 sk- 前缀剥掉再传。
    const apiKey = (env.KEXIANG_API_KEY ?? env.ARK_API_KEY ?? '').replace(/^sk-/, '');
    return apiKey ? createKexiangProvider({ apiKey }) : null;
  }
  if (choice === 'ark') {
    // 遗留回退:直连火山 seedream。生图有独立的 ARK_IMAGE_API_KEY,只在没配它时
    // 才回落 ARK_API_KEY(兼容旧环境)。
    const apiKey = env.ARK_IMAGE_API_KEY ?? env.ARK_API_KEY;
    return apiKey ? createSeedreamProvider({ apiKey }) : null;
  }
  return env.GEMINI_API_KEY ? createGeminiProvider({ apiKey: env.GEMINI_API_KEY }) : null;
}
