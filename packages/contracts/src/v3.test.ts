import assert from 'node:assert/strict';
import test from 'node:test';

import { AlbumStage, ArtFontPack, TemplateCategory } from './enums';
import {
  AccentColor,
  AlbumLayoutPlan,
  Page,
  V3Chapter,
  V3ChapterPhoto,
  V3LayoutTree,
} from './layout';
import {
  V3AnalyzeRequest,
  V3ApplyThemeRequest,
  V3Callback,
  V3ChapterChatResponse,
  V3CoverRequest,
  V3FinalizeResponse,
  V3RecommendResponse,
} from './v3';
import {
  TemplateDef,
  TemplateItems,
  TemplateSvgSlot,
  TemplateTextSlot,
} from './templates';

// ───────────────────────── enums(合法集边界) ─────────────────────────

test('AlbumStage covers exactly the five-环节 states', () => {
  assert.deepEqual(AlbumStage.options, ['analysing', 'story', 'theme', 'cover', 'ready']);
  assert.equal(AlbumStage.safeParse('story').success, true);
  assert.equal(AlbumStage.safeParse('done').success, false);
});

test('TemplateCategory replaces slot+scene with cover|interior|toc|ending', () => {
  assert.deepEqual(TemplateCategory.options, ['cover', 'interior', 'toc', 'ending']);
  assert.equal(TemplateCategory.safeParse('toc').success, true);
  assert.equal(TemplateCategory.safeParse('opening').success, false); // old scene rejected
});

test('ArtFontPack is a closed legal set', () => {
  assert.equal(ArtFontPack.safeParse('serif-classic').success, true);
  assert.equal(ArtFontPack.safeParse('comic-sans').success, false);
});

// ───────────────────────── 章节树(§3 隐私 + 边界) ─────────────────────────

test('AccentColor accepts #RGB / #RRGGBB and rejects non-hex', () => {
  assert.equal(AccentColor.safeParse('#abc').success, true);
  assert.equal(AccentColor.safeParse('#A1B2C3').success, true);
  assert.equal(AccentColor.safeParse('red').success, false);
  assert.equal(AccentColor.safeParse('#12').success, false);
});

const baseChapterPhoto = {
  photoId: 'p1',
  sceneDescription: 'a woman in a red coat walking in the snow',
  width: 800,
  height: 1200,
  orientation: 'portrait' as const,
  takenAt: '2024-03-15T08:30:00.000Z',
};

test('V3ChapterPhoto parses the analysis-tree photo shape', () => {
  assert.equal(V3ChapterPhoto.safeParse(baseChapterPhoto).success, true);
  // takenAt optional/nullable (EXIF may be missing; no GPS)
  assert.equal(
    V3ChapterPhoto.safeParse({ ...baseChapterPhoto, takenAt: null }).success,
    true,
  );
  // Browser EXIF is local wall time with no zone.
  assert.equal(
    V3ChapterPhoto.safeParse({ ...baseChapterPhoto, takenAt: '2024-03-15T08:30:00' }).success,
    true,
  );
  assert.equal(
    V3ChapterPhoto.safeParse({ ...baseChapterPhoto, takenAt: '2024-03-15T08:30:00+08:00' }).success,
    false,
  );
});

test('V3ChapterPhoto rejects any location/GPS field (§3 privacy red line)', () => {
  for (const leak of ['location', 'place', 'lat', 'lng', 'gps', 'coordinates']) {
    assert.equal(
      V3ChapterPhoto.safeParse({ ...baseChapterPhoto, [leak]: 'x' }).success,
      false,
      `${leak} must be rejected by strict()`,
    );
  }
});

test('V3Chapter holds null placeholders for accentColor/artFont at analysis time', () => {
  const chapter = {
    chapterId: 'c1',
    description: 'a quiet spring morning in an old town',
    accentColor: null,
    artFont: null,
    photos: [baseChapterPhoto],
  };
  assert.equal(V3Chapter.safeParse(chapter).success, true);
  // theme 环节填值后仍合法
  assert.equal(
    V3Chapter.safeParse({ ...chapter, accentColor: '#aabbcc', artFont: 'sans-modern' }).success,
    true,
  );
  // 非法字体 / 非法色被边界拦下
  assert.equal(V3Chapter.safeParse({ ...chapter, artFont: 'nope' }).success, false);
  assert.equal(V3Chapter.safeParse({ ...chapter, accentColor: 'blue' }).success, false);
});

test('V3LayoutTree round-trips through strict parse', () => {
  const tree = {
    chapters: [
      { chapterId: 'c1', description: 'd', accentColor: null, artFont: null, photos: [baseChapterPhoto] },
    ],
  };
  assert.deepEqual(V3LayoutTree.parse(tree), tree);
  assert.equal(V3LayoutTree.safeParse({ chapters: [], extra: 1 }).success, false);
});

