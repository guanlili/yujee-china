import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assembleDesignedPages,
  buildCoverSets,
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

test('pickHeroPhotos: 构图 focal > closeup > 其余', () => {
  assert.deepEqual(pickHeroPhotos(CHAPTERS, 2), ['pf', 'pc']);
});

test('buildCoverSets: 2 模板 × 2 hero = 4 组,封尾配另一张 hero,同 albumId 可复现', () => {
  const sets = buildCoverSets('album-1', CHAPTERS);
  assert.equal(sets.length, 4);
  for (const set of sets) {
    assert.equal(templateCategory(set.coverTemplateId), 'cover');
    assert.equal(templateCategory(set.endingTemplateId), 'ending');
    assert.notEqual(set.endingPhotoId, set.coverPhotoId); // 两张 hero 时封尾用另一张
  }
  assert.deepEqual(buildCoverSets('album-1', CHAPTERS), sets); // 确定性
  // 不同 albumId 轮换出不同模板组合(至少 id 序不同)。
  const other = buildCoverSets('album-2', CHAPTERS);
  assert.notDeepEqual(other.map((s) => s.coverTemplateId), sets.map((s) => s.coverTemplateId));
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
