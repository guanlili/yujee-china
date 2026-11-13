import { test } from 'node:test';
import assert from 'node:assert/strict';

import { db } from '../../db/client';
import { cleanupUser, isDbReachable, makeAlbum, makeUser } from '../../db/repos/__test__/setup';
import { env } from '../../lib/env';
import { r2 } from '../../lib/r2/r2-client';
import { photoOriginalService } from './photo-original-service';
import { imageGenerationService } from './image-generation-service';
import { imageGenerations } from '../../db/schema';
import { eq } from 'drizzle-orm';

/* AI 生图的计费编排(service 层核心不变量;纯逻辑已在 image-generation-util.test.ts):
   1. 扣费闸门与 creditService.hold 同一口径:可用额度 = 余额 − 在途(HOLDING)预留,
      裸余额够但被建书预留占住时,生图必须 402 —— 不然秒级扣费会绕过建书守门。
   2. 先扣后生成:上游/落盘失败一律退款(IMAGE_GEN_REFUND),钱扣了图没出是最伤
      用户的情况;免费重来失败不消耗次数。
   3. 免费重来:本人本册才认账(FREE_RETRIES_PER_GENERATION=1),用尽后重来照常扣费,
      不给「无限白嫖」开口子;别人册/不存在的那笔当新生成收钱。
   外部 seam 用仓库同款 t.mock.method 打桩:gemini provider 走 globalThis.fetch,
   R2 落盘与 photo-originals 台账 confirm 是导出对象方法。 */

const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]); // 只需非空字节,桩不真写

function fakeGeminiOk(t: { mock: { method: typeof import('node:test').mock.method } }) {
  return t.mock.method(globalThis, 'fetch', (async () => {
    const body = {
      candidates: [
        {
          finishReason: 'STOP',
          content: {
            parts: [{ inlineData: { mimeType: 'image/png', data: Buffer.from(PNG_BYTES).toString('base64') } }],
          },
        },
      ],
    };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch);
}

function fakeGemini500(t: { mock: { method: typeof import('node:test').mock.method } }) {
  return t.mock.method(globalThis, 'fetch', (async () => new Response('boom', { status: 500 })) as typeof fetch);
}

/** 打桩 R2 与台账确认;生图编排测试不需要真写对象存储。 */
function stubStorage(t: { mock: { method: typeof import('node:test').mock.method } }) {
  t.mock.method(r2, 'putObject', async () => {});
  t.mock.method(photoOriginalService, 'confirm', async () => {});
}

async function makeBody(prompt = 'a warm sunset over the lake') {
  return { prompt, width: 1024, height: 1024 };
}

test('generate: 扣费走「余额 − 在途」闸门 —— 建书预留占住的额度,生图不许绕过(402)', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping integration test');
    return;
  }
  const saved = { IMAGE_PROVIDER: env.IMAGE_PROVIDER, GEMINI_API_KEY: env.GEMINI_API_KEY };
  env.IMAGE_PROVIDER = 'gemini';
  (env as Record<string, unknown>).GEMINI_API_KEY = 'test-key-for-fetch-stub';
  const fetchMock = fakeGeminiOk(t);
  stubStorage(t);
  const user = await makeUser('imggen-gate');
  try {
    const album = await makeAlbum(user.id);
    // 把余额设为 3:建书 hold 占 3 后裸余额 3、可用 0 —— 生图要 1 分,
    // 事故口径下(只看裸余额)会放行,正确行为是被在途占住的额度拒掉。
    const { users } = await import('../../db/schema');
    await db.update(users).set({ creditBalance: 3 }).where(eq(users.id, user.id));
    const { creditService } = await import('../credit/credit-service');
    await db.transaction(async (tx) => {
      await creditService.hold(tx, user.id, 3, album.id);
    });

    await assert.rejects(
      imageGenerationService.generate({ userId: user.id, albumId: album.id, body: await makeBody() }),
      (e: unknown) => (e as { code?: string }).code === 'CREDIT_INSUFFICIENT',
      '可用额度不足时必须 402,即使裸余额还够',
    );

    // 释放建书预留后,同一笔生图应放行并扣 1 分。
    const holdId = (await (await import('../../db/repos/album-repo')).albumRepo.findById(album.id))!.creditHoldId!;
    await db.transaction(async (tx) => {
      await creditService.release(tx, holdId);
    });
    const result = await imageGenerationService.generate({
      userId: user.id,
      albumId: album.id,
      body: await makeBody(),
    });
    assert.equal(result.charged, true);
    assert.equal(fetchMock.mock.callCount(), 1);
    const { creditService: cs } = await import('../credit/credit-service');
    assert.equal(await cs.getBalance(user.id), 2, '3 − 1(生图) = 2');
  } finally {
    Object.assign(env, saved);
    await cleanupUser(user.id);
  }
});

