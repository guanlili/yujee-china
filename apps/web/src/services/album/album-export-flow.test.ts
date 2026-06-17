import { test } from 'node:test';
import assert from 'node:assert/strict';

// R2 signing needs credentials; set them BEFORE importing anything that reads
// env (env.ts parses at import time). Dynamic imports below run after this.
process.env.R2_ACCOUNT_ID ??= 'test-account';
process.env.R2_ACCESS_KEY_ID ??= 'test-access-key';
process.env.R2_SECRET_ACCESS_KEY ??= 'test-secret-key';
process.env.R2_BUCKET ??= 'test-bucket';
process.env.R2_PUBLIC_BASE_URL ??= 'https://cdn.yujeeai.test';

const { db } = await import('../../db/client');
const { albumRepo } = await import('../../db/repos/album-repo');
const { albumPageRepo } = await import('../../db/repos/album-page-repo');
const { creditHoldRepo } = await import('../../db/repos/credit-hold-repo');
const { jobService } = await import('../job/job-service');
const { albumService } = await import('./album-service');
const { cleanupUser, isDbReachable, makeAlbum, makeUser } = await import(
  '../../db/repos/__test__/setup'
);

// Full-suite acceptance for tech-plan §9.1 row 4 ("最终册子进现有编辑器、就地编辑、
// 导出 PDF") + invariants 1/4: finalize → EDITING → render album_pages →
// (browser) @react-pdf render is mocked → presigned PUT (signed server-side) →
// confirm → COMPLETED. The load-bearing privacy assertions: album_pages and the
// editor-facing detail payload reference photos by photoId only (never base64),
// and the only server-issued artifact is the presigned URL — bytes never cross
// the Web tier (Web never renders or proxies the PDF).

const HOLD_AMOUNT = 10;

// A finalized flat layout: images map a slot → photoId (NOT base64). This is the
// shape jobService.handleFinalizeCompleted writes to album_pages.
const LAYOUT = {
  magazine: { title: 'A Spring Trip', style: 'warm-film' as const, language: 'en' as const },
  photos: [
    { photoId: 'ph_1', description: 'a hill at dawn', tags: ['trip'], quality: 'hero' as const, orientation: 'landscape' as const },
    { photoId: 'ph_2', description: 'a quiet street', tags: ['trip'], quality: 'detail' as const, orientation: 'portrait' as const },
  ],
  pages: [
    { pageIndex: 0, templateId: 'mag-01', images: { image: 'ph_1' }, texts: { heading: 'Spring Trip' } },
    { pageIndex: 1, templateId: 'mag-02', images: {}, texts: { heading: 'CONTENTS', 'titles[0]': 'Day one' } },
    { pageIndex: 2, templateId: 'mag-03', images: { image: 'ph_2' }, texts: {} },
  ],
};

async function seedFinalizeJob(userId: string) {
  const album = await makeAlbum(userId, { photoCount: 2 });
  await albumRepo.update(db, album.id, {
    draftJson: { version: 'v2', meta: { style: 'warm-film', language: 'en' }, photoPool: [], basePages: { cover: { pageIndex: 0, templateId: 'mag-01', images: {}, texts: {} }, ending: { pageIndex: 1, templateId: 'mag-03', images: {}, texts: {} } }, chapters: [] },
  });
  const hold = await creditHoldRepo.create(db, {
    userId,
    albumId: album.id,
    amount: HOLD_AMOUNT,
    status: 'HOLDING',
  });
  await albumRepo.update(db, album.id, { creditHoldId: hold.id });
  const requestId = `export-flow-${Date.now()}-${Math.round(performance.now())}`;
  await jobService.createV2(db, { userId, albumId: album.id, requestId, kind: 'finalize' });
  return { albumId: album.id, requestId };
}

