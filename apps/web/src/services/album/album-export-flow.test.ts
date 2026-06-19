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
const { albumService } = await import('./album-service');
const { cleanupUser, isDbReachable, makeAlbum, makeUser } = await import(
  '../../db/repos/__test__/setup'
);

function makeV3StoryDraft(chapterCount: number) {
  const chapters = Array.from({ length: chapterCount }, (_, i) => ({
    chapterId: `c${i + 1}`,
    description: `chapter ${i + 1}`,
    accentColor: null,
    artFont: null,
    photos: [],
  }));
  const pages = chapters.map((_, pageIndex) => ({
    pageIndex,
    templateId: 'mag-02',
    images: {},
    texts: { headline: `chapter ${pageIndex + 1}` },
  }));
  return { chapters, pages };
}

test('v3 export gate: PDF sign/confirm reject until all story chapters are done', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const user = await makeUser('v3-export-gate');
  try {
    const album = await makeAlbum(user.id, { photoCount: 2 });
    await albumRepo.update(db, album.id, {
      status: 'EDITING',
      stage: 'story',
      draftJson: makeV3StoryDraft(2),
    });

    await assert.rejects(
      () => albumService.signPdfUpload(user.id, album.id, {
        contentType: 'application/pdf',
        size: 4,
      }),
      (err: { code?: string }) => err.code === 'VALIDATION_FAILED',
    );
    await assert.rejects(
      () => albumService.confirmPdf(user.id, album.id, `pdfs/${user.id}/${album.id}.pdf`),
      (err: { code?: string }) => err.code === 'VALIDATION_FAILED',
    );

    await albumService.markChapterDone(user.id, album.id, 'c1');
    await assert.rejects(
      () => albumService.signPdfUpload(user.id, album.id, {
        contentType: 'application/pdf',
        size: 4,
      }),
      (err: { code?: string }) => err.code === 'VALIDATION_FAILED',
    );

    await albumService.markChapterDone(user.id, album.id, 'c2');
    const sign = await albumService.signPdfUpload(user.id, album.id, {
      contentType: 'application/pdf',
      size: 4,
    });
    assert.equal(sign.r2Key, `pdfs/${user.id}/${album.id}.pdf`);
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
