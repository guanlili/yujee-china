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
  V3ChapterOverview,
  V3ChapterChatResponse,
  V3CoverRequest,
  V3CoverResponse,
  V3EditChatRequest,
  V3EditChatResponse,
  V3FinalizeResponse,
  V3InternalAgentAckRequest,
  V3InternalAgentAckResponse,
  V3InternalAgentDataRequest,
  V3InternalAgentDataResponse,
  V3PageEditRequest,
  V3PageEditResponse,
  V3RecommendResponse,
  SelectLayoutCompleted,
  SelectLayoutRequest,
  V3StoryDraft,
  V3StoryProgress,
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

test('test_v3_chapter_carries_extracted_color', () => {
  const chapter = {
    chapterId: 'c1',
    description: 'a quiet spring morning in an old town',
    extractedColor: '#abc',
    accentColor: null,
    artFont: null,
    photos: [baseChapterPhoto],
  };

  assert.equal(V3Chapter.safeParse(chapter).success, true);
  assert.equal(V3Chapter.safeParse({ ...chapter, extractedColor: null }).success, true);
  assert.equal(V3Chapter.safeParse({ ...chapter, extractedColor: 'blue' }).success, false);
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

test('TemplateDef is category-only — legacy slot/scene are rejected', () => {
  // V3 shape parses (category + svgs + items + image orientation/quality hints).
  assert.equal(
    TemplateDef.safeParse({
      id: 'mag-y',
      category: 'interior',
      images: [{ id: 'image', quality: ['hero'], orientation: ['portrait'] }],
      svgs: [{ id: 'divider', variableDecor: true }],
      texts: [{ id: 'title', role: 'title', lang: 'user', variableDecor: true, hint: 'h' }],
      items: { texts: [{ id: 'explain', role: 'explain', lang: 'user', maxChars: 70 }] },
    }).success,
    true,
  );
  // Legacy slot/scene are removed — supplying them is an unrecognized-key error.
  assert.equal(
    TemplateDef.safeParse({
      id: 'mag-x',
      slot: 'interior',
      scene: 'portrait',
      images: [{ id: 'image' }],
      texts: [{ id: 'body', role: 'body', lang: 'user' }],
    }).success,
    false,
  );
  // category is required.
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

test('V3AnalyzeRequest photo accepts clusterId, rejects coordinate keys (#232 §3 privacy)', () => {
  const base = {
    requestId: 'r1',
    albumId: 'a1',
    callbackUrl: 'https://example.com/cb',
    language: 'en' as const,
    photos: [{ photoId: 'p1', base64: 'data:image/jpeg;base64,AA==', width: 800, height: 600 }],
  };
  // clusterId absent (backward compatible) accepted
  assert.equal(V3AnalyzeRequest.safeParse(base).success, true);
  // clusterId string label accepted
  assert.equal(
    V3AnalyzeRequest.safeParse({
      ...base,
      photos: [{ ...base.photos[0], clusterId: 'c1' }],
    }).success,
    true,
  );
  // clusterId null (browser couldn't derive — no EXIF/GPS) accepted
  assert.equal(
    V3AnalyzeRequest.safeParse({
      ...base,
      photos: [{ ...base.photos[0], clusterId: null }],
    }).success,
    true,
  );
  // empty clusterId string rejected (min(1))
  assert.equal(
    V3AnalyzeRequest.safeParse({
      ...base,
      photos: [{ ...base.photos[0], clusterId: '' }],
    }).success,
    false,
  );
  // clusterId must not smuggle coordinates — any geo key still rejected by strict()
  for (const leak of ['lat', 'lng', 'latitude', 'longitude', 'gps', 'place', 'location', 'coordinates']) {
    assert.equal(
      V3AnalyzeRequest.safeParse({
        ...base,
        photos: [{ ...base.photos[0], clusterId: 'c1', [leak]: 1 }],
      }).success,
      false,
      `${leak} must be rejected by strict() on the analyze photo`,
    );
  }
});

test('SelectLayoutRequest carries 200px refs and takenAt, and rejects caller candidates', () => {
  const payload = {
    requestId: 'layout-r1',
    callbackUrl: 'https://example.com/api/v3/internal/job-progress',
    language: 'en' as const,
    chapters: [
      {
        chapterId: 'ch_1',
        structureHint: 'coast morning',
        photos: [
          {
            photoId: 'p1',
            ref200px: 'data:image/jpeg;base64,AA==',
            orientation: 'landscape' as const,
            takenAt: '2024-03-15T08:30:00',
          },
          {
            photoId: 'p2',
            ref200px: 'data:image/png;base64,AA==',
            orientation: 'portrait' as const,
            takenAt: null,
          },
        ],
      },
    ],
  };

  assert.equal(SelectLayoutRequest.safeParse(payload).success, true);
  assert.equal(
    SelectLayoutRequest.safeParse({
      ...payload,
      chapters: [
        {
          ...payload.chapters[0],
          candidates: [{ templateId: 'mag-08', category: 'interior', imageSlotCount: 2 }],
        },
      ],
    }).success,
    false,
  );
  assert.equal(
    SelectLayoutRequest.safeParse({
      ...payload,
      chapters: [
        {
          ...payload.chapters[0],
          photos: [{ ...payload.chapters[0].photos[0], takenAt: undefined }],
        },
      ],
    }).success,
    false,
  );
});

test('internal agent ack schemas parse request and response', () => {
  assert.deepEqual(V3InternalAgentAckRequest.parse({ opId: 'op_1' }), { opId: 'op_1' });
  assert.deepEqual(V3InternalAgentAckResponse.parse({ ok: false }), { ok: false });
  assert.equal(V3InternalAgentAckRequest.safeParse({ opId: 'op_1', extra: true }).success, false);
  assert.equal(V3InternalAgentAckResponse.safeParse({ ok: true, data: {} }).success, false);
});

test('internal agent-data schemas cover query parsing and response envelopes', () => {
  assert.deepEqual(
    V3InternalAgentDataRequest.parse({
      type: 'page-info',
      albumId: 'a1',
      scope: 'page',
      chapterId: 'c1',
      pageIndex: '2',
    }),
    { type: 'page-info', albumId: 'a1', scope: 'page', chapterId: 'c1', pageIndex: 2 },
  );
  assert.equal(
    V3InternalAgentDataRequest.safeParse({
      type: 'page-info',
      albumId: 'a1',
      scope: 'page',
      chapterId: 'c1',
    }).success,
    false,
  );
  assert.deepEqual(
    V3InternalAgentDataRequest.parse({
      type: 'chapter-search',
      albumId: 'a1',
      query: ' coast ',
    }),
    { type: 'chapter-search', albumId: 'a1', query: 'coast', limit: 5 },
  );
  assert.deepEqual(
    V3InternalAgentDataRequest.parse({
      type: 'page-photos',
      albumId: 'a1',
      chapterId: 'c1',
    }),
    { type: 'page-photos', albumId: 'a1', chapterId: 'c1' },
  );

  const chapter = {
    chapterId: 'c1',
    description: 'coast morning',
    accentColor: null,
    artFont: null,
    photos: [baseChapterPhoto],
  };
  assert.equal(
    V3InternalAgentDataResponse.safeParse({
      type: 'page-info',
      data: {
        chapter,
        pages: [{ pageIndex: 2, templateId: 'mag-03', images: { image: 'p1' }, texts: {} }],
      },
    }).success,
    true,
  );
  assert.equal(
    V3InternalAgentDataResponse.safeParse({
      type: 'chapter-search',
      data: { matches: [{ chapterId: 'c1', pageIndexes: [2], label: 'coast morning', score: 1 }] },
    }).success,
    true,
  );
  assert.equal(
    V3InternalAgentDataResponse.safeParse({
      type: 'page-photos',
      data: { photos: [{ photoId: 'p1', ref200px: 'data:image/jpeg;base64,AA==', orientation: 'portrait', takenAt: null }] },
    }).success,
    true,
  );
  assert.equal(
    V3InternalAgentDataResponse.safeParse({
      type: 'page-info',
      data: {
        chapter: { ...chapter, photos: [{ ...baseChapterPhoto, location: 'private' }] },
        pages: [],
      },
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

test('V3EditChatResponse requires opId and supports commit bundle fields', () => {
  assert.equal(
    V3EditChatResponse.safeParse({
      kind: 'edit',
      assistantReply: 'Updated.',
      patches: [{ pageIndex: 2, texts: { body: 'New copy' } }],
      pagesTexts: [{ pageIndex: 1, texts: { title: 'Coast' } }],
      progressDecision: { pageDone: true, chapterDone: true, advanceTo: 'theme' },
      opId: 'op_1',
      usage: { durationMs: 1, models: {} },
    }).success,
    true,
  );

  assert.equal(
    V3EditChatResponse.safeParse({
      kind: 'edit',
      assistantReply: 'Updated.',
      patches: [],
      usage: { durationMs: 1, models: {} },
    }).success,
    false,
  );
});

test('V3EditChatRequest is slim and does not carry chapter pages or history', () => {
  assert.equal(
    V3EditChatRequest.safeParse({
      albumId: 'alb_1',
      language: 'en',
      userMessage: 'write this chapter',
      focus: { chapterId: 'c1', pageIndex: 3 },
      progress: { currentChapterId: 'c1', doneChapterIds: [] },
    }).success,
    true,
  );

  assert.equal(
    V3EditChatRequest.safeParse({
      albumId: 'alb_1',
      language: 'en',
      userMessage: 'write this chapter',
      focus: { chapterId: 'c1' },
      progress: { currentChapterId: 'c1', doneChapterIds: [] },
      history: [],
      pages: [],
    }).success,
    false,
  );
});

// ───────────────────── ②b 页级编辑 — POST /v3/page-edit ─────────────────────

const pageEditChapter = {
  chapterId: 'c1',
  description: 'd',
  accentColor: null,
  artFont: null,
  photos: [baseChapterPhoto],
};

test('V3PageEditRequest mirrors chapter-chat fields, focusedPageIndex required', () => {
  const base = {
    language: 'en' as const,
    chapter: pageEditChapter,
    pages: [{ pageIndex: 0, templateId: 'mag-08', images: { image: 'p1' }, texts: {} }],
    focusedPageIndex: 0,
    userMessage: 'tighten the caption',
    history: [{ role: 'user' as const, content: 'hi' }],
  };
  assert.equal(V3PageEditRequest.safeParse(base).success, true);
  // focusedPageIndex is required (no optional default — page-edit always targets a page)
  const { focusedPageIndex, ...noFocus } = base;
  assert.equal(V3PageEditRequest.safeParse(noFocus).success, false);
  // strict: unknown key rejected
  assert.equal(V3PageEditRequest.safeParse({ ...base, albumId: 'a1' }).success, false);
  // §3 privacy: a place/GPS key on the chapter photo is rejected by strict()
  assert.equal(
    V3PageEditRequest.safeParse({
      ...base,
      chapter: { ...pageEditChapter, photos: [{ ...baseChapterPhoto, lat: 1 }] },
    }).success,
    false,
  );
});

test('V3PageEditResponse: intent + optional layoutPatch (reuses V3LayoutPatchEntry)', () => {
  const usage = { durationMs: 1, models: {} };
  // edit_text → texts-only patch entry
  assert.equal(
    V3PageEditResponse.safeParse({
      assistantReply: 'done',
      intent: 'edit_text',
      layoutPatch: [{ pageIndex: 0, texts: { title: 'New Title' } }],
      usage,
    }).success,
    true,
  );
  // change_layout → templateId + images patch entry
  assert.equal(
    V3PageEditResponse.safeParse({
      assistantReply: 'reflowed',
      intent: 'change_layout',
      layoutPatch: [{ pageIndex: 0, templateId: 'mag-04', images: { image1: 'p1', image2: 'p2' } }],
      usage,
    }).success,
    true,
  );
  // advance → advanceIntent, no patch
  assert.equal(
    V3PageEditResponse.safeParse({
      assistantReply: 'moving on',
      intent: 'advance',
      advanceIntent: true,
      usage,
    }).success,
    true,
  );
  // talk → reply only
  assert.equal(
    V3PageEditResponse.safeParse({ assistantReply: 'tell me more', intent: 'talk', usage }).success,
    true,
  );
  // unknown intent rejected
  assert.equal(
    V3PageEditResponse.safeParse({ assistantReply: 'x', intent: 'sing', usage }).success,
    false,
  );
  // strict: unknown key rejected
  assert.equal(
    V3PageEditResponse.safeParse({ assistantReply: 'x', intent: 'talk', usage, extra: 1 }).success,
    false,
  );
});

test('V3RecommendResponse returns per-chapter subject + color/font in legal sets', () => {
  const ok = V3RecommendResponse.safeParse({
    chapterColors: [
      { chapterId: 'c1', subject: 'Spring in Kyoto', accentColor: '#aabbcc', artFont: 'serif-classic' },
    ],
    assistantReply: '',
    usage: { durationMs: 1, models: {} },
  });
  assert.equal(ok.success, true);
  // themeOptions / per-chapter subject<min(1) are rejected (strict + min(1)).
  assert.equal(
    V3RecommendResponse.safeParse({
      themeOptions: [{ subject: 's', label: 'l' }],
      chapterColors: [{ chapterId: 'c1', subject: 'x', accentColor: '#aabbcc', artFont: 'serif-classic' }],
      assistantReply: '',
      usage: { durationMs: 1, models: {} },
    }).success,
    false,
  );
  assert.equal(
    V3RecommendResponse.safeParse({
      chapterColors: [{ chapterId: 'c1', subject: '', accentColor: '#aabbcc', artFont: 'serif-classic' }],
      assistantReply: '',
      usage: { durationMs: 1, models: {} },
    }).success,
    false,
  );
});

test('test_v3_chapter_overview_carries_extracted_color', () => {
  const overview = {
    chapterId: 'c1',
    description: 'a quiet spring morning in an old town',
    extractedColor: '#A1B2C3',
    photoDescs: ['red coat in snow'],
  };

  assert.equal(V3ChapterOverview.safeParse(overview).success, true);
  assert.equal(V3ChapterOverview.safeParse({ ...overview, extractedColor: null }).success, true);
  assert.equal(V3ChapterOverview.safeParse({ ...overview, extractedColor: 'red' }).success, false);
});

test('V3ApplyThemeRequest + V3CoverRequest carry page-level patches (not tree fields)', () => {
  const page = { pageIndex: 0, templateId: 'mag-08', images: {}, texts: {} };
  assert.equal(
    V3ApplyThemeRequest.safeParse({
      albumId: 'a1',
      language: 'en',
      chapters: [{ chapterId: 'c1', subject: 's', accentColor: '#abc', artFont: 'sans-modern' }],
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

test('V3CoverRequest accepts Stage5 photo guidance and chat context', () => {
  const page = { pageIndex: 0, templateId: 'mag-08', images: {}, texts: {} };
  const parsed = V3CoverRequest.parse({
    albumId: 'a1',
    language: 'en',
    coverTemplateId: 'mag-01',
    endingTemplateId: 'mag-20',
    coverPhoto: 'data:image/jpeg;base64,AA==',
    endingPhoto: 'data:image/png;base64,AA==',
    coverPhotoDesc: 'a quiet portrait beside a window',
    artFont: 'display-bold',
    hint: 'keep the whole book tender and understated',
    userMessage: 'Could the cover feel calmer?',
    history: [
      { role: 'user', content: 'I want a calmer cover' },
      { role: 'assistant', content: 'I can make it quieter.' },
    ],
    pages: [page],
  });

  assert.equal(parsed.coverPhoto, 'data:image/jpeg;base64,AA==');
  assert.equal(parsed.endingPhoto, 'data:image/png;base64,AA==');
  assert.equal(parsed.coverPhotoDesc, 'a quiet portrait beside a window');
  assert.equal(parsed.artFont, 'display-bold');
  assert.equal(parsed.hint, 'keep the whole book tender and understated');
  assert.equal(parsed.userMessage, 'Could the cover feel calmer?');
  assert.deepEqual(parsed.history, [
    { role: 'user', content: 'I want a calmer cover' },
    { role: 'assistant', content: 'I can make it quieter.' },
  ]);
});

test('V3CoverRequest defaults chat fields and caps history at 20 turns', () => {
  const page = { pageIndex: 0, templateId: 'mag-08', images: {}, texts: {} };
  const parsed = V3CoverRequest.parse({
    albumId: 'a1',
    language: 'en',
    coverTemplateId: null,
    endingTemplateId: null,
    pages: [page],
  });

  assert.equal(parsed.userMessage, '');
  assert.deepEqual(parsed.history, []);
  assert.equal(
    V3CoverRequest.safeParse({
      albumId: 'a1',
      language: 'en',
      history: Array.from({ length: 21 }, () => ({ role: 'user' as const, content: 'x' })),
      pages: [page],
    }).success,
    false,
  );
});

test('V3CoverRequest rejects explicit null for Stage5 optional string fields', () => {
  const page = { pageIndex: 0, templateId: 'mag-08', images: {}, texts: {} };
  for (const key of ['coverPhoto', 'endingPhoto', 'coverPhotoDesc', 'hint'] as const) {
    assert.equal(
      V3CoverRequest.safeParse({
        albumId: 'a1',
        language: 'en',
        pages: [page],
        [key]: null,
      }).success,
      false,
      `${key}: null must be rejected; omit the key instead`,
    );
  }
});

test('V3CoverResponse carries clarification state without public text payloads', () => {
  const usage = { durationMs: 1, models: {} };
  const normal = V3CoverResponse.parse({
    layoutPatch: [],
    usage,
  });
  assert.equal(normal.needsUserInput, false);

  const clarification = V3CoverResponse.parse({
    layoutPatch: [],
    assistantReply: 'Which cover mood should I use?',
    needsUserInput: true,
    usage,
  });
  assert.equal(clarification.needsUserInput, true);
  assert.equal(clarification.assistantReply, 'Which cover mood should I use?');

  assert.equal(
    V3CoverResponse.safeParse({
      layoutPatch: [],
      assistantReply: 'done',
      coverTexts: {},
      usage,
    }).success,
    false,
  );
  assert.equal(
    V3CoverResponse.safeParse({
      layoutPatch: [],
      assistantReply: 'done',
      endingTexts: {},
      usage,
    }).success,
    false,
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

test('V3Callback union: analyze progress / analyze completed / select-layout completed / failed', () => {
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
      usage: { durationMs: 1, models: {} },
    }).success,
    true,
  );
  assert.equal(
    SelectLayoutCompleted.safeParse({
      requestId: 'r1',
      jobKind: 'select-layout',
      event: 'completed',
      pages: [{ pageIndex: 0, templateId: 'mag-08', images: {}, texts: {} }],
      usage: { durationMs: 1, geminiCallCount: 1, models: { planning: 'gemini-layout' } },
    }).success,
    true,
  );
  assert.equal(
    V3Callback.safeParse({
      requestId: 'r1',
      jobKind: 'select-layout',
      event: 'progress',
      stage: 'legalize',
      progress: 50,
    }).success,
    true,
  );
  assert.equal(
    V3Callback.safeParse({
      requestId: 'r1',
      jobKind: 'select-layout',
      event: 'completed',
      pages: [{ pageIndex: 0, templateId: 'mag-08', images: {}, texts: {} }],
      usage: { durationMs: 1, geminiCallCount: 1, models: { planning: 'gemini-layout' } },
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

test('test_analyze_completed_is_tree_only', () => {
  assert.equal(
    V3Callback.safeParse({
      requestId: 'r1',
      jobKind: 'analyze',
      event: 'completed',
      tree: { chapters: [] },
      usage: { durationMs: 1, models: {} },
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
    false,
  );
});

// ───────────────────── ② 章节故事 · 完成度状态(WP2.4) ─────────────────────

test('V3StoryProgress: 当前章 + done 集合(章级标记)', () => {
  assert.equal(
    V3StoryProgress.safeParse({ currentChapterId: 'c2', doneChapterIds: ['c1'] }).success,
    true,
  );
  // 全部确定 = currentChapterId null
  assert.equal(
    V3StoryProgress.safeParse({ currentChapterId: null, doneChapterIds: ['c1', 'c2'] }).success,
    true,
  );
  // strict:拒未知字段(不藏 stage —— stage 在 albums.stage 列,§6.8 第 4 条)
  assert.equal(
    V3StoryProgress.safeParse({
      currentChapterId: 'c1',
      doneChapterIds: [],
      stage: 'story',
    }).success,
    false,
  );
});

test('V3StoryDraft: draft_json 包裹形(tree + preview pages + progress)', () => {
  const ok = V3StoryDraft.safeParse({
    version: 'v3-story',
    tree: { chapters: [] },
    pages: [{ pageIndex: 0, templateId: 'mag-02', images: {}, texts: { headline: 'Hello' } }],
    progress: { currentChapterId: 'c1', doneChapterIds: [] },
  });
  assert.equal(ok.success, true);
  assert.equal(
    V3StoryDraft.safeParse({
      version: 'v3-story',
      tree: { chapters: [] },
      pages: [{ pageIndex: 0, templateId: 'mag-02', images: {}, texts: {}, extra: true }],
      progress: { currentChapterId: null, doneChapterIds: [] },
    }).success,
    false,
  );
  // 裸 V3LayoutTree(WP1.5 写入态)不是包裹形 —— 由 service 归一化,不当 V3StoryDraft 解
  assert.equal(V3StoryDraft.safeParse({ chapters: [] }).success, false);
});
