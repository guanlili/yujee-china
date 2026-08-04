import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '@/db/client';
import { albumRepo } from '@/db/repos/album-repo';
import { draftPageRepo } from '@/db/repos/draft-page-repo';
import { userRepo } from '@/db/repos/user-repo';
import { creditHoldRepo } from '@/db/repos/credit-hold-repo';
import { cleanupUser, isDbReachable, makeAlbum, makeUser } from '@/db/repos/__test__/setup';
import { agentClient } from '@/lib/agent/agent-client';
import { jobService, mergeComposeIntoDraft, type ComposeJobMeta } from '@/services/job/job-service';
import { albumService } from './album-service';
import { TEMPLATES, type Page } from '@yujee/contracts';

// 游客占位成稿:mergeComposeIntoDraft 传空 compose 载荷 = 一本「示例文案书」。
// 纯函数四条硬约束 + applyPlaceholderDesign / 登录后 applyDesign 升级计费的集成闭环。

const COVER_ID = 'mag-01';
const ENDING_ID = 'mag-22';

function interiorPages(): Page[] {
  return [
    {
      pageIndex: 0,
      templateId: 'mag-05',
      images: { image: 'p1' },
      texts: { title: 'SAMPLE TITLE', explain: 'SAMPLE EXPLAIN', body: 'SAMPLE BODY' },
    },
    {
      pageIndex: 1,
      templateId: 'mag-07',
      images: { image1: 'p2', image2: 'p3' },
      texts: { title: 'KEEP TITLE', body: 'KEEP BODY', body2: 'KEEP BODY2' },
    },
  ];
}

function draft() {
  return {
    version: 'v3-story',
    tree: {
      chapters: [
        {
          chapterId: 'c1',
          title: '2024 年 03 月 11–14 日',
          description: '',
          chapterContext: '',
          place: '',
          keywords: [],
          extractedColor: null,
          accentColor: null,
          artFont: null,
          photos: [
            { photoId: 'p1', sceneDescription: '', width: 800, height: 600, orientation: 'landscape' },
            { photoId: 'p2', sceneDescription: '', width: 800, height: 600, orientation: 'landscape' },
            { photoId: 'p3', sceneDescription: '', width: 600, height: 800, orientation: 'portrait' },
          ],
        },
      ],
    },
    pages: interiorPages(),
    progress: { currentChapterId: 'c1', doneChapterIds: [] },
  };
}

const META: ComposeJobMeta = {
  language: 'zh',
  coverTemplateId: COVER_ID,
  coverPhotoId: 'p1',
  endingTemplateId: ENDING_ID,
  endingPhotoId: 'p2',
  extraEndingPhotoIds: ['p3'],
};

const EMPTY_PAYLOAD = { pagesTexts: {}, coverTexts: {}, endingTexts: {}, fonts: {} };

test('空载荷成书:内页 texts 原样保留 sample,一字不动', () => {
  const merged = mergeComposeIntoDraft(draft(), META, EMPTY_PAYLOAD);
  const interior = merged.pages.find((p) => p.templateId === 'mag-05')!;
  assert.equal(interior.texts.title, 'SAMPLE TITLE');
  assert.equal(interior.texts.body, 'SAMPLE BODY');
});

test('空载荷成书:封面/封尾文字槽落模板 sample,不是空白', () => {
  const merged = mergeComposeIntoDraft(draft(), META, EMPTY_PAYLOAD);
  const cover = merged.pages.find((p) => p.templateId === COVER_ID)!;
  for (const slot of TEMPLATES[COVER_ID]!.texts ?? []) {
    const sample = (slot as { sample?: string }).sample;
    if (sample) assert.equal(cover.texts[slot.id], sample, `cover slot ${slot.id} 应为模板 sample`);
  }
});

test('空载荷成书:字体按语言兜底 + carrier 键 + html 重烘 + pageIndex 连续', () => {
  const merged = mergeComposeIntoDraft(draft(), META, EMPTY_PAYLOAD);
  const design = merged.draftJson.design as { fonts: Record<string, string> };
  assert.ok(design.fonts.title, '空 fonts 必须按语言兜底出 title 字体');
  const cover = merged.pages.find((p) => p.templateId === COVER_ID)!;
  assert.ok(cover.texts['title#artFont'], '封面 title 槽必须有 artFont carrier');
  merged.pages.forEach((p, idx) => {
    assert.equal(p.pageIndex, idx, 'pageIndex 必须整册连续');
    assert.ok(p.html, `page ${idx} 必须重烘出 html`);
  });
  // 首尾闭合:第 0 页是封面,最后一页是封尾。
  assert.equal(merged.pages[0]!.templateId, COVER_ID);
  assert.equal(merged.pages[merged.pages.length - 1]!.templateId, ENDING_ID);
});

// ── 集成:applyPlaceholderDesign / 登录后升级计费 ──────────────────────────────

async function seedEditingAlbum(userId: string) {
  const album = await makeAlbum(userId, { photoCount: 3 });
  await albumRepo.update(db, album.id, { status: 'EDITING', stage: 'theme', draftJson: draft() });
  return (await albumRepo.findById(album.id))!;
}

