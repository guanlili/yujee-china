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
      () => albumService.confirmPdf(user.id, album.id, `pdfs/${album.id}/${crypto.randomUUID()}.pdf`),
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
    // 2026-07 收紧:全章 done 但设计未完成(stage=theme)仍拒绝。
    await assert.rejects(
      () => albumService.signPdfUpload(user.id, album.id, {
        contentType: 'application/pdf',
        size: 4,
      }),
      (err: { code?: string }) => err.code === 'VALIDATION_FAILED',
    );

    // 设计完成(applyDesign 推 stage=ready)后放行 —— 直接落 stage 模拟。
    await albumRepo.update(db, album.id, { stage: 'ready' });
    const sign = await albumService.signPdfUpload(user.id, album.id, {
      contentType: 'application/pdf',
      size: 4,
    });
    // Phase 3.2:key 归 album 命名空间 + 每次 UUID exportId(不按执行者 userId)。
    assert.match(sign.r2Key, new RegExp(`^pdfs/${album.id}/[0-9a-f-]{36}\\.pdf$`));
    assert.doesNotMatch(sign.r2Key, new RegExp(`/${user.id}/`), 'key 不再使用执行者命名空间');
  } finally {
    await cleanupUser(user.id);
  }
});

test('cover thumbnail confirmation is bound to an immutable album revision', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const user = await makeUser('cover-thumb');
  const otherUser = await makeUser('cover-thumb-other');
  try {
    const album = await makeAlbum(user.id, { photoCount: 2 });

    const sign = await albumService.signCoverThumbnailUpload(user.id, album.id, {
      contentType: 'image/jpeg',
      size: 48 * 1024,
    });

    assert.match(sign.putUrl, /^https?:\/\//, 'a presigned PUT URL is issued');
    assert.match(sign.coverRevision, /^[a-f0-9]{64}$/, 'revision is opaque and deterministic');
    assert.equal(
      sign.r2Key,
      `cover-thumbs/${user.id}/${album.id}/${sign.coverRevision}.jpg`,
      'key is bound to the signed immutable revision',
    );

    await assert.rejects(
      () => albumService.confirmCoverThumbnail(user.id, album.id, {
        r2Key: `cover-thumbs/${user.id}/other.jpg`,
        coverRevision: sign.coverRevision,
      }),
      (err: { code?: string }) => err.code === 'VALIDATION_FAILED',
      'a forged cover thumbnail key is rejected',
    );

    await assert.rejects(
      () => albumService.signCoverThumbnailUpload(otherUser.id, album.id, {
        contentType: 'image/jpeg',
        size: 48 * 1024,
      }),
      (err: { code?: string }) => err.code === 'ALBUM_NOT_OWNED',
      'another user cannot sign a thumbnail for this album',
    );

    await albumService.updatePhotoFilter(user.id, album.id, {
      default: { lutId: 'fuji-portrait', strength: 80 },
    }, 0);
    await assert.rejects(
      () => albumService.confirmCoverThumbnail(user.id, album.id, {
        r2Key: sign.r2Key,
        coverRevision: sign.coverRevision,
      }),
      (err: { code?: string }) => err.code === 'VALIDATION_FAILED',
      'a stale signed upload cannot restore a cover after the filter changed',
    );
    const staleAlbum = await albumRepo.findById(album.id);
    assert.equal(staleAlbum?.coverThumbnailR2Key, null);
    assert.equal(staleAlbum?.coverThumbnailUrl, null);

    const replacement = await albumService.signCoverThumbnailUpload(user.id, album.id, {
      contentType: 'image/jpeg',
      size: 48 * 1024,
    });
    assert.notEqual(replacement.coverRevision, sign.coverRevision);
    assert.notEqual(replacement.r2Key, sign.r2Key);

    await assert.rejects(
      () => albumService.confirmCoverThumbnail(user.id, album.id, {
        r2Key: replacement.r2Key,
        coverRevision: 'not-the-current-revision',
      }),
      (err: { code?: string }) => err.code === 'VALIDATION_FAILED',
      'a mismatched opaque revision is rejected',
    );

    await assert.rejects(
      () => albumService.confirmCoverThumbnail(otherUser.id, album.id, {
        r2Key: replacement.r2Key,
        coverRevision: replacement.coverRevision,
      }),
      (err: { code?: string }) => err.code === 'ALBUM_NOT_OWNED',
      'another user cannot confirm a signed thumbnail',
    );

    const { coverThumbnailUrl } = await albumService.confirmCoverThumbnail(user.id, album.id, {
      r2Key: replacement.r2Key,
      coverRevision: replacement.coverRevision,
    });
    assert.equal(coverThumbnailUrl, `https://cdn.yujeeai.test/${replacement.r2Key}`);

    const finalAlbum = await albumRepo.findById(album.id);
    assert.equal(finalAlbum?.coverThumbnailR2Key, replacement.r2Key);
    assert.equal(finalAlbum?.coverThumbnailUrl, coverThumbnailUrl);
    assert.equal(finalAlbum?.status, 'AGENT_RUNNING', 'cover thumbnail confirm never changes album status');
  } finally {
    await cleanupUser(user.id);
    await cleanupUser(otherUser.id);
  }
});