test('v2 export flow: finalize → EDITING → editor detail (photoId refs only) → presigned PUT → confirm → COMPLETED', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const user = await makeUser('v2-export');
  try {
    const { albumId, requestId } = await seedFinalizeJob(user.id);

    // 1. finalize completes → flat layout flattened into album_pages, EDITING.
    await jobService.handleFinalizeCompleted(requestId, LAYOUT, { durationMs: 1, models: {} });

    const detail = await albumService.getDetail(user.id, albumId);
    assert.equal(detail.album.status, 'EDITING', 'finalized album is editable, not COMPLETED');
    assert.equal(detail.pages.length, 3, 'all flattened pages reach the editor');

    // 2. Editor renders album_pages. The privacy invariant (1/4): every image
    // reference is a photoId the browser resolves locally — NEVER base64. The
    // server has no originals to leak.
    const serialized = JSON.stringify(detail);
    assert.ok(!/data:image\/[a-z]+;base64,/.test(serialized), 'no data-URL in editor payload');
    assert.ok(!/[A-Za-z0-9+/]{200,}={0,2}/.test(serialized), 'no long base64 blob in editor payload');
    for (const page of detail.pages) {
      for (const ref of Object.values(page.imagesJson ?? {})) {
        assert.ok(/^ph_/.test(ref), `image slot must reference a photoId, got ${ref}`);
      }
    }

    // 3. Browser locally renders the PDF (@react-pdf) — mocked here, the Web tier
    // never sees PDF bytes. It only asks the server to sign a direct R2 PUT.
    const renderPdfInBrowser = () => new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF" — stays in-browser
    const pdfBytes = renderPdfInBrowser();
    assert.ok(pdfBytes.length > 0);

    const sign = await albumService.signPdfUpload(user.id, albumId, {
      contentType: 'application/pdf',
      size: pdfBytes.length,
    });
    assert.match(sign.putUrl, /^https?:\/\//, 'a presigned PUT URL is issued');
    assert.equal(sign.r2Key, `pdfs/${user.id}/${albumId}.pdf`, 'key bound to {userId}/{albumId}');
    // The presigned URL is the ONLY server artifact; no PDF byte ever transits Web.

    // 4. Browser PUTs to R2 directly (not asserted — that's R2's surface), then
    // confirms. Confirm flips the album to COMPLETED and records the public URL.
    const { pdfUrl } = await albumService.confirmPdf(user.id, albumId, sign.r2Key);
    assert.ok(pdfUrl.includes(sign.r2Key));

    const finalAlbum = await albumRepo.findById(albumId);
    assert.equal(finalAlbum?.status, 'COMPLETED', 'PDF confirm is what reaches COMPLETED');
    assert.equal(finalAlbum?.pdfR2Key, sign.r2Key);

    // 5. The persisted layout_json and album_pages still carry zero base64.
    const layoutStr = JSON.stringify(finalAlbum?.layoutJson);
    assert.ok(!/data:image\/[a-z]+;base64,/.test(layoutStr), 'layout_json holds no base64');
    const pages = await albumPageRepo.findByAlbum(albumId);
    const pagesStr = JSON.stringify(pages);
    assert.ok(!/data:image\/[a-z]+;base64,/.test(pagesStr), 'album_pages hold no base64');
  } finally {
    await cleanupUser(user.id);
  }
});

test('cover photo thumbnail flow: browser uploads derived JPEG only and confirms namespaced key', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const user = await makeUser('cover-thumb');
  try {
    const album = await makeAlbum(user.id, { photoCount: 2 });

    const sign = await albumService.signCoverThumbnailUpload(user.id, album.id, {
      contentType: 'image/jpeg',
      size: 48 * 1024,
    });

    assert.match(sign.putUrl, /^https?:\/\//, 'a presigned PUT URL is issued');
    assert.equal(
      sign.r2Key,
      `cover-thumbs/${user.id}/${album.id}.jpg`,
      'key is bound to {userId}/{albumId}',
    );

    await assert.rejects(
      () => albumService.confirmCoverThumbnail(user.id, album.id, `cover-thumbs/${user.id}/other.jpg`),
      (err: { code?: string }) => err.code === 'VALIDATION_FAILED',
      'a forged cover thumbnail key is rejected',
    );

    const { coverThumbnailUrl } = await albumService.confirmCoverThumbnail(user.id, album.id, sign.r2Key);
    assert.ok(coverThumbnailUrl.includes(sign.r2Key));

    const finalAlbum = await albumRepo.findById(album.id);
    assert.equal(finalAlbum?.coverThumbnailR2Key, sign.r2Key);
    assert.equal(finalAlbum?.coverThumbnailUrl, coverThumbnailUrl);
    assert.equal(finalAlbum?.status, 'AGENT_RUNNING', 'cover thumbnail confirm never changes album status');
  } finally {
    await cleanupUser(user.id);
  }
});
