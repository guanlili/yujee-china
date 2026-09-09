import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PhotoProfile } from '@yujee/contracts';
import { db } from '@/db/client';
import { albumRepo } from '@/db/repos/album-repo';
import { albumPhotoRepo } from '@/db/repos/album-photo-repo';
import { draftPageRepo } from '@/db/repos/draft-page-repo';
import { cleanupUser, isDbReachable, makeAlbum, makeUser } from '@/db/repos/__test__/setup';
import { designAgentClient } from '@/lib/agent/design-agent-client';
import { albumService } from './album-service';

/**
 * 端到端方向:**库里有档案 → 装书载荷里带得到**。
 *
 * 这条线断掉的话整批照片能力全是空转 —— engine 把档案存进 `album_photos.profile`,
 * 但 design-agent 收到的书里没有 `profile` 键,`read_page` 的 images[slot] 永远缺档案,
 * `set_image_pos` 的 fit 每次都退化成 50/50/1,skill 文档在教模型读一个不存在的字段。
 *
 * ⚠️ 档案**不能**塞进 `draft_json.tree`:`V3ChapterPhoto` 是 `.strict()` 且没有这个
 * 字段,写进去会让整棵树 parse 失败。合并点只能在 prepareDesignChat 组装发给
 * design-agent 的 book 载荷时。
 */

const PHOTO_WITH_PROFILE = '550e8400-e29b-41d4-a716-4466554400a1';
const PHOTO_WITHOUT_PROFILE = '550e8400-e29b-41d4-a716-4466554400a2';

const profile: PhotoProfile = {
  v: 1,
  subjectBox: { x: 20, y: 10, w: 50, h: 70 },
  faceBoxes: [],
  maskKey: null,
  colorTemp: 'warm',
  brightness: 'bright',
  saturation: 'vivid',
  dominantColors: ['#aabbcc'],
  composition: 'focal',
  scene: 'outdoor',
  peopleCount: '1',
  mood: 'warm',
  description: '海边的傍晚，一个人站在礁石上',
};

function chapterPhoto(photoId: string) {
  return {
    photoId,
    sceneDescription: '',
    width: 1200,
    height: 800,
    orientation: 'landscape' as const,
    composition: null,
    takenAt: null,
  };
}

async function seedBookWithPhotos(suffix: string) {
  const user = await makeUser(suffix);
  const album = await makeAlbum(user.id);
  await db.transaction(async (tx) => {
    await draftPageRepo.replaceAll(
      tx,
      album.id,
      [
        {
          pageIndex: 0,
          templateId: 'mag-01',
          images: { hero: PHOTO_WITH_PROFILE },
          texts: { title: 'Hello' },
          html: '<div data-template="mag-01">Hello</div>',
        },
      ],
      1,
      user.id,
    );
    await albumPhotoRepo.upsertMany(tx, album.id, [
      { photoId: PHOTO_WITH_PROFILE, status: 'uploaded' },
      { photoId: PHOTO_WITHOUT_PROFILE, status: 'uploaded' },
    ]);
  });
  await albumRepo.update(db, album.id, {
    status: 'EDITING',
    stage: 'story',
    draftRevision: 1,
    draftStructureRevision: 1,
    draftJson: {
      version: 'v3-story',
      tree: {
        chapters: [
          {
            chapterId: 'c1',
            title: '第一章',
            description: '',
            accentColor: null,
            artFont: null,
            chapterContext: '',
            place: '',
            keywords: [],
            photos: [chapterPhoto(PHOTO_WITH_PROFILE), chapterPhoto(PHOTO_WITHOUT_PROFILE)],
          },
        ],
      },
      pages: [],
      progress: { currentChapterId: 'c1', doneChapterIds: [] },
    },
  });
  return { userId: user.id, albumId: album.id };
}

/** 捕获 loadBook 的载荷,不发网络。恢复原方法由调用方 finally 负责。 */
function captureLoadBook() {
  const original = designAgentClient.loadBook;
  const seen: { book?: Record<string, unknown> } = {};
  designAgentClient.loadBook = async (_albumId, book) => {
    seen.book = book as unknown as Record<string, unknown>;
  };
  return {
    seen,
    restore() {
      designAgentClient.loadBook = original;
    },
  };
}

type PayloadPhoto = { photoId: string; profile?: PhotoProfile };

function payloadPhotos(book: Record<string, unknown> | undefined): PayloadPhoto[] {
  const chapters = (book?.chapters ?? []) as Array<{ photos?: PayloadPhoto[] }>;
  return chapters.flatMap((chapter) => chapter.photos ?? []);
}

test('装书载荷带上库里的照片档案(没建档的那张不带 profile 键)', async (t) => {
  if (!(await isDbReachable())) return t.skip('db unreachable');
  const { userId, albumId } = await seedBookWithPhotos('dcp-profile');
  const capture = captureLoadBook();
  try {
    await albumPhotoRepo.setProfiles(albumId, { [PHOTO_WITH_PROFILE]: profile });

    await albumService.prepareDesignChat(userId, albumId);

    const photos = payloadPhotos(capture.seen.book);
    const withProfile = photos.find((p) => p.photoId === PHOTO_WITH_PROFILE);
    const withoutProfile = photos.find((p) => p.photoId === PHOTO_WITHOUT_PROFILE);
    assert.ok(withProfile, '装书载荷里应有这张照片');
    assert.equal(withProfile.profile?.description, profile.description);
    assert.equal(withProfile.profile?.subjectBox?.x, 20);
    assert.ok(withoutProfile, '没建档的那张仍要在载荷里');
    assert.equal(withoutProfile.profile, undefined, '没建档 => 不造假 profile 键');
  } finally {
    capture.restore();
    await cleanupUser(userId);
  }
});

test('一张档案都没有时装书载荷照常发出(存量书不能因此打不开)', async (t) => {
  if (!(await isDbReachable())) return t.skip('db unreachable');
  const { userId, albumId } = await seedBookWithPhotos('dcp-noprofile');
  const capture = captureLoadBook();
  try {
    await albumService.prepareDesignChat(userId, albumId);
    const photos = payloadPhotos(capture.seen.book);
    assert.equal(photos.length, 2);
    assert.ok(photos.every((p) => p.profile === undefined));
  } finally {
    capture.restore();
    await cleanupUser(userId);
  }
});
