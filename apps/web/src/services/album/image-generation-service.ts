// AI 生图 service。薄编排:纯逻辑在 image-generation-util.ts,上游在 lib/imagegen/*。
//
// 扣费为什么不走 creditService.hold():那套 hold 会往 albums.credit_hold_id 写值
// (为「一册一次建书生成」设计),生图复用会覆盖掉正在进行的建书预留。生图是秒级
// 操作,这里在短事务里直接扣、失败退回,并且用独立的 IMAGE_GEN_* ledger reason,
// 免得把 admin 的 GENERATION_SETTLE 营收统计搅浑。
//
// 顺序是**先扣后生成**:反过来(先生成后扣)会被并发刷 —— 余额 1 分的用户同时发
// 十个请求,十张图全出,只扣得掉一分。先扣的代价是极端情况下(进程猝死)可能扣了
// 钱没出图,所以每笔都往 image_generations 落 prompt 留痕,后台可查可补。

import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { db, type DbOrTx } from '@/db/client';
import { albumRepo } from '@/db/repos/album-repo';
import { creditHoldRepo } from '@/db/repos/credit-hold-repo';
import { imageGenerations, users } from '@/db/schema';
import { ERRORS } from '@/lib/api/error-codes';
import { env } from '@/lib/env';
import { resolveImageProvider } from '@/lib/imagegen/provider';
import { ImageGenError } from '@/lib/imagegen/types';
import { buildUserImagePrompt, sanitizeUserPrompt } from '@/lib/imagegen/user-prompt';
import { r2 } from '@/lib/r2/r2-client';
import { logger } from '@/lib/log/logger';
import { creditService } from '@/services/credit/credit-service';
import { photoOriginalService } from './photo-original-service';
import { photoOriginalKey } from './photo-original-util';
import {
  FREE_RETRIES_PER_GENERATION,
  canRetryFree,
  outcomeForError,
  type GenerateImageBody,
} from './image-generation-util';

const CREDITS_PER_IMAGE = 1;

export type GenerateImageResult = {
  photoId: string;
  generationId: string;
  freeRetriesLeft: number;
  charged: boolean;
};

async function chargeOne(tx: DbOrTx, userId: string, albumId: string): Promise<void> {
  // 与 creditService.hold 同一把锁同一套口径:可用余额 = 余额 − 在途预留。
  const locked = await tx
    .select({ creditBalance: users.creditBalance })
    .from(users)
    .where(eq(users.id, userId))
    .for('update');
  if (!locked[0]) throw ERRORS.UNAUTHORIZED();
  const held = await creditHoldRepo.sumHoldingByUser(tx, userId);
  if (locked[0].creditBalance - held < CREDITS_PER_IMAGE) throw ERRORS.CREDIT_INSUFFICIENT();
  await creditService.applyDelta(tx, userId, -CREDITS_PER_IMAGE, 'IMAGE_GEN_CHARGE', { albumId });
}

