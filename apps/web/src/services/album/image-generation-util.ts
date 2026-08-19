// AI 生图的纯逻辑(校验 / 免费重试判定 / 失败处置),与 photo-original-util.ts 同一
// 分层套路:不碰 DB、R2、上游,可在 node:test 下直接单测;service 只做薄编排。

import { z } from 'zod';

import { ImageGenError } from '@/lib/imagegen/types';
import { MAX_USER_PROMPT_CHARS } from '@/lib/imagegen/user-prompt';

/**
 * 每笔付费生成附带几次免费重来。**这个数字是算出来的,不是拍的**:
 * 整页大图按 1448×2048 出,单张 ¥0.232;1 积分售价 ¥0.71–1.07。
 * 给 1 次免费(共 2 张)毛利 1.5×–2.3×,给 2 次(共 3 张)就打平了。
 * 详见 docs/specs/2026-08-18-ai-image-generation-design.md「尺寸与成本」。
 */
export const FREE_RETRIES_PER_GENERATION = 1;

/** 单次生成的像素上限:尺寸直接决定上游账单,不设上限等于给账单开口子。 */
const MAX_EDGE = 4096;

export const GenerateImageBodySchema = z
  .object({
    prompt: z.string().trim().min(1, 'prompt is required').max(MAX_USER_PROMPT_CHARS * 4),
    width: z.number().int().positive().max(MAX_EDGE),
    height: z.number().int().positive().max(MAX_EDGE),
    // 续上一笔生成的免费重来。不传 = 新的一笔,要扣分。
    retryOf: z.string().min(1).max(64).optional(),
  })
  .strict()
  .refine((v) => v.width * v.height <= MAX_EDGE * MAX_EDGE, 'requested image is too large');

export type GenerateImageBody = z.infer<typeof GenerateImageBodySchema>;

export function canRetryFree(generation: { freeRetriesUsed: number }): boolean {
  return generation.freeRetriesUsed < FREE_RETRIES_PER_GENERATION;
}

export type FailureOutcome = {
  /** 一律退钱。钱扣了图没出是最伤用户的情况,任何失败都不许留在扣费状态。 */
  refund: boolean;
  /** 是否消耗掉那次免费重来。失败一律不消耗 —— 用户没拿到图,凭什么算他用了机会。 */
  consumesFreeRetry: boolean;
  /** 前端据此决定是给「重试」还是给「换个描述」。 */
  retryable: boolean;
  kind: string;
};

export function outcomeForError(error: unknown): FailureOutcome {
  const kind = error instanceof ImageGenError ? error.kind : 'unknown';
  return {
    refund: true,
    consumesFreeRetry: false,
    // 安全拒绝重试多少次都一样,得让用户改描述;其余(上游 5xx / 网络 / 写盘)可重试。
    retryable: kind !== 'safety',
    kind,
  };
}
