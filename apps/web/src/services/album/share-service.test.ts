import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

process.env.R2_ACCOUNT_ID ??= 'test-account';
process.env.R2_ACCESS_KEY_ID ??= 'test-access-key';
process.env.R2_SECRET_ACCESS_KEY ??= 'test-secret-key';
process.env.R2_BUCKET ??= 'test-bucket';
process.env.R2_PUBLIC_BASE_URL ??= 'https://cdn.yujeeai.test';

const { db } = await import('@/db/client');
const { albumRepo } = await import('@/db/repos/album-repo');
const { albumPageRepo } = await import('@/db/repos/album-page-repo');
const { albumShareRepo } = await import('@/db/repos/album-share-repo');
const { draftPageRepo } = await import('@/db/repos/draft-page-repo');
const { albumService } = await import('./album-service');
const { shareService } = await import('./share-service');
const { cleanupUser, isDbReachable, makeAlbum, makeUser } = await import(
  '@/db/repos/__test__/setup'
);

const USER_ID = 'user-share';
const ALBUM_ID = 'album-share';
const P1 = '550e8400-e29b-41d4-a716-446655440001';
const P2 = '550e8400-e29b-41d4-a716-446655440002';
const P3 = '550e8400-e29b-41d4-a716-446655440003';
const FILTERED = 'pf-v1__fuji-portrait__80';
const ORIGINAL = 'pf-v1__original';

type AlbumFixture = {
  id: string;
  userId: string;
  title: string;
  draftJson: null | Record<string, unknown>;
  photoFilter: {
    default: { lutId: 'fuji-portrait'; strength: number } | null;
    overrides?: Record<string, { lutId: 'daily-soft'; strength: number } | null>;
  } | null;
  photoSnapshot: {
    photoIds: string[];
    renderVersions?: Record<string, string>;
    updatedAt: string;
  } | null;
  boardBackground: null;
};

function albumFixture(
  patch: Partial<Pick<AlbumFixture, 'photoFilter' | 'photoSnapshot' | 'title'>> = {},
): AlbumFixture {
  return {
    id: ALBUM_ID,
    userId: USER_ID,
    title: 'Frozen title',
    draftJson: null,
    photoFilter: { default: { lutId: 'fuji-portrait', strength: 80 } },
    photoSnapshot: {
      photoIds: [P1, P2],
      renderVersions: { [P1]: FILTERED, [P2]: FILTERED },
      updatedAt: '2026-07-28T00:00:00.000Z',
    },
    boardBackground: null,
    ...patch,
  };
}

function page(pageIndex: number, imagesJson: Record<string, string>) {
  return {
    id: `page-${pageIndex}`,
    albumId: ALBUM_ID,
    pageIndex,
    templateId: 'mag-01',
    imagesJson,
    textsJson: { title: `Page ${pageIndex}` },
    imagePosJson: {},
    updatedAt: new Date('2026-07-28T00:00:00.000Z'),
  };
}

// draft_pages 行 fixture(拆表后的页真相载体):loadStoryDraft 只消费 row.page。
function draftRow(page: {
  pageIndex: number;
  templateId: string;
  images: Record<string, string>;
  texts: Record<string, string>;
  imagePos?: Record<string, { x: number; y: number; scale: number }>;
  html?: string;
}) {
  return {
    albumId: ALBUM_ID,
    pageIndex: page.pageIndex,
    page,
    version: 1,
    updatedBy: null,
    updatedAt: new Date('2026-08-05T00:00:00.000Z'),
  };
}

