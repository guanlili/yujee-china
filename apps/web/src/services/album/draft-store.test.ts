import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Page, V3LayoutTree as V3LayoutTreeT, V3StoryDraft, V3StoryProgress } from '@yujee/contracts';
import { db } from '../../db/client';
import { albumRepo } from '../../db/repos/album-repo';
import { draftPageRepo } from '../../db/repos/draft-page-repo';
import { cleanupUser, isDbReachable, makeAlbum, makeUser } from '../../db/repos/__test__/setup';
import { ensureDraftPagesSeeded, envelopeJson, loadStoryDraft, type DraftEnvelope } from './draft-store';

const TREE: V3LayoutTreeT = { chapters: [] };
const PROGRESS: V3StoryProgress = { currentChapterId: null, doneChapterIds: [] };
const DESIGN = { fonts: { body: 'serif' }, colors: { accent: '#ff0000' } };

// `mag-01` is a registered HTML template (see bake-html.test.ts) — needed so
// bakePagesHtml actually produces html instead of skipping (lenient mode).
const rowPage: Page = {
  pageIndex: 0,
  templateId: 'mag-01',
  images: { image: 'row-photo' },
  texts: { title: 'Row Title', label: 'ROW', explain1: 'a', explain2: 'b' },
};

const legacyPage: Page = {
  pageIndex: 0,
  templateId: 'mag-01',
  images: { image: 'legacy-photo' },
  texts: { title: 'Legacy Title', label: 'LEGACY', explain1: 'x', explain2: 'y' },
};

function wrappedDraftJson(pages: Page[]): V3StoryDraft {
  return {
    version: 'v3-story',
    tree: TREE,
    pages,
    progress: PROGRESS,
    design: DESIGN,
  };
}

test('loadStoryDraft: rows preferred over legacy draftJson.pages, baked by default', async (t) => {
  if (!(await isDbReachable())) { t.skip('DATABASE_URL is not reachable; skipping'); return; }
  const user = await makeUser('draft-store-rows');
  try {
    const album = await makeAlbum(user.id);
    // draftJson still carries a (deliberately different) legacy `pages` array —
    // rows must win once they exist, proving the envelope's own `pages` key is
    // never consulted when count > 0.
    await albumRepo.update(db, album.id, {
      draftJson: wrappedDraftJson([legacyPage]),
      draftRevision: 5,
    });
    await db.transaction(async (tx) => {
      await draftPageRepo.replaceAll(tx, album.id, [rowPage], 5, user.id);
    });

    const loadedAlbum = await albumRepo.findById(album.id);
    const loaded = await loadStoryDraft(loadedAlbum!);
    assert.ok(loaded);
    assert.equal(loaded!.revision, 5);
    assert.deepEqual(loaded!.tree, TREE);
    assert.deepEqual(loaded!.progress, PROGRESS);
    assert.deepEqual(loaded!.design, DESIGN);
    assert.equal(loaded!.pages.length, 1);
    assert.equal(loaded!.pages[0].images.image, 'row-photo');
    assert.ok(loaded!.pages[0].html, 'expected html to be baked on read');
    assert.match(loaded!.pages[0].html!, /Row Title/);
  } finally {
    await cleanupUser(user.id);
  }
});

test('loadStoryDraft: bake:false leaves html unbaked', async (t) => {
  if (!(await isDbReachable())) { t.skip('DATABASE_URL is not reachable; skipping'); return; }
  const user = await makeUser('draft-store-nobake');
  try {
    const album = await makeAlbum(user.id);
    await albumRepo.update(db, album.id, {
      draftJson: wrappedDraftJson([]),
      draftRevision: 3,
    });
    await db.transaction(async (tx) => {
      await draftPageRepo.replaceAll(tx, album.id, [rowPage], 3, user.id);
    });

    const loadedAlbum = await albumRepo.findById(album.id);
    const loaded = await loadStoryDraft(loadedAlbum!, { bake: false });
    assert.ok(loaded);
    assert.equal(loaded!.pages.length, 1);
    assert.equal(loaded!.pages[0].html, undefined);
  } finally {
    await cleanupUser(user.id);
  }
});