test('non-draft cover page edits invalidate signed and confirmed cover thumbnails', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const user = await makeUser('cover-thumb-page-race');
  try {
    const album = await makeAlbum(user.id, { photoCount: 2 });
    await albumPageRepo.bulkInsert(db, [
      {
        albumId: album.id,
        pageIndex: 0,
        templateId: 'mag-01',
        imagesJson: { hero: 'cover-a' },
        textsJson: { title: 'Cover A' },
        imagePosJson: { hero: { x: 50, y: 50, scale: 1 } },
      },
      {
        albumId: album.id,
        pageIndex: 1,
        templateId: 'mag-02',
        imagesJson: { image: 'interior-a' },
        textsJson: { title: 'Interior A' },
        imagePosJson: {},
      },
    ]);

    const signedA = await albumService.signCoverThumbnailUpload(user.id, album.id, {
      contentType: 'image/jpeg',
      size: 48 * 1024,
    });
    await albumService.updatePage(user.id, album.id, 0, {
      imagesJson: { hero: 'cover-b' },
      textsJson: { title: 'Cover B' },
      imagePosJson: { hero: { x: 45, y: 55, scale: 1.1 } },
    });

    await assert.rejects(
      () => albumService.confirmCoverThumbnail(user.id, album.id, {
        r2Key: signedA.r2Key,
        coverRevision: signedA.coverRevision,
      }),
      (err: { code?: string }) => err.code === 'VALIDATION_FAILED',
      'a cover-page edit serializes with confirmation and rejects stale A',
    );
    let current = await albumRepo.findById(album.id);
    assert.equal(current?.coverThumbnailR2Key, null);
    assert.equal(current?.coverThumbnailUrl, null);

    const signedB = await albumService.signCoverThumbnailUpload(user.id, album.id, {
      contentType: 'image/jpeg',
      size: 48 * 1024,
    });
    assert.notEqual(signedB.coverRevision, signedA.coverRevision);
    assert.notEqual(signedB.r2Key, signedA.r2Key);
    await albumService.confirmCoverThumbnail(user.id, album.id, {
      r2Key: signedB.r2Key,
      coverRevision: signedB.coverRevision,
    });

    await albumService.updatePage(user.id, album.id, 1, {
      textsJson: { title: 'Interior B' },
    });
    current = await albumRepo.findById(album.id);
    assert.equal(current?.coverThumbnailR2Key, signedB.r2Key, 'non-cover edits retain a valid cover');

    await albumService.updatePage(user.id, album.id, 0, {
      imagesJson: { hero: 'cover-c' },
    });
    current = await albumRepo.findById(album.id);
    assert.equal(current?.coverThumbnailR2Key, null, 'cover-page edits clear the persisted thumbnail');
    assert.equal(current?.coverThumbnailUrl, null);
  } finally {
    await cleanupUser(user.id);
  }
});

