import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';

import { db } from '@/db/client';
import { agentJobRepo } from '@/db/repos/agent-job-repo';
import { albumRepo } from '@/db/repos/album-repo';
import { cleanupUser, isDbReachable, makeAlbum, makeUser } from '@/db/repos/__test__/setup';
import { agentClient } from '@/lib/agent/agent-client';
import { jobService } from '@/services/job/job-service';
import { transientLayoutCandidates } from '@/services/album/layout-candidates';
import {
  buildJudgeLayoutRequest,
  buildSelectLayoutRequestFromTree,
  generationService,
} from './generation-service';

const TREE = {
  chapters: [
    {
      chapterId: 'ch_1',
      description: 'Coast morning',
      accentColor: null,
      artFont: null,
      photos: [
        {
          photoId: 'p1',
          sceneDescription: 'beach',
          width: 800,
          height: 600,
          orientation: 'landscape' as const,
          takenAt: '2024-03-15T08:30:00',
        },
        {
          photoId: 'p2',
          sceneDescription: 'portrait',
          width: 600,
          height: 800,
          orientation: 'portrait' as const,
          takenAt: null,
        },
      ],
    },
  ],
};

test('buildSelectLayoutRequestFromTree sends 200px refs and never caller candidates', () => {
  const request = buildSelectLayoutRequestFromTree({
    requestId: 'layout-r1',
    callbackUrl: 'https://web.test/api/v3/internal/job-progress',
    language: 'en',
    tree: TREE,
    refs: {
      p1: 'data:image/jpeg;base64,AA==',
      p2: 'data:image/jpeg;base64,BB==',
    },
  });

  assert.deepEqual(request, {
    requestId: 'layout-r1',
    callbackUrl: 'https://web.test/api/v3/internal/job-progress',
    language: 'en',
    chapters: [
      {
        chapterId: 'ch_1',
        structureHint: 'Coast morning',
        chapterContext: '',
        photos: [
          {
            photoId: 'p1',
            ref200px: 'data:image/jpeg;base64,AA==',
            orientation: 'landscape',
            takenAt: '2024-03-15T08:30:00',
            sceneDescription: 'beach',
          },
          {
            photoId: 'p2',
            ref200px: 'data:image/jpeg;base64,BB==',
            orientation: 'portrait',
            takenAt: null,
            sceneDescription: 'portrait',
          },
        ],
      },
    ],
  });
  assert.equal(JSON.stringify(request).includes('candidates'), false);
});

test('buildSelectLayoutRequestFromTree requires every tree photo to have a browser 200px ref', () => {
  assert.throws(() =>
    buildSelectLayoutRequestFromTree({
      requestId: 'layout-r1',
      callbackUrl: 'https://web.test/api/v3/internal/job-progress',
      language: 'en',
      tree: TREE,
      refs: { p1: 'data:image/jpeg;base64,AA==' },
    }),
  );
});

const REFS = {
  p1: 'data:image/jpeg;base64,AA==',
  p2: 'data:image/jpeg;base64,BB==',
};

const PAGES = [{ pageIndex: 0, templateId: 'mag-02', images: { 'cells[0].image': 'p1' }, texts: {} }];
const USAGE = { durationMs: 1, models: {} };

async function seedLayoutReadyAlbum(userId: string, requestId: string) {
  const album = await makeAlbum(userId);
  await jobService.createGenerationJob(db, { userId, albumId: album.id, requestId, kind: 'init' });
  await jobService.handleV3AnalyzeCompleted(requestId, TREE, USAGE);
  return album;
}

test('submitSelectLayoutV3 rejects a missing job before posting to Agent', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const user = await makeUser('select-layout-missing-job');
  try {
    const album = await makeAlbum(user.id);
    await albumRepo.update(db, album.id, {
      status: 'AGENT_RUNNING',
      stage: 'analysing',
      draftJson: { version: 'v3-story', tree: TREE, progress: { currentChapterId: 'ch_1', doneChapterIds: [] } },
    });
    let posted = false;
    t.mock.method(agentClient, 'submitSelectLayoutV3', async () => {
      posted = true;
      return { requestId: 'missing-layout-job', accepted: true };
    });

    await assert.rejects(
      generationService.submitSelectLayoutV3(user.id, album.id, {
        requestId: 'missing-layout-job',
        language: 'en',
        refs: REFS,
      }),
      (err: unknown) => (err as { code?: string }).code === 'JOB_NOT_FOUND',
    );
    assert.equal(posted, false);
  } finally {
    await cleanupUser(user.id);
  }
});

