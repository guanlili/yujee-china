import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { TEMPLATES } from '@yujee/contracts';
import type { Page } from '@yujee/contracts';
import { db } from '../../db/client';
import { albumRepo } from '../../db/repos/album-repo';
import { agentJobRepo } from '../../db/repos/agent-job-repo';
import { cleanupUser, isDbReachable, makeAlbum, makeUser } from '../../db/repos/__test__/setup';
import { agentClient } from '../../lib/agent/agent-client';
import { albumService } from './album-service';
import { sweepCarriers } from './design-apply';
import { jobService, readComposeAppendMeta } from '../job/job-service';

// 追加范围成稿(composeAppend)四条硬约束:
//   ① 已设计的书:建 kind='compose' job(meta.composeAppend),只转发新章的空槽请求
//      (coverSlots/endingSlots 全空 → engine 跳过全局批次,不写封面/不动字体);
//   ② 未设计的书(draft 里无 carrier)→ composed:false,不建 job、不调 agent(新页文案
//      等用户选封面时随全书成稿一起写);
//   ③ scope 里有未知 chapterId → VALIDATION_FAILED;
//   ④ scope 里的章在增量排版落地前调用(章里没有已排版页)→ VALIDATION_FAILED(时序防错)。

type TemplateInfo = { id: string; category?: string; texts?: Array<{ id: string; role: string }> };
const interior = (Object.values(TEMPLATES) as TemplateInfo[]).find(
  (t) => t.category === 'interior' && (t.texts ?? []).some((s) => s.role === 'title'),
)!;
const FONTS = { title: 'Fraunces', body: 'Inter', decoration: 'Caveat' };
const COLORS = { title: '#111111', body: '#222222', explain: '#333333' };

function chapterNode(chapterId: string, photoId: string) {
  return {
    chapterId,
    description: '',
    chapterContext: '追加章的采访原话',
    accentColor: null,
    artFont: null,
    photos: [{ photoId, sceneDescription: '', width: 800, height: 600, orientation: 'landscape' as const }],
  };
}

// 已设计的书:两章,addx-c1 是追加章,其页已增量排版落地(images 引用追加照片)。
function designedDraft() {
  const pages: Page[] = sweepCarriers(
    [
      { pageIndex: 0, templateId: interior.id, images: { image: 'p-old' }, texts: {} },
      { pageIndex: 1, templateId: interior.id, images: { image: 'p-new' }, texts: {} },
    ],
    FONTS,
    COLORS,
  );
  return {
    version: 'v3-story' as const,
    tree: { chapters: [chapterNode('c1', 'p-old'), chapterNode('addx-c1', 'p-new')] },
    pages,
    progress: { currentChapterId: null, doneChapterIds: ['c1', 'addx-c1'] },
  };
}

test('composeAppend', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL not reachable');
    return;
  }
  const user = await makeUser('compose-append');
  try {
    await t.test('已设计:建 kind=compose job(meta.composeAppend)并转发只含新章的空槽请求', async () => {
      const album = await makeAlbum(user.id);
      await albumRepo.update(db, album.id, { status: 'EDITING', draftJson: designedDraft() });
      const submit = mock.method(agentClient, 'submitComposeV3', async () => ({ requestId: 'r' }));
      try {
        const res = await albumService.composeAppend(user.id, album.id, {
          language: 'zh',
          chapterIds: ['addx-c1'],
          refs: { 'p-new': 'data:image/jpeg;base64,AAAA' },
        });

        assert.equal(res.composed, true);
        const payload = submit.mock.calls[0]!.arguments[0]!;
        assert.deepEqual(payload.chapters.map((c: { chapterId: string }) => c.chapterId), ['addx-c1']);
        assert.equal(payload.coverSlots.length, 0);
        assert.equal(payload.endingSlots.length, 0);
        const job = await agentJobRepo.findByRequestId(res.requestId!);
        assert.equal(job?.kind, 'compose');
        assert.deepEqual(readComposeAppendMeta(job?.meta), { language: 'zh', chapterIds: ['addx-c1'] });
      } finally {
        submit.mock.restore();
      }
    });

    await t.test('未设计(无 carrier):composed:false,不建 job 不调 agent', async () => {
      const album = await makeAlbum(user.id);
      const draft = designedDraft();
      // 洗掉 carrier:回到未设计形态
      draft.pages = draft.pages.map((p) => ({ ...p, texts: {} }));
      await albumRepo.update(db, album.id, { status: 'EDITING', draftJson: draft });
      const submit = mock.method(agentClient, 'submitComposeV3', async () => ({ requestId: 'r' }));
      try {
        const res = await albumService.composeAppend(user.id, album.id, { language: 'zh', chapterIds: ['addx-c1'] });
        assert.equal(res.composed, false);
        assert.equal(submit.mock.callCount(), 0);
      } finally {
        submit.mock.restore();
      }
    });

    await t.test('未知 chapterId → VALIDATION_FAILED', async () => {
      const album = await makeAlbum(user.id);
      await albumRepo.update(db, album.id, { status: 'EDITING', draftJson: designedDraft() });
      await assert.rejects(
        albumService.composeAppend(user.id, album.id, { language: 'zh', chapterIds: ['ghost'] }),
        (err: { code?: string }) => err.code === 'VALIDATION_FAILED',
      );
    });

    await t.test('章里没有已排版页 → VALIDATION_FAILED(时序防错)', async () => {
      const album = await makeAlbum(user.id);
      const draft = designedDraft();
      draft.pages = draft.pages.filter((p) => p.images.image !== 'p-new'); // 追加章的页还没合并
      await albumRepo.update(db, album.id, { status: 'EDITING', draftJson: draft });
      await assert.rejects(
        albumService.composeAppend(user.id, album.id, { language: 'zh', chapterIds: ['addx-c1'] }),
        (err: { code?: string }) => err.code === 'VALIDATION_FAILED',
      );
    });

    await t.test('listCoverSets: 最近一单 compose 的状态透出为 lastComposeStatus', async () => {
      const album = await makeAlbum(user.id);
      await albumRepo.update(db, album.id, { status: 'EDITING', draftJson: designedDraft() });
      const requestId = crypto.randomUUID();
      await db.transaction(async (tx) => {
        const job = await jobService.createGenerationJob(tx, {
          userId: user.id, albumId: album.id, requestId, kind: 'compose',
          meta: { composeAppend: { language: 'zh', chapterIds: ['addx-c1'] } },
        });
        await jobService.markRunning(tx, job.id);
      });
      let state = await albumService.listCoverSets(user.id, album.id);
      assert.equal(state.composing, true);
      assert.equal(state.lastComposeStatus, 'RUNNING');

      await jobService.handleV3ComposeCompleted(requestId, { pagesTexts: {} }, null);
      state = await albumService.listCoverSets(user.id, album.id);
      assert.equal(state.composing, false);
      assert.equal(state.lastComposeStatus, 'COMPLETED');
    });
  } finally {
    await cleanupUser(user.id);
  }
});
