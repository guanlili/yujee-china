import assert from 'node:assert/strict';
import { test } from 'node:test';
import { coverPreviewBackground, coverRecapFromPages } from './cover-recap';
import { THIRD_SET_COVERS } from '@/lib/design/third-set-palette';

// 对比度(与 third-set-palette.test.ts 同一套算法):这里要证明的不是「值等于某个
// 常量」,而是「用错底色的话封面预览真的看不见」。
const lin = (c: number) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
function luminance(hex: string): number {
  const h = hex.replace('#', '');
  return (
    0.2126 * lin(parseInt(h.slice(0, 2), 16)) +
    0.7152 * lin(parseInt(h.slice(2, 4), 16)) +
    0.0722 * lin(parseInt(h.slice(4, 6), 16))
  );
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

// ── coverPreviewBackground(评审 F3) ────────────────────────────────────────

test('第三套:预览底色用 colorway 自己的底色,不是那套的书页底色', () => {
  const teal = THIRD_SET_COVERS.find((c) => c.id === 'teal')!;
  const bg = coverPreviewBackground({ pageBackground: '#F1F2F0', coverColorway: 'teal' });
  assert.equal(bg, teal.bg);
});

test('第三套用书页底色渲染 = 粉标题和米白小字双双看不见(这条修的就是它)', () => {
  const teal = THIRD_SET_COVERS.find((c) => c.id === 'teal')!;
  // 错的那条路:近白的 #F1F2F0 盖在 mag-62 深页根上。
  assert.ok(contrast(teal.title, '#F1F2F0') < 2, '粉标题压在近白上不足 2:1');
  assert.ok(contrast(teal.sub, '#F1F2F0') < 1.2, '米白小字压在近白上几乎为 1:1');
  // 修好之后:同样两个字色压在换算出来的底色上都达标。
  const bg = coverPreviewBackground({ pageBackground: '#F1F2F0', coverColorway: teal.id })!;
  assert.ok(contrast(teal.title, bg) >= 4.5);
  assert.ok(contrast(teal.sub, bg) >= 4.5);
});

test('其余三套(没有 colorway)照旧用书页底色,认不出的 id 也一样', () => {
  assert.equal(coverPreviewBackground({ pageBackground: '#FBF8F1' }), '#FBF8F1');
  assert.equal(
    coverPreviewBackground({ pageBackground: '#FBF8F1', coverColorway: 'not-a-colorway' }),
    '#FBF8F1',
  );
  assert.equal(coverPreviewBackground({}), undefined);
});

// ── coverRecapFromPages(评审 F2) ──────────────────────────────────────────

const coverPage = {
  templateId: 'mag-01',
  imagesJson: { image: 'photo-1' },
  textsJson: { title: '我们走过的那一年', explain: 'AI 写的副标题' },
  htmlJson: '<div data-template="mag-01" style="width:794px;background-color:#12363A;color:#E7E3D8">x</div>',
  kind: 'cover',
};
const endingPage = {
  templateId: 'mag-22',
  imagesJson: { image1: 'photo-2', image2: 'photo-3' },
  textsJson: { title: '365 天' },
  htmlJson: '<div data-template="mag-22" style="width:794px;background-color:#12363A">x</div>',
  kind: 'ending',
};
const interiorPage = {
  templateId: 'mag-08',
  imagesJson: {},
  textsJson: { note: '内页' },
  kind: 'interior',
};

test('从真页面组回执数据:文案取 textsJson,底色取页根 background-color', () => {
  const data = coverRecapFromPages([coverPage, interiorPage, endingPage])!;
  assert.equal(data.coverTemplateId, 'mag-01');
  assert.equal(data.coverPhotoId, 'photo-1');
  assert.equal(data.endingTemplateId, 'mag-22');
  assert.equal(data.endingPhotoId, 'photo-2');
  // 这两条是 F2 的核心:回执卡拿到的是 AI 写的真文案,不是模板 sample。
  assert.deepEqual(data.coverTexts, coverPage.textsJson);
  assert.deepEqual(data.endingTexts, endingPage.textsJson);
  assert.equal(data.pageBackground, '#12363A');
});

test('只有封面(老书没封底)也出卡;一页都没有则 null', () => {
  const onlyCover = coverRecapFromPages([coverPage])!;
  assert.equal(onlyCover.endingTemplateId, null);
  assert.equal(onlyCover.endingPhotoId, null);
  assert.equal(coverRecapFromPages([interiorPage]), null);
  assert.equal(coverRecapFromPages([]), null);
  assert.equal(coverRecapFromPages(null), null);
});

test('封面页没烘底色时退到封底页读;都没有则不写底色(留模板默认)', () => {
  const coverNoBg = { ...coverPage, htmlJson: '<div data-template="mag-01" style="width:794px">x</div>' };
  assert.equal(coverRecapFromPages([coverNoBg, endingPage])!.pageBackground, '#12363A');
  const endingNoBg = { ...endingPage, htmlJson: undefined };
  assert.equal(coverRecapFromPages([coverNoBg, endingNoBg])!.pageBackground, undefined);
});
