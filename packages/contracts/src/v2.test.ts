import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AlbumDraft,
  V2Callback,
  V2DraftEditRequest,
  V2DraftEditResponse,
  V2InitRequest,
  V2InspectRequest,
  V2InspectResponse,
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

// #169: focal is an optional BASE field on V2PhotoAnalysis (0..1, finalize keeps it).
test('V2PhotoAnalysis accepts an optional focal in [0,1] and rejects out-of-range', () => {
  assert.equal(V2PhotoAnalysis.safeParse(baseAnalysis).success, true); // absent ok
  assert.equal(
    V2PhotoAnalysis.safeParse({ ...baseAnalysis, focal: { x: 0.3, y: 0.7 } }).success,
    true,
  );
  assert.equal(
    V2PhotoAnalysis.safeParse({ ...baseAnalysis, focal: { x: 1.2, y: 0.5 } }).success,
    false,
  );
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

// #165 Phase 2 — inspect kind + imagePosWrite + inspect-page schemas (TS↔py parity).
test('V2DraftEditResponse supports inspect kind + inspectRequest', () => {
  const inspect = {
    kind: 'inspect',
    assistantReply: 'Let me take a look.',
    inspectRequest: { pageIndex: 2 },
    usage: { durationMs: 1, models: {} },
  };
  assert.equal(V2DraftEditResponse.safeParse(inspect).success, true);
});

test('V2DraftEditResponse act carries imagePosWrite with clamped ranges', () => {
  const ok = {
    kind: 'act',
    assistantReply: 'moved it',
    imagePosWrite: { pageIndex: 2, imageId: 'image', x: 50, y: 35, scale: 1.2 },
    usage: { durationMs: 1, models: {} },
  };
  assert.equal(V2DraftEditResponse.safeParse(ok).success, true);
  for (const bad of [
    { pageIndex: 0, imageId: 'i', x: -1, y: 50, scale: 1 },
    { pageIndex: 0, imageId: 'i', x: 50, y: 101, scale: 1 },
    { pageIndex: 0, imageId: 'i', x: 50, y: 50, scale: 0.9 },
    { pageIndex: 0, imageId: 'i', x: 50, y: 50, scale: 2.1 },
  ]) {
    assert.equal(
      V2DraftEditResponse.safeParse({ ...ok, imagePosWrite: bad }).success,
      false,
    );
  }
});

test('V2InspectRequest is strict + carries the screenshot channel only', () => {
  const req = {
    albumId: 'a',
    language: 'en',
    page: { pageIndex: 2, templateId: 'mag-05', images: { image: 'p1' }, texts: {} },
    photos: [baseAnalysis],
    screenshot: 'data:image/png;base64,AAAA',
    userMessage: 'face cut off',
  };
  assert.equal(V2InspectRequest.safeParse(req).success, true);
  assert.equal(
    V2InspectRequest.safeParse({ ...req, draftTree: {} }).success,
    false,
    'no whole tree smuggled in (invariant 12)',
  );
  const { screenshot, ...noShot } = req;
  assert.equal(V2InspectRequest.safeParse(noShot).success, false, 'screenshot required');
});

test('V2InspectResponse diagnosis: imageId nullable, ranges clamped', () => {
  const resp = {
    diagnosis: {
      imageId: 'image',
      problem: 'cut off',
      // #169: absolute target object-position (0..100), not relative dx/dy.
      targetX: 50,
      targetY: 20,
      suggestedScale: 1.1,
      confidence: 0.7,
    },
    assistantReply: 'let me adjust',
    usage: { durationMs: 1, models: {} },
  };
  assert.equal(V2InspectResponse.safeParse(resp).success, true);
  // null imageId is the graceful "unable to inspect" shape.
  assert.equal(
    V2InspectResponse.safeParse({
      ...resp,
      diagnosis: { ...resp.diagnosis, imageId: null },
    }).success,
    true,
  );
  // out-of-range target rejected (targetY must be within [0, 100]).
  assert.equal(
    V2InspectResponse.safeParse({
      ...resp,
      diagnosis: { ...resp.diagnosis, targetY: 101 },
    }).success,
    false,
  );
});
