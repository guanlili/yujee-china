import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AlbumDraft,
  V2Callback,
  V2DraftEditRequest,
  V2DraftEditResponse,
  V2InitRequest,
  V2PhotoAnalysis,
} from './v2';

const baseAnalysis = {
  photoId: 'p1',
  description: 'a',
  tags: ['x'],
  quality: 'hero',
  orientation: 'portrait',
  peopleCount: '1',
  scene: 'outdoor',
  mood: 'warm',
} as const;

const initReq = (exif?: Record<string, unknown>) => ({
  requestId: 'req_1',
  albumId: 'alb_1',
  callbackUrl: 'https://yujeeai.com/api/v2/internal/job-progress',
  language: 'en',
  photos: [
    {
      photoId: 'p1',
      base64: 'data:image/jpeg;base64,abc',
      width: 800,
      height: 600,
      ...(exif ? { exif } : {}),
    },
  ],
});

// ── P0-2:strict 必须拒坐标,而非 strip(D-GPS 隐私执行点)──
test('init exif accepts takenAt only', () => {
  assert.equal(V2InitRequest.safeParse(initReq({ takenAt: '2026-06-01T10:00:00Z' })).success, true);
});

test('init exif REJECTS lat/lng (strict, not strip)', () => {
  const r = V2InitRequest.safeParse(initReq({ takenAt: null, lat: 35.6, lng: 139.7 }));
  assert.equal(r.success, false, 'lat/lng must be rejected, never silently stripped');
});

test('init request rejects unknown top-level keys', () => {
  assert.equal(V2InitRequest.safeParse({ ...initReq(), includePlace: true }).success, false);
});

test('V2PhotoAnalysis rejects unknown keys', () => {
  assert.equal(V2PhotoAnalysis.safeParse({ ...baseAnalysis, location: 'Kyoto' }).success, false);
});

// ── P0-1:callback union 按 jobKind 区分两个 completed ──
const draftTree = {
  version: 'v2',
  meta: { style: 'warm-film', language: 'en' },
  photoPool: [],
  basePages: {
    cover: { pageIndex: 0, templateId: 'mag-01', images: {}, texts: {} },
    ending: { pageIndex: 1, templateId: 'mag-03', images: { image: 'p1' }, texts: {} },
  },
  chapters: [],
};

test('init-completed carries draftTree, finalize-completed carries layout', () => {
  const initDone = {
    requestId: 'req_1',
    jobKind: 'init',
    event: 'completed',
    draftTree,
    usage: { durationMs: 1, models: {} },
  };
  const parsed = V2Callback.safeParse(initDone);
  assert.equal(parsed.success, true);
});

test('init-completed must NOT also carry layout (strict)', () => {
  const bad = {
    requestId: 'req_1',
    jobKind: 'init',
    event: 'completed',
    draftTree,
    layout: { magazine: {}, photos: [], pages: [] },
    usage: { durationMs: 1, models: {} },
  };
  assert.equal(V2Callback.safeParse(bad).success, false);
});

test('AlbumDraft round-trips through strict parse', () => {
  assert.equal(AlbumDraft.safeParse(draftTree).success, true);
});

// ── #162 draft-edit:单页切片 + talk/act 响应,strict + 不变式 12 ──
const draftEditReq = {
  albumId: 'a1',
  language: 'en',
  page: { pageIndex: 2, templateId: 'mag-05', images: { image: 'p1' }, texts: { title: 'T' } },
  photos: [baseAnalysis],
  history: [],
  userMessage: 'change the title',
  focusedPageIndex: 2,
};

test('V2DraftEditRequest accepts a single-page slice', () => {
  assert.equal(V2DraftEditRequest.safeParse(draftEditReq).success, true);
});

test('V2DraftEditRequest focusedPageIndex is optional + nonnegative', () => {
  const { focusedPageIndex, ...noFocus } = draftEditReq;
  void focusedPageIndex;
  assert.equal(V2DraftEditRequest.safeParse(noFocus).success, true);
  assert.equal(
    V2DraftEditRequest.safeParse({ ...draftEditReq, focusedPageIndex: -1 }).success,
    false,
  );
});

test('V2DraftEditRequest rejects a whole draft tree (invariant 12)', () => {
  assert.equal(
    V2DraftEditRequest.safeParse({ ...draftEditReq, draftTree }).success,
    false,
  );
});

// Fix 1 — `page` is a strict slice (mirrors py V2DraftEditPage extra='forbid'):
// a stray unknown key INSIDE `page` must be rejected, not silently accepted.
test('V2DraftEditRequest rejects an unknown key inside page (TS↔py strict parity)', () => {
  assert.equal(
    V2DraftEditRequest.safeParse({
      ...draftEditReq,
      page: { ...draftEditReq.page, bleed: true },
    }).success,
    false,
    'page must be strict — extra keys rejected, mirroring py V2DraftEditPage',
  );
});

// Fix 2 — `photos` is REQUIRED on both sides (Web always sends it, even empty []):
// omitting it must be rejected (no TS default), an empty array must pass.
test('V2DraftEditRequest requires photos (omitting rejected, empty [] accepted)', () => {
  const { photos, ...noPhotos } = draftEditReq;
  void photos;
  assert.equal(V2DraftEditRequest.safeParse(noPhotos).success, false, 'photos is required');
  assert.equal(
    V2DraftEditRequest.safeParse({ ...draftEditReq, photos: [] }).success,
    true,
    'empty photos array is valid',
  );
});

test('V2DraftEditResponse act carries pageWrite, talk omits it', () => {
  const act = {
    kind: 'act',
    assistantReply: 'ok',
    pageWrite: { pageIndex: 2, texts: { title: 'New' } },
    usage: { durationMs: 1, models: {} },
  };
  assert.equal(V2DraftEditResponse.safeParse(act).success, true);
  const talk = { kind: 'talk', assistantReply: 'hi', usage: { durationMs: 1, models: {} } };
  assert.equal(V2DraftEditResponse.safeParse(talk).success, true);
  const badKind = { ...talk, kind: 'other' };
  assert.equal(V2DraftEditResponse.safeParse(badKind).success, false);
});
