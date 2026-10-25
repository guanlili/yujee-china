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
  V3Callback,
  V3ChapterOverview,
  V3InternalAgentDataRequest,
  V3InternalAgentDataResponse,
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
    extractedColor: '#c8894a',
    accentColor: null,
    artFont: null,
    photos: [baseChapterPhoto],
  };
  assert.equal(V3Chapter.safeParse(chapter).success, true);
  assert.equal(V3Chapter.safeParse({ ...chapter, extractedColor: null }).success, true);
  // theme 环节填值后仍合法
  assert.equal(
    V3Chapter.safeParse({ ...chapter, accentColor: '#aabbcc', artFont: 'sans-modern' }).success,
    true,
  );
  // 非法字体 / 非法色被边界拦下
  assert.equal(V3Chapter.safeParse({ ...chapter, artFont: 'nope' }).success, false);
  assert.equal(V3Chapter.safeParse({ ...chapter, accentColor: 'blue' }).success, false);
  assert.equal(V3Chapter.safeParse({ ...chapter, extractedColor: 'blue' }).success, false);
});

test('V3Chapter.title 是章标识落点,老树缺这个键仍能解析(向后兼容)', () => {
  const legacy = {
    chapterId: 'c1',
    description: '',
    accentColor: null,
    artFont: null,
    photos: [baseChapterPhoto],
  };
  // 老相册的 draft_json 里没有 title 键:必须解析成功并补空串,不能因契约收紧读不出来。
  const parsedLegacy = V3Chapter.parse(legacy);
  assert.equal(parsedLegacy.title, '');
  // 新树把确定性章标识写在 title 上,description 留给写目录环节。
  const parsed = V3Chapter.parse({ ...legacy, title: '2024 年 03 月 11–14 日' });
  assert.equal(parsed.title, '2024 年 03 月 11–14 日');
  assert.equal(parsed.description, '');
  // 仍然 strict:未知键照样拒。
  assert.equal(V3Chapter.safeParse({ ...legacy, titel: 'x' }).success, false);
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
  // title / chapterContext / place / keywords 都有 .default()：parse 会补上它们，所以 round-trip 的产物比
  // 输入多这几个键。这是 schema 的既定行为(缺省章标识/章节背景/地点 = 空串，关键词 = 空数组)，不是丢失/污染。
  assert.deepEqual(V3LayoutTree.parse(tree), {
    chapters: [{ ...tree.chapters[0], title: '', chapterContext: '', place: '', keywords: [] }],
  });
  // 输入里显式给了 chapterContext 时原样保留(默认值不覆盖真实值);title/place/keywords 仍补默认。
  const withContext = {
    chapters: [{ ...tree.chapters[0], chapterContext: '厦门海边度假' }],
  };
  assert.deepEqual(V3LayoutTree.parse(withContext), {
    chapters: [{ ...withContext.chapters[0], title: '', place: '', keywords: [] }],
  });
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

test('TemplateTextSlot：hint 字段已删除，带 hint 的槽被 strict 拒绝', () => {
  assert.deepEqual(
    TemplateTextSlot.parse({ id: 'title', role: 'title', lang: 'user', variableDecor: true }),
    { id: 'title', role: 'title', lang: 'user', variableDecor: true },
  );
  assert.equal(
    TemplateTextSlot.safeParse({ id: 't', role: 'body', lang: 'user', hint: 'x' }).success,
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
    texts: [{ id: 'caption', role: 'explain' as const, lang: 'user' as const }],
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
      texts: [{ id: 'title', role: 'title', lang: 'user', variableDecor: true }],
      items: { texts: [{ id: 'explain', role: 'explain', lang: 'user' }] },
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

test('V3AnalyzeRequest accepts 100 photos and rejects 101 photos', () => {
  const basePhoto = { photoId: 'p1', base64: 'data:image/jpeg;base64,AA==', width: 800, height: 600 };
  const base = {
    requestId: 'r1',
    albumId: 'a1',
    callbackUrl: 'https://example.com/cb',
    language: 'en' as const,
  };
  const photos = Array.from({ length: 100 }, (_, index) => ({
    ...basePhoto,
    photoId: `p${index + 1}`,
  }));

  assert.equal(V3AnalyzeRequest.safeParse({ ...base, photos }).success, true);
  assert.equal(
    V3AnalyzeRequest.safeParse({
      ...base,
      photos: [...photos, { ...basePhoto, photoId: 'p101' }],
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
  // 豆包识图已砍,sceneDescription 已从选版式入参里删掉:再送就被 strict 拒。
  assert.equal(
    SelectLayoutRequest.safeParse({
      ...payload,
      chapters: [
        {
          ...payload.chapters[0],
          photos: [{ ...payload.chapters[0].photos[0], sceneDescription: 'x' }],
        },
      ],
    }).success,
    false,
  );
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
  assert.deepEqual(
    V3InternalAgentDataRequest.parse({
      type: 'book-tree',
      albumId: 'a1',
      chapterId: 'c1',
      pageIndex: '2',
    }),
    { type: 'book-tree', albumId: 'a1', chapterId: 'c1', pageIndex: 2 },
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
      type: 'book-tree',
      data: {
        progress: { currentChapterId: 'c1', doneChapterIds: [] },
        focusedPageIndex: 2,
        chapters: [{ chapterId: 'c1', label: 'coast morning', pageIndexes: [2], done: false }],
        allDone: false,
      },
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

// ───────────────────── ②b 页级编辑 — POST /v3/page-edit ─────────────────────

const pageEditChapter = {
  chapterId: 'c1',
  description: 'd',
  accentColor: null,
  artFont: null,
  photos: [baseChapterPhoto],
};

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
      usage: { durationMs: 1, planningCallCount: 1, models: { planning: 'gemini-layout' } },
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
      usage: { durationMs: 1, planningCallCount: 1, models: { planning: 'gemini-layout' } },
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
  // 候选缩略图评委整条链路已删:回调联合里不再有 `candidates` 事件分支。
  assert.equal(
    V3Callback.safeParse({
      requestId: 'r1',
      jobKind: 'select-layout',
      event: 'candidates',
      units: [
        {
          unitKey: 'ch_1',
          chapterId: 'ch_1',
          candidates: [{ candidateIndex: 0, pages: [{ templateId: 'mag-08', images: {} }] }],
        },
      ],
      usage: { durationMs: 1, models: {} },
    }).success,
    false,
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

test('V3StoryDraft.design.pageBackground: 契约字段往返保留(此前无 .strict() 的 design 子 schema 会被 zod 默认 strip 静默丢弃)', () => {
  const parsed = V3StoryDraft.safeParse({
    version: 'v3-story',
    tree: { chapters: [] },
    progress: { currentChapterId: null, doneChapterIds: [] },
    design: { fonts: { body: 'serif' }, colors: { accent: '#ff0000' }, pageBackground: '#FBF8F1' },
  });
  assert.equal(parsed.success, true);
  assert.equal(parsed.success && parsed.data.design?.pageBackground, '#FBF8F1');

  // 可选:不带 pageBackground 依然合法(旧数据/未选书页底色)。
  const withoutBg = V3StoryDraft.safeParse({
    version: 'v3-story',
    tree: { chapters: [] },
    progress: { currentChapterId: null, doneChapterIds: [] },
    design: { fonts: {}, colors: {} },
  });
  assert.equal(withoutBg.success, true);
  assert.equal(withoutBg.success && withoutBg.data.design?.pageBackground, undefined);
});

test('V3StoryDraft.design.coverColorway: 第三套配色 id 往返保留,老草稿不带也照旧', () => {
  const parsed = V3StoryDraft.safeParse({
    version: 'v3-story',
    tree: { chapters: [] },
    progress: { currentChapterId: null, doneChapterIds: [] },
    design: { fonts: {}, colors: {}, pageBackground: '#F1F2F0', coverColorway: 'teal' },
  });
  assert.equal(parsed.success, true);
  // 丢了它,加照片那条路就只能从页面 carrier 反推配色 —— 反推到的是封面的浅字色,
  // 刷到重烘出来的白底新页上,实测 1.09:1。
  assert.equal(parsed.success && parsed.data.design?.coverColorway, 'teal');

  const legacy = V3StoryDraft.safeParse({
    version: 'v3-story',
    tree: { chapters: [] },
    progress: { currentChapterId: null, doneChapterIds: [] },
    design: { fonts: {}, colors: {}, pageBackground: '#FBF8F1' },
  });
  assert.equal(legacy.success, true);
  assert.equal(legacy.success && legacy.data.design?.coverColorway, undefined);
  assert.equal(legacy.success && legacy.data.design?.pageBackground, '#FBF8F1');
});

test('Page.html:可选、64KB 上限(C 方案页面真相字段)', async () => {
  const { Page } = await import('./layout');
  const base = { pageIndex: 0, templateId: 'mag-01', images: {}, texts: {} };
  assert.equal(Page.parse(base).html, undefined);
  assert.equal(Page.parse({ ...base, html: '<div data-template="mag-01"></div>' }).html?.startsWith('<div'), true);
  assert.throws(() => Page.parse({ ...base, html: 'x'.repeat(65537) }));
});