test('generate: 先扣后生成 —— 上游失败要退款,免费重来失败不消耗次数', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping integration test');
    return;
  }
  const saved = { IMAGE_PROVIDER: env.IMAGE_PROVIDER, GEMINI_API_KEY: env.GEMINI_API_KEY };
  env.IMAGE_PROVIDER = 'gemini';
  (env as Record<string, unknown>).GEMINI_API_KEY = 'test-key-for-fetch-stub';
  stubStorage(t);
  const user = await makeUser('imggen-refund');
  try {
    const album = await makeAlbum(user.id);
    const { creditService } = await import('../credit/credit-service');
    const { creditLedgerRepo } = await import('../../db/repos/credit-ledger-repo');

    // 付费生成失败:扣 1 → 退 1,净额不变,退款的 ledger 行带 IMAGE_GEN_REFUND。
    fakeGemini500(t);
    await assert.rejects(
      imageGenerationService.generate({ userId: user.id, albumId: album.id, body: await makeBody() }),
      (e: unknown) => (e as { code?: string }).code === 'IMAGE_GEN_FAILED',
    );
    assert.equal(await creditService.getBalance(user.id), 100, '失败退款后净额不变');
    const refundRow = (await creditLedgerRepo.findByUser(user.id, 20)).find(
      (r) => r.reason === 'IMAGE_GEN_REFUND',
    );
    assert.ok(refundRow, '退款必须落 IMAGE_GEN_REFUND 行');
    assert.equal(refundRow!.delta, +1);

    // 成功一次(带免费重试资格),再让上游失败一次免费重来:不扣钱、次数不消耗。
    fakeGeminiOk(t);
    const ok1 = await imageGenerationService.generate({
      userId: user.id,
      albumId: album.id,
      body: await makeBody(),
    });
    assert.equal(ok1.charged, true);
    assert.equal(ok1.freeRetriesLeft, 1, '付费生成附 1 次免费重来');
    const rows = await db.select().from(imageGenerations).where(eq(imageGenerations.id, ok1.generationId));
    assert.equal(rows[0]!.freeRetriesUsed, 0);

    fakeGemini500(t);
    await assert.rejects(
      imageGenerationService.generate({
        userId: user.id,
        albumId: album.id,
        body: { ...(await makeBody()), retryOf: ok1.generationId },
      }),
      (e: unknown) => (e as { code?: string }).code === 'IMAGE_GEN_FAILED',
    );
    const rowsAfter = await db.select().from(imageGenerations).where(eq(imageGenerations.id, ok1.generationId));
    assert.equal(rowsAfter[0]!.freeRetriesUsed, 0, '免费重来失败不消耗次数');
    assert.equal(await creditService.getBalance(user.id), 99, '免费重来失败也不扣钱');

    // 免费重来成功:不扣钱、次数消耗、留痕行更新成真正生效的那张。
    fakeGeminiOk(t);
    const retry = await imageGenerationService.generate({
      userId: user.id,
      albumId: album.id,
      body: { prompt: 'a calm morning mist', width: 1024, height: 1024, retryOf: ok1.generationId },
    });
    assert.equal(retry.charged, false);
    assert.equal(retry.freeRetriesLeft, 0, '免费重来用尽,不再送');
    assert.equal(retry.generationId, ok1.generationId, '复用原留痕行');
    assert.equal(await creditService.getBalance(user.id), 99, '免费重来不扣钱');
    const rowsRetry = await db.select().from(imageGenerations).where(eq(imageGenerations.id, ok1.generationId));
    assert.equal(rowsRetry[0]!.freeRetriesUsed, 1);
    assert.equal(rowsRetry[0]!.prompt, 'a calm morning mist', '留痕更新为真正生效的 prompt');

    // 重来资格已用尽:再来一次照常扣费。
    const paid2 = await imageGenerationService.generate({
      userId: user.id,
      albumId: album.id,
      body: { ...(await makeBody()), retryOf: ok1.generationId },
    });
    assert.equal(paid2.charged, true, '免费次数用尽后,重来按新生成收费');
    assert.equal(await creditService.getBalance(user.id), 98);
  } finally {
    Object.assign(env, saved);
    await cleanupUser(user.id);
  }
});

test('generate: retryOf 不是本人本册的行 → 当新生成收钱,不是报错', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping integration test');
    return;
  }
  const saved = { IMAGE_PROVIDER: env.IMAGE_PROVIDER, GEMINI_API_KEY: env.GEMINI_API_KEY };
  env.IMAGE_PROVIDER = 'gemini';
  (env as Record<string, unknown>).GEMINI_API_KEY = 'test-key-for-fetch-stub';
  fakeGeminiOk(t);
  stubStorage(t);
  const userA = await makeUser('imggen-a');
  const userB = await makeUser('imggen-b');
  try {
    const albumA = await makeAlbum(userA.id);
    const albumB = await makeAlbum(userB.id);
    const first = await imageGenerationService.generate({
      userId: userA.id,
      albumId: albumA.id,
      body: await makeBody(),
    });

    // userB 拿着 userA 的 generationId 来重试:按新生成收 userB 的钱。
    const result = await imageGenerationService.generate({
      userId: userB.id,
      albumId: albumB.id,
      body: { ...(await makeBody()), retryOf: first.generationId },
    });
    assert.equal(result.charged, true, '别人的重试 id 不给白嫖');
    assert.notEqual(result.generationId, first.generationId, '落一行新留痕');
    const { creditService } = await import('../credit/credit-service');
    assert.equal(await creditService.getBalance(userB.id), 99, 'userB 被扣 1');
    assert.equal(await creditService.getBalance(userA.id), 99, 'userA 不受影响');
  } finally {
    Object.assign(env, saved);
    await cleanupUser(userA.id);
    await cleanupUser(userB.id);
  }
});
