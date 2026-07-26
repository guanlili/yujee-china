import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
  clamp01,
  hexToRgb,
  hsvToHex,
  hsvToRgb,
  parseColor,
  rgbToHex,
  rgbToHsv,
  toCssColor,
} from './color-util';

/* 取色器的颜色换算。桌面与移动共用这一份 —— 算错是「颜色对不上」这类最难查的 bug,
   所以往返一致性(hex → HSV → hex)必须钉住。 */

const here = dirname(fileURLToPath(import.meta.url));

test('抽出来之后桌面不再留第二份副本(两边漂移就会颜色对不上)', () => {
  const port = readFileSync(join(here, 'EditorPort.tsx'), 'utf8');
  assert.match(port, /from '\.\/color-util'/, 'EditorPort 必须从共享层取');
  assert.doesNotMatch(port, /^function hsvToRgb\(/m, '不许再留本地副本');
  assert.doesNotMatch(port, /^function rgbToHsv\(/m);
  assert.doesNotMatch(port, /^function hexToRgb\(/m);
});

test('hex → HSV → hex 往返不变(取色器每拖一下都在走这条)', () => {
  for (const hex of ['#000000', '#ffffff', '#13b8a6', '#8c5ef4', '#daf45e', '#c44444', '#1c1b18']) {
    const rgb = hexToRgb(hex)!;
    const { h, s, v } = rgbToHsv(rgb.r, rgb.g, rgb.b);
    assert.equal(hsvToHex(h, s, v), hex, `${hex} 往返后变了`);
  }
});

test('六个色相角出的是纯色(边界最容易写错)', () => {
  assert.equal(hsvToHex(0, 1, 1), '#ff0000');
  assert.equal(hsvToHex(60, 1, 1), '#ffff00');
  assert.equal(hsvToHex(120, 1, 1), '#00ff00');
  assert.equal(hsvToHex(180, 1, 1), '#00ffff');
  assert.equal(hsvToHex(240, 1, 1), '#0000ff');
  assert.equal(hsvToHex(300, 1, 1), '#ff00ff');
  assert.equal(hsvToHex(360, 1, 1), '#ff0000', '360° 要绕回 0°');
});

test('色相为负/超过 360 也要绕回来,不产生黑块', () => {
  assert.equal(hsvToHex(-60, 1, 1), '#ff00ff');
  assert.equal(hsvToHex(420, 1, 1), '#ffff00');
});

test('hexToRgb:认 # 与不带 #;非法串返回 null(不猜)', () => {
  assert.deepEqual(hexToRgb('#13B8A6'), { r: 19, g: 184, b: 166 });
  assert.deepEqual(hexToRgb('13b8a6'), { r: 19, g: 184, b: 166 });
  assert.equal(hexToRgb('#abc'), null, '三位简写不认(避免和六位混淆出错色)');
  assert.equal(hexToRgb('nope'), null);
  assert.equal(hexToRgb(''), null);
});

test('parseColor:hex / rgb() / rgba() 都要认,认不出返回 null', () => {
  assert.equal(parseColor('#ff0000')?.alpha, 1);
  assert.equal(hsvToHex(...(Object.values(parseColor('#ff0000')!.hsv) as [number, number, number])), '#ff0000');
  const rgba = parseColor('rgba(255, 0, 0, 0.5)')!;
  assert.equal(rgba.alpha, 0.5);
  assert.equal(parseColor('rgb(0, 0, 255)')?.alpha, 1);
  assert.equal(parseColor('linear-gradient(...)'), null);
  assert.equal(parseColor(null), null);
  assert.equal(parseColor(undefined), null);
});

test('toCssColor:不透明给 hex(存库更短更稳),半透明才给 rgba', () => {
  const red = rgbToHsv(255, 0, 0);
  assert.equal(toCssColor(red, 1), '#ff0000');
  assert.equal(toCssColor(red, 0.5), 'rgba(255, 0, 0, 0.5)');
  // 存库 html 的 style 属性禁 `;{}<>"`,rgba 里只有逗号括号,是安全的
  assert.doesNotMatch(toCssColor(red, 0.5), /[;{}<>"]/);
});

test('clamp01 夹在 0..1(轨道拖出边界不能出非法值)', () => {
  assert.equal(clamp01(-5), 0);
  assert.equal(clamp01(5), 1);
  assert.equal(clamp01(0.3), 0.3);
});

test('rgbToHex 四舍五入且补零(#0a 不能写成 #a)', () => {
  assert.equal(rgbToHex(10, 10, 10), '#0a0a0a');
  assert.equal(rgbToHex(0, 0, 0), '#000000');
  assert.equal(rgbToHex(254.6, 0, 0), '#ff0000');
});

test('灰阶(s=0)不该带出色相偏差', () => {
  for (const v of [0, 0.25, 0.5, 0.75, 1]) {
    const hex = hsvToHex(210, 0, v);
    const rgb = hsvToRgb(210, 0, v);
    assert.equal(rgb.r, rgb.g, `${hex} 不是中性灰`);
    assert.equal(rgb.g, rgb.b, `${hex} 不是中性灰`);
  }
});