test('submitSelectLayoutV3 rejects a requestId that belongs to another album', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const user = await makeUser('select-layout-wrong-job');
  try {
    const album = await makeAlbum(user.id);
    await albumRepo.update(db, album.id, {
      status: 'AGENT_RUNNING',
      stage: 'analysing',
      draftJson: { version: 'v3-story', tree: TREE, progress: { currentChapterId: 'ch_1', doneChapterIds: [] } },
    });
    const other = await seedLayoutReadyAlbum(user.id, 'layout-other-album');
    let posted = false;
    t.mock.method(agentClient, 'submitSelectLayoutV3', async () => {
      posted = true;
      return { requestId: 'layout-other-album', accepted: true };
    });

    await assert.rejects(
      generationService.submitSelectLayoutV3(user.id, album.id, {
        requestId: 'layout-other-album',
        language: 'en',
        refs: REFS,
      }),
      (err: unknown) => (err as { code?: string }).code === 'JOB_NOT_OWNED',
    );
    assert.equal(posted, false);
    const otherJob = await agentJobRepo.findByRequestId('layout-other-album');
    assert.equal(otherJob?.albumId, other.id);
  } finally {
    await cleanupUser(user.id);
  }
});

test('submitSelectLayoutV3 requires the existing job to be in layout progress', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const user = await makeUser('select-layout-not-ready');
  try {
    const album = await makeAlbum(user.id);
    await albumRepo.update(db, album.id, {
      status: 'AGENT_RUNNING',
      stage: 'analysing',
      draftJson: { version: 'v3-story', tree: TREE, progress: { currentChapterId: 'ch_1', doneChapterIds: [] } },
    });
    await jobService.createGenerationJob(db, {
      userId: user.id,
      albumId: album.id,
      requestId: 'layout-not-ready',
      kind: 'init',
    });
    let posted = false;
    t.mock.method(agentClient, 'submitSelectLayoutV3', async () => {
      posted = true;
      return { requestId: 'layout-not-ready', accepted: true };
    });

    await assert.rejects(
      generationService.submitSelectLayoutV3(user.id, album.id, {
        requestId: 'layout-not-ready',
        language: 'en',
        refs: REFS,
      }),
      (err: unknown) => (err as { code?: string }).code === 'ALBUM_NOT_EDITABLE',
    );
    assert.equal(posted, false);
  } finally {
    await cleanupUser(user.id);
  }
});

test('submitSelectLayoutV3 reuses the analyze job requestId so the select-layout callback lands', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const user = await makeUser('select-layout-callback');
  try {
    const album = await seedLayoutReadyAlbum(user.id, 'layout-ready');
    const posted: unknown[] = [];
    t.mock.method(agentClient, 'submitSelectLayoutV3', async (payload: unknown) => {
      posted.push(payload);
      return { requestId: 'layout-ready', accepted: true };
    });

    const result = await generationService.submitSelectLayoutV3(user.id, album.id, {
      requestId: 'layout-ready',
      language: 'en',
      refs: REFS,
    });
    assert.deepEqual(result, { albumId: album.id, requestId: 'layout-ready', accepted: true });
    assert.equal(posted.length, 1);
    assert.equal((posted[0] as { requestId?: string }).requestId, 'layout-ready');

    await jobService.handleV3SelectLayoutCompleted('layout-ready', PAGES, USAGE);
    const reloaded = await albumRepo.findById(album.id);
    assert.equal(reloaded?.status, 'EDITING');
    assert.deepEqual((reloaded?.draftJson as { pages?: unknown }).pages, PAGES);
  } finally {
    await cleanupUser(user.id);
  }
});

test('submitSelectLayoutV3 reserves the layout handoff so duplicate posts do not start duplicate agent work', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const user = await makeUser('select-layout-reserve');
  try {
    const album = await seedLayoutReadyAlbum(user.id, 'layout-reserve');
    let posts = 0;
    t.mock.method(agentClient, 'submitSelectLayoutV3', async () => {
      posts += 1;
      return { requestId: 'layout-reserve', accepted: true };
    });

    await generationService.submitSelectLayoutV3(user.id, album.id, {
      requestId: 'layout-reserve',
      language: 'en',
      refs: REFS,
    });
    await generationService.submitSelectLayoutV3(user.id, album.id, {
      requestId: 'layout-reserve',
      language: 'en',
      refs: REFS,
    });

    assert.equal(posts, 1);
  } finally {
    await cleanupUser(user.id);
  }
});

test('submitSelectLayoutV3 rejects malformed browser refs before reserving or posting to Agent', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const user = await makeUser('select-layout-bad-ref');
  try {
    const album = await seedLayoutReadyAlbum(user.id, 'layout-bad-ref');
    let posted = false;
    t.mock.method(agentClient, 'submitSelectLayoutV3', async () => {
      posted = true;
      return { requestId: 'layout-bad-ref', accepted: true };
    });

    await assert.rejects(
      generationService.submitSelectLayoutV3(user.id, album.id, {
        requestId: 'layout-bad-ref',
        language: 'en',
        refs: { p1: 'not-a-data-url', p2: 'data:image/jpeg;base64,BB==' },
      }),
      (err: unknown) => (err as { code?: string }).code === 'VALIDATION_FAILED',
    );

    const job = await agentJobRepo.findByRequestId('layout-bad-ref');
    assert.equal(posted, false);
    assert.equal(job?.status, 'RUNNING');
    assert.equal(job?.stage, 'layout');
    assert.equal(job?.progress, 50);
  } finally {
    await cleanupUser(user.id);
  }
});