test('loadStoryDraft: no rows falls back to legacy draftJson.pages, read-only (never seeds)', async (t) => {
  if (!(await isDbReachable())) { t.skip('DATABASE_URL is not reachable; skipping'); return; }
  const user = await makeUser('draft-store-legacy');
  try {
    const album = await makeAlbum(user.id);
    await albumRepo.update(db, album.id, {
      draftJson: wrappedDraftJson([legacyPage]),
      draftRevision: 0,
    });

    const loadedAlbum = await albumRepo.findById(album.id);
    const loaded = await loadStoryDraft(loadedAlbum!);
    assert.ok(loaded);
    assert.equal(loaded!.revision, 0);
    assert.equal(loaded!.pages.length, 1);
    assert.equal(loaded!.pages[0].images.image, 'legacy-photo');

    // Read-only: no draft_pages rows must have been created as a side effect.
    assert.equal((await draftPageRepo.findByAlbum(album.id)).length, 0);
  } finally {
    await cleanupUser(user.id);
  }
});

test('ensureDraftPagesSeeded: seeds a legacy album (rows + revision=1), idempotent on rerun', async (t) => {
  if (!(await isDbReachable())) { t.skip('DATABASE_URL is not reachable; skipping'); return; }
  const user = await makeUser('draft-store-seed');
  try {
    const album = await makeAlbum(user.id);
    await albumRepo.update(db, album.id, {
      draftJson: wrappedDraftJson([legacyPage]),
      draftRevision: 0,
    });

    const firstRevision = await db.transaction(async (tx) => {
      const locked = await albumRepo.findByIdForUpdate(tx, album.id);
      return ensureDraftPagesSeeded(tx, locked!);
    });
    assert.equal(firstRevision, 1);

    const seededRows = await draftPageRepo.findByAlbum(album.id);
    assert.equal(seededRows.length, 1);
    assert.deepEqual(seededRows[0].page, legacyPage);
    assert.equal(seededRows[0].version, 1);
    assert.equal(seededRows[0].updatedBy, null);
    // Seeding relocates bytes as-is — it must NOT bake html (that stays a
    // read-time-only concern of loadStoryDraft).
    assert.equal(seededRows[0].page.html, undefined);

    const albumAfterSeed = await albumRepo.findById(album.id);
    assert.equal(albumAfterSeed!.draftRevision, 1);

    // Idempotent: calling again once rows already exist must not reseed or
    // duplicate rows, and must return the (unchanged) current revision.
    const secondRevision = await db.transaction(async (tx) => {
      const locked = await albumRepo.findByIdForUpdate(tx, album.id);
      return ensureDraftPagesSeeded(tx, locked!);
    });
    assert.equal(secondRevision, 1);
    assert.equal((await draftPageRepo.findByAlbum(album.id)).length, 1);
  } finally {
    await cleanupUser(user.id);
  }
});

test('loadStoryDraft / ensureDraftPagesSeeded: neither rows nor legacy pages', async (t) => {
  if (!(await isDbReachable())) { t.skip('DATABASE_URL is not reachable; skipping'); return; }
  const user = await makeUser('draft-store-empty');
  try {
    const album = await makeAlbum(user.id); // draftJson null, draftRevision 0, no rows

    const loadedAlbum = await albumRepo.findById(album.id);
    assert.equal(await loadStoryDraft(loadedAlbum!), null);

    const revision = await db.transaction(async (tx) => {
      const locked = await albumRepo.findByIdForUpdate(tx, album.id);
      return ensureDraftPagesSeeded(tx, locked!);
    });
    assert.equal(revision, 0);
    assert.equal((await draftPageRepo.findByAlbum(album.id)).length, 0);
  } finally {
    await cleanupUser(user.id);
  }
});

test('envelopeJson: writes exactly {version, tree, progress, design}, never a pages key', () => {
  const withDesign: DraftEnvelope = { tree: TREE, progress: PROGRESS, design: DESIGN };
  const json = envelopeJson(withDesign);
  assert.equal(json.version, 'v3-story');
  assert.deepEqual(json.tree, TREE);
  assert.deepEqual(json.progress, PROGRESS);
  assert.deepEqual(json.design, DESIGN);
  assert.equal('pages' in json, false);
  assert.deepEqual(Object.keys(json).sort(), ['design', 'progress', 'tree', 'version']);

  const withoutDesign: DraftEnvelope = { tree: TREE, progress: PROGRESS };
  const jsonNoDesign = envelopeJson(withoutDesign);
  assert.equal('design' in jsonNoDesign, false);
  assert.equal('pages' in jsonNoDesign, false);
  assert.deepEqual(Object.keys(jsonNoDesign).sort(), ['progress', 'tree', 'version']);
});