const DESIGN_INPUT = {
  language: 'zh' as const,
  coverTemplateId: COVER_ID,
  coverPhotoId: 'p1',
  endingTemplateId: ENDING_ID,
  endingPhotoId: 'p2',
};

test('applyPlaceholderDesign: 同步成书,stage=ready + copySource=placeholder,零积分变动', async (t: TestContext) => {
  if (!(await isDbReachable())) { t.skip('DATABASE_URL is not reachable'); return; }
  const anon = await userRepo.upsertById(db, {
    email: `anon-design-${Date.now()}@yujee.test`,
    name: 'Anonymous',
    isAnonymous: true,
    creditBalance: 0,
  });
  try {
    const album = await seedEditingAlbum(anon.id);
    const res = await albumService.applyPlaceholderDesign(anon.id, album.id, DESIGN_INPUT);
    assert.equal(res.placeholder, true);

    const after = (await albumRepo.findById(album.id))!;
    assert.equal(after.stage, 'ready');
    assert.equal(after.copySource, 'placeholder');
    assert.equal(after.creditHoldId, null);
    assert.equal(after.pageCount, 4); // 封面 + 2 内页 + 封尾

    const rows = await draftPageRepo.findByAlbum(album.id);
    const templates = rows.map((r) => (r.page as Page).templateId);
    assert.ok(templates.includes(COVER_ID) && templates.includes(ENDING_ID));

    const balance = (await userRepo.findById(anon.id))!.creditBalance;
    assert.equal(balance, 0);
  } finally {
    await cleanupUser(anon.id);
  }
});

test('applyDesign(升级): placeholder 书余额不足 402;足额则挂 hold,compose 回调 settle + copySource=ai', async (t: TestContext) => {
  if (!(await isDbReachable())) { t.skip('DATABASE_URL is not reachable'); return; }
  const broke = await userRepo.upsertById(db, {
    email: `upgrade-broke-${Date.now()}@yujee.test`,
    name: 'Broke',
    creditBalance: 0,
  });
  const rich = await makeUser('upgrade-rich'); // creditBalance 100
  try {
    // 余额 0:占位书升级被 402 拦住(普通书不收这道钱,见下一段)。
    const brokeAlbum = await seedEditingAlbum(broke.id);
    await albumService.applyPlaceholderDesign(broke.id, brokeAlbum.id, DESIGN_INPUT);
    await albumRepo.update(db, brokeAlbum.id, { status: 'EDITING' });
    await assert.rejects(
      () => albumService.applyDesign(broke.id, brokeAlbum.id, { ...DESIGN_INPUT, refs: {} }),
      (e: { code?: string }) => e.code === 'CREDIT_INSUFFICIENT',
    );

    // 足额:applyDesign 挂 hold → compose 完成回调 settle + copySource='ai'。
    const richAlbum = await seedEditingAlbum(rich.id);
    await albumService.applyPlaceholderDesign(rich.id, richAlbum.id, DESIGN_INPUT);
    await albumRepo.update(db, richAlbum.id, { status: 'EDITING' });
    t.mock.method(agentClient, 'submitComposeV3', async () => ({ requestId: 'x' }));
    const res = await albumService.applyDesign(rich.id, richAlbum.id, { ...DESIGN_INPUT, refs: {} });

    const held = (await albumRepo.findById(richAlbum.id))!;
    assert.ok(held.creditHoldId, '占位书升级必须挂 hold');

    await jobService.handleV3ComposeCompleted(res.requestId, EMPTY_PAYLOAD, null);

    const done = (await albumRepo.findById(richAlbum.id))!;
    assert.equal(done.copySource, 'ai');
    const hold = await creditHoldRepo.findById(held.creditHoldId!);
    assert.equal(hold?.status, 'SETTLED');
    const balance = (await userRepo.findById(rich.id))!.creditBalance;
    assert.equal(balance, 97); // 100 - cost(3 photos)
  } finally {
    await cleanupUser(broke.id);
    await cleanupUser(rich.id);
  }
});

test('普通相册 applyDesign 不重复计费(copySource 非 placeholder 不 precheck/hold)', async (t: TestContext) => {
  if (!(await isDbReachable())) { t.skip('DATABASE_URL is not reachable'); return; }
  const user = await userRepo.upsertById(db, {
    email: `normal-design-${Date.now()}@yujee.test`,
    name: 'Normal',
    creditBalance: 0, // 余额 0 也能确认封面:普通书的钱在 analyze 时已结算
  });
  try {
    const album = await seedEditingAlbum(user.id);
    t.mock.method(agentClient, 'submitComposeV3', async () => ({ requestId: 'x' }));
    const res = await albumService.applyDesign(user.id, album.id, { ...DESIGN_INPUT, refs: {} });
    assert.equal(res.accepted, true);
    const after = (await albumRepo.findById(album.id))!;
    assert.equal(after.creditHoldId, null); // 没挂新 hold
  } finally {
    await cleanupUser(user.id);
  }
});