// ── P2 two-phase select-layout (docs/agent/contract.md §5.2.1) ──

const CANDIDATE_UNITS = [
  {
    unitKey: 'ch_1',
    chapterId: 'ch_1',
    candidates: [
      { candidateIndex: 0, pages: [{ templateId: 'mag-02', images: { image: 'p1' } }] },
      { candidateIndex: 1, pages: [{ templateId: 'mag-04', images: { image1: 'p1', image2: 'p2' } }] },
    ],
  },
];

const JUDGE_UNITS = [
  {
    unitKey: 'ch_1',
    chapterId: 'ch_1',
    candidates: [
      { candidateIndex: 0, thumbnail: 'data:image/jpeg;base64,AA==', pages: [{ templateId: 'mag-02', images: { image: 'p1' } }] },
      { candidateIndex: 1, thumbnail: 'data:image/jpeg;base64,BB==', pages: [{ templateId: 'mag-04', images: { image1: 'p1', image2: 'p2' } }] },
    ],
  },
];

// Drive a job to the candidates-ready sentinel (progress 52) via phase-1 reserve +
// the candidates callback, so phase-2 tests start from the real state machine.
async function seedCandidatesReadyAlbum(userId: string, requestId: string, t: TestContext) {
  const album = await seedLayoutReadyAlbum(userId, requestId);
  t.mock.method(agentClient, 'submitSelectLayoutV3', async () => ({ requestId, accepted: true }));
  await generationService.submitSelectLayoutV3(userId, album.id, { requestId, language: 'en', refs: REFS });
  await jobService.handleV3SelectLayoutCandidates(requestId, CANDIDATE_UNITS, USAGE);
  return album;
}

test('buildJudgeLayoutRequest validates against the strict JudgeLayoutRequest contract', () => {
  const request = buildJudgeLayoutRequest({
    requestId: 'judge-r1',
    callbackUrl: 'https://web.test/api/v3/internal/job-progress',
    language: 'en',
    units: JUDGE_UNITS,
  });
  assert.equal(request.requestId, 'judge-r1');
  assert.equal(request.units.length, 1);
  assert.equal(request.units[0].candidates[0].thumbnail, 'data:image/jpeg;base64,AA==');
});

test('candidates callback parks the job at 52 and stashes candidates for the browser', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const user = await makeUser('judge-candidates-ready');
  try {
    transientLayoutCandidates.resetForTest();
    const album = await seedCandidatesReadyAlbum(user.id, 'judge-ready', t);

    const job = await agentJobRepo.findByRequestId('judge-ready');
    assert.equal(job?.progress, 52);
    assert.equal(job?.stage, 'layout');
    assert.equal(job?.status, 'RUNNING');

    const fetched = await generationService.getJudgeCandidates(user.id, album.id, 'judge-ready');
    assert.equal(fetched.ready, true);
    assert.equal(fetched.units.length, 1);
    assert.equal(fetched.units[0].candidates.length, 2);
  } finally {
    transientLayoutCandidates.resetForTest();
    await cleanupUser(user.id);
  }
});

test('submitJudgeLayoutV3 reserves 52→53 once and posts judge-layout (no double dispatch, no re-reserve)', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const user = await makeUser('judge-dispatch');
  try {
    transientLayoutCandidates.resetForTest();
    const album = await seedCandidatesReadyAlbum(user.id, 'judge-dispatch-r', t);

    let posts = 0;
    t.mock.method(agentClient, 'submitJudgeLayoutV3', async () => {
      posts += 1;
      return { requestId: 'judge-dispatch-r', accepted: true };
    });

    await generationService.submitJudgeLayoutV3(user.id, album.id, {
      requestId: 'judge-dispatch-r',
      language: 'en',
      units: JUDGE_UNITS,
    });
    await generationService.submitJudgeLayoutV3(user.id, album.id, {
      requestId: 'judge-dispatch-r',
      language: 'en',
      units: JUDGE_UNITS,
    });

    assert.equal(posts, 1);
    const job = await agentJobRepo.findByRequestId('judge-dispatch-r');
    assert.equal(job?.progress, 53);

    // The same completed callback as before still merges pages (Web merge unchanged).
    await jobService.handleV3SelectLayoutCompleted('judge-dispatch-r', PAGES, USAGE);
    const reloaded = await albumRepo.findById(album.id);
    assert.equal(reloaded?.status, 'EDITING');
    assert.equal(reloaded?.stage, 'story');
  } finally {
    transientLayoutCandidates.resetForTest();
    await cleanupUser(user.id);
  }
});