test('shared Page is strict for nested V3 endpoint payloads', () => {
  assert.equal(
    Page.safeParse({ pageIndex: 0, templateId: 'mag-08', images: {}, texts: {}, extra: true }).success,
    false,
  );
});

test('AlbumLayoutPlan follows the TS render contract without the legacy 16-page cap', () => {
  assert.equal(
    AlbumLayoutPlan.safeParse({
      magazine: { title: 'My Book', style: 'warm-film', language: 'en' },
      photos: [],
      pages: Array.from({ length: 17 }, (_, pageIndex) => ({
        pageIndex,
        templateId: 'mag-08',
        images: {},
        texts: {},
      })),
    }).success,
    true,
  );
});

test('AlbumLayoutPlan photos are the strict external render shape', () => {
  assert.equal(
    AlbumLayoutPlan.safeParse({
      magazine: { title: 'My Book', style: 'warm-film', language: 'en' },
      photos: [
        {
          photoId: 'p1',
          description: 'x',
          tags: [],
          quality: 'hero',
          orientation: 'landscape',
          peopleCount: '1',
        },
      ],
      pages: [{ pageIndex: 0, templateId: 'mag-08', images: {}, texts: {} }],
    }).success,
    false,
  );
});

// ───────────────────────── 模板新字段(§9) ─────────────────────────

test('TemplateTextSlot accepts hint + variableDecor', () => {
  assert.deepEqual(
    TemplateTextSlot.parse({ id: 'title', role: 'title', lang: 'user', hint: 'one line', variableDecor: true }),
    { id: 'title', role: 'title', lang: 'user', hint: 'one line', variableDecor: true },
  );
  // hint maxChars boundary
  assert.equal(
    TemplateTextSlot.safeParse({ id: 't', role: 'body', lang: 'user', hint: 'x'.repeat(201) }).success,
    false,
  );
});

test('TemplateSvgSlot + TemplateItems parse the V3 decoration/repeat shapes', () => {
  assert.deepEqual(TemplateSvgSlot.parse({ id: 'divider', variableDecor: true }), {
    id: 'divider',
    variableDecor: true,
  });
  const items = {
    images: [{ id: 'image' }],
    texts: [{ id: 'caption', role: 'explain' as const, lang: 'user' as const, maxChars: 70 }],
  };
  assert.deepEqual(TemplateItems.parse(items), items);
});

test('TemplateDef tolerates legacy slot/scene AND accepts new category/svgs/items', () => {
  // legacy (current JSON shape) still parses — WP0.2 容忍策略
  assert.equal(
    TemplateDef.safeParse({
      id: 'mag-x',
      slot: 'interior',
      scene: 'portrait',
      images: [{ id: 'image', quality: ['hero'], orientation: ['portrait'] }],
      texts: [{ id: 'body', role: 'body', lang: 'user' }],
    }).success,
    true,
  );
  // new V3 shape parses
  assert.equal(
    TemplateDef.safeParse({
      id: 'mag-y',
      category: 'interior',
      images: [{ id: 'image' }],
      svgs: [{ id: 'divider', variableDecor: true }],
      texts: [{ id: 'title', role: 'title', lang: 'user', variableDecor: true, hint: 'h' }],
      items: { texts: [{ id: 'caption', role: 'explain', lang: 'user', maxChars: 70 }] },
    }).success,
    true,
  );
  // Classification is required in either the V3 or transitional legacy form.
  assert.equal(
    TemplateDef.safeParse({
      id: 'mag-z',
      images: [{ id: 'image' }],
      texts: [{ id: 'title', role: 'title', lang: 'user' }],
    }).success,
    false,
  );
});

// ───────────────────────── 端点契约(§8) ─────────────────────────