export const imageGenerationService = {
  async generate(input: {
    userId: string;
    albumId: string;
    body: GenerateImageBody;
  }): Promise<GenerateImageResult> {
    const provider = resolveImageProvider(env);
    if (!provider) throw ERRORS.IMAGE_GEN_UNAVAILABLE();

    const cleanedPrompt = sanitizeUserPrompt(input.body.prompt);
    if (!cleanedPrompt) throw ERRORS.VALIDATION_FAILED('prompt is empty after sanitising');

    // 1) 归属校验。**刻意不加 album 行锁**:creditService.hold 的锁序是
    //    users -> albums,这里若先锁 albums 再锁 users,同一相册上并发的
    //    「生图」与「加照片/定稿」会撞 40P01 死锁。归属只是读 userId,不需要锁;
    //    相册在这之后被删掉的话,后面写 image_generations 时外键会拦下。
    const album = await albumRepo.findById(input.albumId);
    if (!album) throw ERRORS.ALBUM_NOT_FOUND();
    if (album.userId !== input.userId) throw ERRORS.ALBUM_NOT_OWNED();

    // 2) 决定这次收不收钱 + 收钱。事务里只锁 users。
    const { charged, retryRowId, previousRetries } = await db.transaction(async (tx) => {
      if (input.body.retryOf) {
        const rows = await tx
          .select()
          .from(imageGenerations)
          .where(eq(imageGenerations.id, input.body.retryOf))
          .limit(1);
        const previous = rows[0];
        // 不是本人本册的那笔 → 当成一笔新的生成收钱,而不是报错:
        // 前端状态错乱不该变成用户面前的红字。
        if (previous && previous.albumId === input.albumId && previous.userId === input.userId) {
          if (canRetryFree(previous)) {
            await tx
              .update(imageGenerations)
              .set({ freeRetriesUsed: previous.freeRetriesUsed + 1 })
              .where(eq(imageGenerations.id, previous.id));
            return {
              charged: false,
              retryRowId: previous.id,
              previousRetries: previous.freeRetriesUsed,
            };
          }
        }
      }

      await chargeOne(tx, input.userId, input.albumId);
      return { charged: true, retryRowId: null as string | null, previousRetries: 0 };
    });

    // 3) 生成 + 落盘 + 留痕。**留痕也在 try 里** —— 它失败同样要退钱,
    //    否则用户被扣了分、图也没落进台账,后台连查都查不到。
    const photoId = randomUUID();
    let generationId = retryRowId;
    try {
      const image = await provider.generate({
        prompt: buildUserImagePrompt(cleanedPrompt),
        width: input.body.width,
        height: input.body.height,
      });

      // 用上游真实回报的 mime:Gemini 回的是 PNG,写成 image/jpeg 是在存一句假话。
      // key 仍按 photo-originals 的约定用 .jpg(下游按 photoId 取,不看后缀)。
      await r2.putObject(photoOriginalKey(input.albumId, photoId), image.bytes, image.mime);

      // 尺寸以上游回报的为准:Gemini 只收宽高比,出来的像素尺寸未必是我们请求的那个。
      await photoOriginalService.confirm(input.userId, input.albumId, {
        entries: [
          {
            photoId,
            width: image.width ?? input.body.width,
            height: image.height ?? input.body.height,
            bytes: image.bytes.byteLength,
          },
        ],
      });

      if (retryRowId) {
        // 免费重来:把 prompt 和 photoId 更新成**真正印进书里的这一次**。
        // 不更新的话,留痕行记着的是被用户丢掉的第一张 —— 追责时查到的是错的。
        await db
          .update(imageGenerations)
          .set({ prompt: cleanedPrompt, photoId })
          .where(eq(imageGenerations.id, retryRowId));
      } else {
        const inserted = await db
          .insert(imageGenerations)
          .values({
            albumId: input.albumId,
            userId: input.userId,
            photoId,
            prompt: cleanedPrompt,
            provider: provider.name,
          })
          .returning({ id: imageGenerations.id });
        generationId = inserted[0]!.id;
      }
    } catch (error) {
      const outcome = outcomeForError(error);
      if (outcome.refund && charged) {
        await db.transaction(async (tx) => {
          await creditService.applyDelta(tx, input.userId, CREDITS_PER_IMAGE, 'IMAGE_GEN_REFUND', {
            albumId: input.albumId,
            meta: { reason: outcome.kind, photoId },
          });
        });
      }
      // 失败不消耗免费次数 —— 用户没拿到图,凭什么算他用掉一次机会。
      if (!charged && retryRowId) {
        await db
          .update(imageGenerations)
          .set({ freeRetriesUsed: previousRetries })
          .where(eq(imageGenerations.id, retryRowId));
      }
      logger.error(
        { err: String(error), kind: outcome.kind, albumId: input.albumId, userId: input.userId },
        'image generation failed',
      );
      if (error instanceof ImageGenError && error.kind === 'safety') throw ERRORS.IMAGE_GEN_BLOCKED();
      throw ERRORS.IMAGE_GEN_FAILED();
    }

    return {
      photoId,
      generationId: generationId!,
      // 免费重来复用原来那行,所以重来一次之后就没有剩余次数了 —— 否则
      // 每重来一次都再送一次,等于无限白嫖。
      freeRetriesLeft: charged ? FREE_RETRIES_PER_GENERATION : 0,
      charged,
    };
  },
};
