// 按环境选生图 provider。**不做跨家回落**:生产误把 ARK_API_KEY 配上而
// IMAGE_PROVIDER 仍是 gemini 时,宁可关掉生图入口,也不能把用户描述和产出
// 悄悄改发到另一个国家的服务商 —— 那是合规问题,不是可用性问题。

import { createGeminiProvider } from './gemini';
import { createSeedreamProvider } from './seedream';
import type { ImageProvider } from './types';

export type ImageProviderEnv = {
  IMAGE_PROVIDER?: 'gemini' | 'ark';
  GEMINI_API_KEY?: string;
  ARK_API_KEY?: string;
};

/** 返回 null = 这套环境下生图不可用(缺 key),调用方据此隐藏入口 / 回 501。 */
export function resolveImageProvider(env: ImageProviderEnv): ImageProvider | null {
  const choice = env.IMAGE_PROVIDER ?? 'gemini';
  if (choice === 'ark') {
    return env.ARK_API_KEY ? createSeedreamProvider({ apiKey: env.ARK_API_KEY }) : null;
  }
  return env.GEMINI_API_KEY ? createGeminiProvider({ apiKey: env.GEMINI_API_KEY }) : null;
}
