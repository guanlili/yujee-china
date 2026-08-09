import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assembleDesignedPages,
  buildCoverSets,
  coverTextBase,
  pickHeroPhotos,
  sweepCarriers,
  templateCategory,
} from './design-apply';

const CHAPTERS = [
  { photos: [{ photoId: 'pw', composition: 'wide' }, { photoId: 'pf', composition: 'focal' }] },
  { photos: [{ photoId: 'pc', composition: 'closeup' }] },
];

const FONTS = { title: 'zcool-xiaowei', body: 'lxgw-wenkai', decoration: 'smiley-sans' };
const COLORS = { title: '#2b4a6f', body: '#1c1b18', explain: '#6b675f' };

test('coverTextBase: 只给 title 槽留 sample 兜底,其余槽宁可空着', () => {
  const base = coverTextBase('mag-23');
  assert.equal(base.title, 'NORWAY');
  assert.equal(base.body, undefined);   // sample 是 "2026\n2025\n2024",别人的年份
  assert.equal(base.body2, undefined);  // sample 是 "Shanghai \nBeijing\nDali"
});

test('pickHeroPhotos: 构图 focal > closeup > 其余', () => {
  assert.deepEqual(pickHeroPhotos(CHAPTERS, 2), ['pf', 'pc']);
});

test('buildCoverSets: 4 个不同样式封面(按样式变不按照片变,同一 cover 照片),同 albumId 可复现', () => {
  const sets = buildCoverSets('album-1', CHAPTERS);
  assert.equal(sets.length, 4);
  // 4 个封面模板样式各不相同 —— 推荐按样式变。
  assert.equal(new Set(sets.map((s) => s.coverTemplateId)).size, sets.length);
  // 封面照片统一用同一张 hero(可重复;不管图片,用户不满意自己换)。
  assert.equal(new Set(sets.map((s) => s.coverPhotoId)).size, 1);
  for (const set of sets) {
    assert.equal(templateCategory(set.coverTemplateId), 'cover');
    assert.equal(templateCategory(set.endingTemplateId), 'ending');
    assert.notEqual(set.endingPhotoId, set.coverPhotoId); // 两张 hero 时封尾用另一张
  }
  assert.deepEqual(buildCoverSets('album-1', CHAPTERS), sets); // 确定性
  // 不同 albumId 轮换出不同展示顺序。
  const other = buildCoverSets('album-2', CHAPTERS);
  assert.notDeepEqual(other.map((s) => s.coverTemplateId), sets.map((s) => s.coverTemplateId));
});

test('buildCoverSets: 每套绑定一个书页底色,4 套 × 4 色一一对应', async () => {
  const { PAGE_BACKGROUNDS } = await import('@/lib/design/page-backgrounds');
  const sets = buildCoverSets('album-1', CHAPTERS);
  assert.equal(sets.length, 4);
  // 每套按 PAGE_BACKGROUNDS 顺序绑一个底色(第 1 套纯白、第 2 套象牙白…)。
  sets.forEach((s, i) => assert.equal(s.pageBackground, PAGE_BACKGROUNDS[i]!.hex));
  // 4 套底色互不相同(一一对应,不重复)。
  assert.equal(new Set(sets.map((s) => s.pageBackground)).size, sets.length);
});

test('sweepCarriers: 按 role 写 #artFont/#accentColor,decoration 色跟标题色', () => {
  const pages = sweepCarriers(
    [{ pageIndex: 0, templateId: 'mag-15', images: { main: 'p1' }, texts: { title: 'T' } }],
    FONTS,
    COLORS,
  );
  const texts = pages[0].texts;
  assert.equal(texts['title#artFont'], 'zcool-xiaowei');
  assert.equal(texts['title#accentColor'], '#2b4a6f');
  assert.equal(texts['title'], 'T'); // 原文案不动
  // mag-15 若有 body/explain/decoration 槽则同样被刷(存在才断言)。
  for (const [key, value] of Object.entries(texts)) {
    if (key.endsWith('#artFont')) assert.ok(['zcool-xiaowei', 'lxgw-wenkai', 'smiley-sans'].includes(value));
  }
});

test('assembleDesignedPages: 页序 [封面,...内页,封尾] 且 pageIndex 重排、carrier 已刷', () => {
  const sets = buildCoverSets('album-1', CHAPTERS);
  const set = sets[0];
  const pages = assembleDesignedPages({
    interiorPages: [
      { pageIndex: 0, templateId: 'mag-15', images: { main: 'pw' }, texts: {} },
      { pageIndex: 1, templateId: 'mag-34', images: { i1: 'pc' }, texts: {} },
    ],
    set,
    coverTexts: { title: '海边的夏天' },
    endingTexts: {},
    fonts: FONTS,
    colors: COLORS,
  });
  assert.equal(pages.length, 4);
  assert.deepEqual(pages.map((p) => p.pageIndex), [0, 1, 2, 3]);
  assert.equal(templateCategory(pages[0].templateId), 'cover');
  assert.equal(templateCategory(pages[3].templateId), 'ending');
  assert.equal(pages[0].texts['title'], '海边的夏天');
  assert.equal(Object.values(pages[0].images)[0], set.coverPhotoId);
  assert.equal(Object.values(pages[3].images)[0], set.endingPhotoId);
});

// ── 书页底色(2026-07 设计环节叠加) ──