function mockFrozenShareState(
  initialAlbum: AlbumFixture,
  pages = [page(0, { left: P1, duplicate: P1 }), page(1, { right: P2 })],
  draftRows: ReturnType<typeof draftRow>[] = [],
) {
  const tx = { marker: 'share-tx' };
  let currentAlbum = initialAlbum;
  let savedShare: Record<string, unknown> | undefined;

  const staleRead = mock.method(albumRepo, 'findById', async () => {
    throw new Error('createShare must not read ownership/state outside the album lock');
  });
  const lockedRead = mock.method(
    albumRepo,
    'findByIdForUpdate',
    async (actualTx: unknown, albumId: string) => {
      assert.equal(actualTx, tx);
      assert.equal(albumId, ALBUM_ID);
      return currentAlbum as never;
    },
  );
  const transaction = mock.method(
    db,
    'transaction',
    (async (fn: (actualTx: unknown) => Promise<unknown>) => fn(tx)) as never,
  );
  const pageRead = mock.method(
    albumPageRepo,
    'findByAlbum',
    async (actualTx: unknown, albumId: string) => {
      assert.equal(actualTx, tx);
      assert.equal(albumId, ALBUM_ID);
      return pages as never;
    },
  );
  const upsert = mock.method(
    albumShareRepo,
    'create',
    async (actualTx: unknown, row: Record<string, unknown>) => {
      assert.equal(actualTx, tx);
      savedShare = structuredClone(row);
      return row as never;
    },
  );
  // draft_pages 读(拆表后的行级页真相):签名是 (albumId, tx)。
  const draftCount = mock.method(
    draftPageRepo,
    'countByAlbum',
    async (albumId: string, actualTx: unknown) => {
      assert.equal(albumId, ALBUM_ID);
      assert.equal(actualTx, tx);
      return draftRows.length;
    },
  );
  const draftRead = mock.method(
    draftPageRepo,
    'findByAlbum',
    async (albumId: string, actualTx: unknown) => {
      assert.equal(albumId, ALBUM_ID);
      assert.equal(actualTx, tx);
      return draftRows as never;
    },
  );

  return {
    setAlbum(next: AlbumFixture) {
      currentAlbum = next;
    },
    get savedShare() {
      return savedShare;
    },
    calls: { staleRead, lockedRead, transaction, pageRead, upsert, draftCount, draftRead },
    restore() {
      draftRead.mock.restore();
      draftCount.mock.restore();
      upsert.mock.restore();
      pageRead.mock.restore();
      transaction.mock.restore();
      lockedRead.mock.restore();
      staleRead.mock.restore();
    },
  };
}

test('createShare rejects one missing current version by count only before atomic upsert', async () => {
  const state = mockFrozenShareState(
    albumFixture({
      photoSnapshot: {
        photoIds: [P1, P2],
        renderVersions: { [P1]: FILTERED },
        updatedAt: '2026-07-28T00:00:00.000Z',
      },
    }),
  );

  try {
    await assert.rejects(
      () => shareService.createShare(USER_ID, ALBUM_ID, 'zh'),
      (error: { code?: string; message?: string; status?: number }) => {
        assert.equal(error.code, 'PHOTO_SNAPSHOT_VERSION_MISSING');
        assert.equal(error.message, '1');
        assert.equal(error.status, 409);
        assert.doesNotMatch(error.message ?? '', new RegExp(`${P1}|${P2}|pf-v1`));
        return true;
      },
    );
    assert.equal(state.calls.staleRead.mock.callCount(), 0);
    assert.equal(state.calls.lockedRead.mock.callCount(), 1);
    assert.equal(state.calls.pageRead.mock.callCount(), 1);
    assert.equal(state.calls.upsert.mock.callCount(), 0);
  } finally {
    state.restore();
  }
});

test('createShare freezes only referenced photos at each exact immutable current version', async () => {
  const state = mockFrozenShareState(
    albumFixture({
      photoSnapshot: {
        photoIds: [P1, P2, P3],
        renderVersions: { [P1]: FILTERED, [P2]: FILTERED, [P3]: ORIGINAL },
        updatedAt: '2026-07-28T00:00:00.000Z',
      },
    }),
  );

  try {
    const result = await shareService.createShare(USER_ID, ALBUM_ID, 'en');
    assert.equal(result.token.length, 24);
    assert.equal(state.calls.upsert.mock.callCount(), 1);

    const snapshot = state.savedShare?.snapshotJson as {
      pages: Array<{ imagesJson: Record<string, string> }>;
      photoUrls: Record<string, string>;
      locale: string;
    };
    assert.equal(snapshot.locale, 'en');
    assert.deepEqual(Object.keys(snapshot.photoUrls).sort(), [P1, P2]);
    assert.match(snapshot.photoUrls[P1]!, new RegExp(`/${P1}/${FILTERED}\\.jpg$`));
    assert.match(snapshot.photoUrls[P2]!, new RegExp(`/${P2}/${FILTERED}\\.jpg$`));
    assert.equal(snapshot.photoUrls[P3], undefined);
    assert.deepEqual(snapshot.pages.map((item) => item.imagesJson), [
      { left: P1, duplicate: P1 },
      { right: P2 },
    ]);
  } finally {
    state.restore();
  }
});

