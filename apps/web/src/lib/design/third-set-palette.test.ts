import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  THIRD_SET_COVERS,
  THIRD_SET_INTERIOR,
  coverColorwayById,
  THIRD_SET_COVER_TEMPLATE_ID,
} from './third-set-palette';

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

test('封面 4 个配色,深墨绿+粉字是第一个', () => {
  assert.equal(THIRD_SET_COVERS.length, 4);
  assert.equal(THIRD_SET_COVERS[0]!.bg, '#12363A');
  assert.equal(THIRD_SET_COVERS[0]!.title, '#F0A4C2');
  assert.equal(THIRD_SET_COVER_TEMPLATE_ID, 'mag-62');
});

test('封面每个配色的标题对比度 >= 4.5:1(大字号也不将就)', () => {
  for (const c of THIRD_SET_COVERS) {
    assert.ok(contrast(c.title, c.bg) >= 4.5, `${c.id} 标题对比度不足`);
    assert.ok(contrast(c.sub, c.bg) >= 4.5, `${c.id} 副标对比度不足`);
  }
});

test('内页 3 组深底配色,正文与亮字对比度都达标', () => {
  assert.equal(THIRD_SET_INTERIOR.length, 3);
  for (const c of THIRD_SET_INTERIOR) {
    assert.ok(contrast(c.body, c.bg) >= 4.5, `${c.id} 正文对比度不足`);
    assert.ok(contrast(c.accent, c.bg) >= 4.5, `${c.id} 标题对比度不足`);
  }
});

test('coverColorwayById: 认识的返回,不认识的 undefined', () => {
  assert.equal(coverColorwayById('teal')?.bg, '#12363A');
  assert.equal(coverColorwayById('nope'), undefined);
});