test('pdf export (collab rework §3.2): editor exports into album namespace; stranger denied', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const { albumMemberRepo } = await import('../../db/repos/album-member-repo');
  const { collaborationService } = await import('../collaboration/collaboration-service');
  const owner = await makeUser('pdf-editor-owner');
  const editor = await makeUser('pdf-editor-member');
  const stranger = await makeUser('pdf-editor-stranger');
  try {
    const album = await makeAlbum(owner.id, { photoCount: 2 });
    await albumRepo.update(db, album.id, {
      status: 'EDITING',
      stage: 'story',
      draftJson: makeV3StoryDraft(1),
    });
    await albumMemberRepo.addMemberIfAbsent(db, album.id, editor.id);
    // 解锁导出闸门(与上面 v3 export gate 测试同一口径:全章 done + stage ready)。
    await albumService.markChapterDone(owner.id, album.id, 'c1');
    await albumRepo.update(db, album.id, { stage: 'ready' });

    // editor:Creator 能力 —— sign 的 key 归 album 命名空间(独立 exportId)。
    const editorSign = await albumService.signPdfUpload(editor.id, album.id, {
      contentType: 'application/pdf',
      size: 4,
    });
    assert.match(editorSign.r2Key, new RegExp(`^pdfs/${album.id}/[0-9a-f-]{36}\\.pdf$`));
    assert.doesNotMatch(editorSign.r2Key, new RegExp(`/${editor.id}/`));

    // 两个 Creator 各自导出不互相覆盖文件:每次 sign 都是不同的 exportId。
    const ownerSign = await albumService.signPdfUpload(owner.id, album.id, {
      contentType: 'application/pdf',
      size: 4,
    });
    assert.notEqual(ownerSign.r2Key, editorSign.r2Key);

    // editor confirm 自己的 key:相册指针挪到最新一份。
    const confirmed = await albumService.confirmPdf(editor.id, album.id, editorSign.r2Key);
    assert.equal(confirmed.pdfUrl, `https://cdn.yujeeai.test/${editorSign.r2Key}`);

    // 伪造 key(别的 album 段 / 非 UUID 尾段)被拒。
    await assert.rejects(
      () => albumService.confirmPdf(editor.id, album.id, `pdfs/other-album/${crypto.randomUUID()}.pdf`),
      (err: { code?: string }) => err.code === 'VALIDATION_FAILED',
    );
    await assert.rejects(
      () => albumService.confirmPdf(editor.id, album.id, `pdfs/${album.id}/not-a-uuid.pdf`),
      (err: { code?: string }) => err.code === 'VALIDATION_FAILED',
    );

    // stranger:非 owner 非 member → 拒绝(sign 走 requireAccess)。
    await assert.rejects(
      () => albumService.signPdfUpload(stranger.id, album.id, {
        contentType: 'application/pdf',
        size: 4,
      }),
      (err: { code?: string }) => err.code === 'ALBUM_ACCESS_DENIED',
    );
    await assert.rejects(
      () => albumService.confirmPdf(stranger.id, album.id, editorSign.r2Key),
      (err: { code?: string }) => err.code === 'ALBUM_ACCESS_DENIED',
    );

    // editor 可读已导出 PDF;stranger 不可。
    const editorRead = await albumService.getPdfUrl(editor.id, album.id);
    assert.equal(editorRead.pdfUrl, confirmed.pdfUrl);
    await assert.rejects(
      () => albumService.getPdfUrl(stranger.id, album.id),
      (err: { code?: string }) => err.code === 'ALBUM_ACCESS_DENIED',
    );
    void collaborationService;
  } finally {
    await cleanupUser(owner.id);
    await cleanupUser(editor.id);
    await cleanupUser(stranger.id);
  }
});