test('createShare treats stale, corrupt, legacy, and unrecorded original versions as missing', async (t) => {
  const cases: Array<{ name: string; album: AlbumFixture; expected: number }> = [
    {
      name: 'stale version',
      album: albumFixture({
        photoSnapshot: {
          photoIds: [P1, P2],
          renderVersions: { [P1]: FILTERED, [P2]: 'pf-v1__daily-soft__60' },
          updatedAt: '2026-07-28T00:00:00.000Z',
        },
      }),
      expected: 1,
    },
    {
      name: 'corrupt recorded version',
      album: albumFixture({
        photoSnapshot: {
          photoIds: [P1, P2],
          renderVersions: { [P1]: FILTERED, [P2]: '../bad' },
          updatedAt: '2026-07-28T00:00:00.000Z',
        },
      }),
      expected: 1,
    },
    {
      name: 'legacy photo id without version',
      album: albumFixture({
        photoSnapshot: {
          photoIds: [P1, P2],
          updatedAt: '2026-07-28T00:00:00.000Z',
        },
      }),
      expected: 2,
    },
    {
      name: 'original override still requires pf-v1__original',
      album: albumFixture({
        photoFilter: {
          default: { lutId: 'fuji-portrait', strength: 80 },
          overrides: { [P1]: null, [P2]: { lutId: 'daily-soft', strength: 60 } },
        },
        photoSnapshot: {
          photoIds: [P1, P2],
          renderVersions: { [P2]: 'pf-v1__daily-soft__60' },
          updatedAt: '2026-07-28T00:00:00.000Z',
        },
      }),
      expected: 1,
    },
  ];

  for (const item of cases) {
    await t.test(item.name, async () => {
      const state = mockFrozenShareState(item.album);
      try {
        await assert.rejects(
          () => shareService.createShare(USER_ID, ALBUM_ID, 'zh'),
          (error: { code?: string; message?: string }) => {
            assert.equal(error.code, 'PHOTO_SNAPSHOT_VERSION_MISSING');
            assert.equal(error.message, String(item.expected));
            return true;
          },
        );
        assert.equal(state.calls.upsert.mock.callCount(), 0);
      } finally {
        state.restore();
      }
    });
  }
});

test('createShare honors per-photo original/filter overrides and ignores empty slots', async () => {
  const pages = [
    page(0, { original: P1, empty: '' }),
    page(1, { filtered: P2, duplicate: P2 }),
  ];
  const state = mockFrozenShareState(
    albumFixture({
      photoFilter: {
        default: { lutId: 'fuji-portrait', strength: 80 },
        overrides: { [P1]: null, [P2]: { lutId: 'daily-soft', strength: 60 } },
      },
      photoSnapshot: {
        photoIds: [P1, P2],
        renderVersions: { [P1]: ORIGINAL, [P2]: 'pf-v1__daily-soft__60' },
        updatedAt: '2026-07-28T00:00:00.000Z',
      },
    }),
    pages,
  );

  try {
    await shareService.createShare(USER_ID, ALBUM_ID, 'zh');
    const photoUrls = (
      state.savedShare?.snapshotJson as { photoUrls: Record<string, string> }
    ).photoUrls;
    assert.deepEqual(Object.keys(photoUrls).sort(), [P1, P2]);
    assert.match(photoUrls[P1]!, new RegExp(`/${P1}/${ORIGINAL}\\.jpg$`));
    assert.match(photoUrls[P2]!, new RegExp(`/${P2}/pf-v1__daily-soft__60\\.jpg$`));
  } finally {
    state.restore();
  }
});