// 页根开标签 = html 里第一个带 data-template 的元素(与 patchHtmlPageStyle 同锚点)。
const rootTag = (html?: string) =>
  /<[a-z0-9]+\b[^>]*\bdata-template="[^"]*"[^>]*>/i.exec(html ?? '')?.[0] ?? '';

test('assembleDesignedPages: 书页底色(非纯白)刷进每页页根 background-color', () => {
  const set = buildCoverSets('album-1', CHAPTERS)[0];
  const pages = assembleDesignedPages({
    interiorPages: [
      { pageIndex: 0, templateId: 'mag-15', images: { main: 'pw' }, texts: {} },
      { pageIndex: 1, templateId: 'mag-34', images: { i1: 'pc' }, texts: {} },
    ],
    set,
    coverTexts: {},
    endingTexts: {},
    fonts: FONTS,
    colors: COLORS,
    pageBackground: '#FBF8F1',
  });
  assert.equal(pages.length, 4); // 封面+2内页+封尾:全书每页都刷
  for (const p of pages) {
    assert.match(rootTag(p.html), /background-color:#FBF8F1/i, `页 ${p.pageIndex} 页根应有底色`);
  }
});

test('assembleDesignedPages: 纯白/未传底色 → 页根不写 inline background-color(留模板默认)', () => {
  const set = buildCoverSets('album-1', CHAPTERS)[0];
  const base = {
    interiorPages: [{ pageIndex: 0, templateId: 'mag-15', images: { main: 'pw' }, texts: {} }],
    set,
    coverTexts: {},
    endingTexts: {},
    fonts: FONTS,
    colors: COLORS,
  };
  const white = assembleDesignedPages({ ...base, pageBackground: '#FFFFFF' });
  const none = assembleDesignedPages(base);
  for (const p of [...white, ...none]) {
    assert.doesNotMatch(rootTag(p.html), /background-color/i, '纯白/未传不该写 inline 背景');
  }
});

// ── 封尾模板与多图槽(2026-07 封面封尾调整) ──

test('pickEndingTemplateId: 优先带文字槽的封底,engine 封尾文案有槽可落', async () => {
  const { pickEndingTemplateId } = await import('./design-apply');
  const { TEMPLATES } = await import('@yujee/contracts');
  for (const albumId of ['album-a', 'album-b', 'album-c', 'x']) {
    const id = pickEndingTemplateId(albumId)!;
    const t = (TEMPLATES as Record<string, { category?: string; texts?: unknown[] }>)[id];
    assert.equal(t.category, 'ending');
    assert.ok((t.texts ?? []).length > 0, `${id} 应有文字槽(纯图 mag-20 不该被选)`);
  }
});

test('assembleDesignedPages: 封底多图槽全部填上,第 1 槽是 endingPhotoId', async () => {
  const { assembleDesignedPages, pickEndingTemplateId } = await import('./design-apply');
  const { TEMPLATES } = await import('@yujee/contracts');
  const endingId = pickEndingTemplateId('album-a')!;
  const endingSlots = ((TEMPLATES as Record<string, { images?: { id: string }[] }>)[endingId].images ?? []).map((s) => s.id);
  const pages = assembleDesignedPages({
    interiorPages: [{ pageIndex: 0, templateId: 'mag-02', images: {}, texts: {} }],
    set: { coverTemplateId: 'mag-32', coverPhotoId: 'hero-1', endingTemplateId: endingId, endingPhotoId: 'hero-2' },
    coverTexts: {},
    endingTexts: {},
    fonts: { title: 'Fraunces', body: 'Inter', decoration: 'Caveat' },
    colors: { title: '#111', body: '#222', explain: '#333' },
    extraEndingPhotoIds: ['hero-3', 'hero-4'],
  });
  const ending = pages[pages.length - 1];
  assert.equal(ending.templateId, endingId);
  assert.equal(Object.keys(ending.images).length, endingSlots.length, '图槽一个不落');
  assert.equal(ending.images[endingSlots[0]], 'hero-2');
  if (endingSlots.length > 1) {
    assert.equal(ending.images[endingSlots[1]], 'hero-3'); // 补充照片按序进后续槽
  }
});

test('assembleDesignedPages: 无补充照片时后续图槽复用 endingPhotoId 不留空', async () => {
  const { assembleDesignedPages, pickEndingTemplateId } = await import('./design-apply');
  const { TEMPLATES } = await import('@yujee/contracts');
  const endingId = pickEndingTemplateId('album-a')!;
  const endingSlots = ((TEMPLATES as Record<string, { images?: { id: string }[] }>)[endingId].images ?? []).map((s) => s.id);
  const pages = assembleDesignedPages({
    interiorPages: [{ pageIndex: 0, templateId: 'mag-02', images: {}, texts: {} }],
    set: { coverTemplateId: 'mag-32', coverPhotoId: 'hero-1', endingTemplateId: endingId, endingPhotoId: 'hero-2' },
    coverTexts: {},
    endingTexts: {},
    fonts: { title: 'Fraunces', body: 'Inter', decoration: 'Caveat' },
    colors: { title: '#111', body: '#222', explain: '#333' },
  });
  const ending = pages[pages.length - 1];
  for (const slotId of endingSlots) {
    assert.equal(ending.images[slotId], 'hero-2');
  }
});