test('V3AnalyzeRequest exif is strict — only takenAt, rejects lat/lng (§3 privacy)', () => {
  const base = {
    requestId: 'r1',
    albumId: 'a1',
    callbackUrl: 'https://example.com/cb',
    language: 'en' as const,
    photos: [{ photoId: 'p1', base64: 'data:image/jpeg;base64,AA==', width: 800, height: 600 }],
  };
  assert.equal(V3AnalyzeRequest.safeParse(base).success, true);
  assert.equal(
    V3AnalyzeRequest.safeParse({ ...base, callbackUrl: 'mailto:ops@example.com' }).success,
    false,
  );
  assert.equal(
    V3AnalyzeRequest.safeParse({
      ...base,
      photos: [{ ...base.photos[0], base64: 'AA==' }],
    }).success,
    false,
  );
  assert.equal(
    V3AnalyzeRequest.safeParse({
      ...base,
      photos: [{ ...base.photos[0], base64: 'data:image/jpeg;base64,AA=A' }],
    }).success,
    false,
  );
  assert.equal(
    V3AnalyzeRequest.safeParse({
      ...base,
      photos: [
        {
          ...base.photos[0],
          base64: `data:image/png;base64,${Buffer.from(new Uint8Array(800 * 1024 + 1)).toString('base64')}`,
        },
      ],
    }).success,
    false,
  );
  // takenAt accepted
  assert.equal(
    V3AnalyzeRequest.safeParse({
      ...base,
      photos: [{ ...base.photos[0], exif: { takenAt: '2024-03-15T08:30:00.000Z' } }],
    }).success,
    true,
  );
  assert.equal(
    V3AnalyzeRequest.safeParse({
      ...base,
      photos: [{ ...base.photos[0], exif: { takenAt: '2024-03-15T08:30:00' } }],
    }).success,
    true,
  );
  assert.equal(
    V3AnalyzeRequest.safeParse({
      ...base,
      photos: [{ ...base.photos[0], exif: { takenAt: '2024-03-15T08:30:00+08:00' } }],
    }).success,
    false,
  );
  // lat/lng rejected by strict exif
  assert.equal(
    V3AnalyzeRequest.safeParse({
      ...base,
      photos: [{ ...base.photos[0], exif: { takenAt: null, lat: 1, lng: 2 } }],
    }).success,
    false,
  );
});

test('V3ChapterChatResponse: kind drives which patch is present', () => {
  const usage = { durationMs: 1, models: {} };
  // write turn carries pagesTexts
  assert.equal(
    V3ChapterChatResponse.safeParse({
      kind: 'write',
      assistantReply: 'done',
      pagesTexts: [{ pageIndex: 0, texts: { body: 'hi' } }],
      usage,
    }).success,
    true,
  );
  // talk turn carries neither patch
  assert.equal(
    V3ChapterChatResponse.safeParse({ kind: 'talk', assistantReply: 'tell me more', usage }).success,
    true,
  );
  assert.equal(V3ChapterChatResponse.safeParse({ kind: 'sing', assistantReply: 'x', usage }).success, false);
});

test('V3RecommendResponse returns theme options + per-chapter color/font in legal sets', () => {
  const ok = V3RecommendResponse.safeParse({
    themeOptions: [{ subject: 'Spring in Kyoto', label: 'Kyoto' }],
    chapterColors: [{ chapterId: 'c1', accentColor: '#aabbcc', artFont: 'serif-classic' }],
    assistantReply: '',
    usage: { durationMs: 1, models: {} },
  });
  assert.equal(ok.success, true);
});

test('V3ApplyThemeRequest + V3CoverRequest carry page-level patches (not tree fields)', () => {
  const page = { pageIndex: 0, templateId: 'mag-08', images: {}, texts: {} };
  assert.equal(
    V3ApplyThemeRequest.safeParse({
      albumId: 'a1',
      language: 'en',
      theme: { subject: 's', label: 'l' },
      chapters: [{ chapterId: 'c1', accentColor: '#abc', artFont: 'sans-modern' }],
      pages: [page],
    }).success,
    true,
  );
  // cover can be skipped (null) — §4.4
  assert.equal(
    V3CoverRequest.safeParse({
      albumId: 'a1',
      language: 'en',
      coverTemplateId: null,
      endingTemplateId: null,
      pages: [page],
    }).success,
    true,
  );
});

test('V3FinalizeResponse returns the flat AlbumLayoutPlan (render contract)', () => {
  const ok = V3FinalizeResponse.safeParse({
    layout: {
      magazine: { title: 'My Book', style: 'warm-film', language: 'en' },
      photos: [],
      pages: [{ pageIndex: 0, templateId: 'mag-08', images: {}, texts: {} }],
    },
    usage: { durationMs: 1, models: {} },
  });
  assert.equal(ok.success, true);
});

test('V3Callback union: progress / completed(analyze) / failed', () => {
  assert.equal(
    V3Callback.safeParse({
      requestId: 'r1',
      jobKind: 'analyze',
      event: 'progress',
      stage: 'describe',
      progress: 40,
    }).success,
    true,
  );
  assert.equal(
    V3Callback.safeParse({
      requestId: 'r1',
      jobKind: 'analyze',
      event: 'completed',
      tree: { chapters: [] },
      pages: [{ pageIndex: 0, templateId: 'mag-08', images: {}, texts: {} }],
      usage: { durationMs: 1, models: {} },
    }).success,
    true,
  );
  assert.equal(
    V3Callback.safeParse({
      requestId: 'r1',
      jobKind: 'analyze',
      event: 'failed',
      error: { code: 'AGENT_TIMEOUT', message: 'timeout' },
    }).success,
    true,
  );
});