test('createShare rejects a non-empty invalid photo reference before atomic upsert', async () => {
  const state = mockFrozenShareState(
    albumFixture(),
    [page(0, { valid: P1, corrupt: '../not-a-photo' })],
  );

  try {
    await assert.rejects(
      () => shareService.createShare(USER_ID, ALBUM_ID, 'zh'),
      (error: { code?: string; message?: string; status?: number }) => {
        assert.equal(error.code, 'VALIDATION_FAILED');
        assert.equal(error.status, 400);
        assert.doesNotMatch(error.message ?? '', /\.\.\/|550e8400/);
        return true;
      },
    );
    assert.equal(state.calls.upsert.mock.callCount(), 0);
  } finally {
    state.restore();
  }
});

test('failed regeneration after filter change leaves prior frozen token and snapshot unchanged', async () => {
  const state = mockFrozenShareState(albumFixture());
  try {
    const first = await shareService.createShare(USER_ID, ALBUM_ID, 'zh');
    const frozen = structuredClone(state.savedShare);

    state.setAlbum(
      albumFixture({
        photoFilter: { default: { lutId: 'fuji-portrait', strength: 60 } },
        photoSnapshot: {
          photoIds: [P1, P2],
          renderVersions: { [P1]: FILTERED, [P2]: FILTERED },
          updatedAt: '2026-07-28T00:00:00.000Z',
        },
      }),
    );
    await assert.rejects(
      () => shareService.createShare(USER_ID, ALBUM_ID, 'zh'),
      (error: { code?: string; message?: string }) =>
        error.code === 'PHOTO_SNAPSHOT_VERSION_MISSING' && error.message === '2',
    );

    assert.equal(state.calls.upsert.mock.callCount(), 1);
    assert.equal(state.savedShare?.token, first.token);
    assert.deepEqual(state.savedShare, frozen);
  } finally {
    state.restore();
  }
});

test('createShare freezes draft_pages rows when the split-era envelope has no pages key', async () => {
  // 拆表(2026-08-03)后任何写点都会把 draftJson 重写成 envelope-only(无 pages 键),
  // 页真相只活在 draft_pages 行里。分享冻结必须读行,而不是读已被抹掉的 legacy 数组。
  const envelopeOnlyDraftJson = {
    version: 'v3-story' as const,
    tree: {
      chapters: [
        {
          chapterId: 'c1',
          description: '',
          chapterContext: '',
          accentColor: null,
          artFont: null,
          photos: [
            {
              photoId: P1,
              sceneDescription: '',
              width: 800,
              height: 600,
              orientation: 'landscape' as const,
            },
          ],
        },
      ],
    },
    progress: { currentChapterId: null, doneChapterIds: ['c1'] },
  };
  const rows = [
    draftRow({
      pageIndex: 0,
      templateId: 'mag-01',
      images: { left: P1, duplicate: P1 },
      texts: { title: 'Draft page 0' },
      html: '<div data-template="mag-01">frozen byte-for-byte</div>',
    }),
    draftRow({
      pageIndex: 1,
      templateId: 'mag-02',
      images: { right: P2 },
      texts: { title: 'Draft page 1' },
      imagePos: { right: { x: 40, y: 60, scale: 1.2 } },
    }),
  ];
  // 定稿表为空(草稿书从未定稿)—— 修复前这里会误判「没有可分享的页面」。
  const state = mockFrozenShareState(
    { ...albumFixture(), draftJson: envelopeOnlyDraftJson },
    [],
    rows,
  );

  try {
    const result = await shareService.createShare(USER_ID, ALBUM_ID, 'zh');
    assert.equal(result.token.length, 24);
    assert.equal(state.calls.upsert.mock.callCount(), 1);

    const snapshot = state.savedShare?.snapshotJson as {
      pages: Array<Record<string, unknown>>;
      photoUrls: Record<string, string>;
    };
    assert.deepEqual(snapshot.pages, [
      {
        pageIndex: 0,
        templateId: 'mag-01',
        imagesJson: { left: P1, duplicate: P1 },
        textsJson: { title: 'Draft page 0' },
        imagePosJson: {},
        htmlJson: '<div data-template="mag-01">frozen byte-for-byte</div>',
      },
      {
        pageIndex: 1,
        templateId: 'mag-02',
        imagesJson: { right: P2 },
        textsJson: { title: 'Draft page 1' },
        imagePosJson: { right: { x: 40, y: 60, scale: 1.2 } },
      },
    ]);
    assert.deepEqual(Object.keys(snapshot.photoUrls).sort(), [P1, P2]);
  } finally {
    state.restore();
  }
});

test('concurrent share and filter update serialize on the album lock without a mixed snapshot', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const user = await makeUser('share-filter-lock');
  try {
    const album = await makeAlbum(user.id, { photoCount: 1 });
    await albumPageRepo.bulkInsert(db, [
      { ...page(0, { hero: P1 }), albumId: album.id, id: undefined },
    ]);
    await albumService.updatePhotoFilter(user.id, album.id, {
      default: { lutId: 'fuji-portrait', strength: 80 },
    });
    await albumService.confirmPhotoSnapshot(user.id, album.id, [
      { photoId: P1, renderVersion: FILTERED },
    ]);

    const [shareResult, filterResult] = await Promise.allSettled([
      shareService.createShare(user.id, album.id, 'zh'),
      albumService.updatePhotoFilter(user.id, album.id, {
        default: { lutId: 'daily-soft', strength: 60 },
      }),
    ]);
    assert.equal(filterResult.status, 'fulfilled');

    const stored = await albumShareRepo.findLatestByAlbum(album.id);
    if (shareResult.status === 'fulfilled') {
      assert.ok(stored);
      assert.equal(stored.token, shareResult.value.token);
      assert.match(
        stored.snapshotJson.photoUrls[P1]!,
        new RegExp(`/${P1}/${FILTERED}\\.jpg$`),
      );
    } else {
      const error = shareResult.reason as { code?: string; message?: string };
      assert.equal(error.code, 'PHOTO_SNAPSHOT_VERSION_MISSING');
      assert.equal(error.message, '1');
      assert.equal(stored, undefined);
    }
  } finally {
    await cleanupUser(user.id);
  }
});

// 0030_closed_sentinel 的核心不变式(collab rework §3.1):album_shares 从「一相册
// 一条、重新生成即覆盖」改成「一链接一行」。协同下这条是安全边界 —— editor 建
// 分享**不能**撤销 owner 已经发出去的链接;非协同下它也让「重新生成」不再让已
// 分发的旧链接突然 404。唯一索引 uq_album_shares_album 已被迁移删除,repo 侧
// upsertByAlbum 相应换成 create。
test('重新生成分享创建新行,旧 token 继续可读(一链接一行,不覆盖)', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const user = await makeUser('share-append-only');
  try {
    const album = await makeAlbum(user.id, { photoCount: 1 });
    await albumPageRepo.bulkInsert(db, [
      { ...page(0, { hero: P1 }), albumId: album.id, id: undefined },
    ]);
    await albumService.updatePhotoFilter(user.id, album.id, {
      default: { lutId: 'fuji-portrait', strength: 80 },
    });
    await albumService.confirmPhotoSnapshot(user.id, album.id, [
      { photoId: P1, renderVersion: FILTERED },
    ]);

    const first = await shareService.createShare(user.id, album.id, 'zh');
    const second = await shareService.createShare(user.id, album.id, 'zh');
    assert.notEqual(first.token, second.token, '重新生成必须换新 token');

    // 旧链接不被撤销:两条行都在,按 token 都查得到。
    const firstRow = await albumShareRepo.findByToken(first.token);
    const secondRow = await albumShareRepo.findByToken(second.token);
    assert.ok(firstRow, '重新生成后旧 token 必须仍可读 —— 覆盖语义会让它消失');
    assert.ok(secondRow);
    assert.equal(firstRow.albumId, album.id);
    assert.equal(secondRow.albumId, album.id);

    // 分享管理 UI 展示「当前链接」取最新一条。
    const latest = await albumShareRepo.findLatestByAlbum(album.id);
    assert.ok(latest);
    assert.equal(latest.token, second.token);
  } finally {
    await cleanupUser(user.id);
  }
});
