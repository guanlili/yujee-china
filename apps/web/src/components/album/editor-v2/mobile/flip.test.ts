import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
  FLIP_EASE,
  FLIP_MS,
  canFlip,
  leafGeometry,
  leafLayers,
  leafShading,
} from './flip';

const here = dirname(fileURLToPath(import.meta.url));

/* 翻纸动效的纯函数层。效果源头是 FlipBook.tsx 的 3D page-turn ——
   这里守住「时长/缓动照搬」「哪张纸、往哪转、三层画谁」不出错。 */

test('时长与缓动照搬 FlipBook,不自己定', () => {
  const src = readFileSync(join(here, '..', '..', 'FlipBook.tsx'), 'utf8');
  const ms = /const FLIP_MS = (\d+)/.exec(src);
  assert.ok(ms, '找不到 FlipBook 的 FLIP_MS');
  assert.equal(FLIP_MS, Number(ms[1]), `时长要跟 FlipBook 一致(它是 ${ms![1]}ms)`);
  assert.ok(src.includes(FLIP_EASE), `缓动曲线 ${FLIP_EASE} 要跟 FlipBook 一致`);
});

// ── 什么时候能翻、什么时候只能硬切 ──────────────────────────────────────────

test('对开↔对开 / 单页↔单页 可以翻纸', () => {
  assert.equal(canFlip({ rows: 1, halves: 2 }, { rows: 1, halves: 2 }, false), true);
  assert.equal(canFlip({ rows: 1, halves: 1 }, { rows: 1, halves: 1 }, false), true);
});

test('几何一变就只能硬切(独页↔对开:纸片宽度会变,跨宽度会撕裂)', () => {
  assert.equal(canFlip({ rows: 1, halves: 1 }, { rows: 1, halves: 2 }, false), false);
  assert.equal(canFlip({ rows: 1, halves: 2 }, { rows: 1, halves: 1 }, false), false);
});

test('一屏多个开页(密度 4)没有单一的「那张纸」→ 硬切', () => {
  assert.equal(canFlip({ rows: 2, halves: 2 }, { rows: 2, halves: 2 }, false), false);
  assert.equal(canFlip({ rows: 1, halves: 2 }, { rows: 2, halves: 2 }, false), false);
});

test('用户要求减弱动效 → 一律硬切(无障碍,同 FlipBook)', () => {
  assert.equal(canFlip({ rows: 1, halves: 2 }, { rows: 1, halves: 2 }, true), false);
  assert.equal(canFlip({ rows: 1, halves: 1 }, { rows: 1, halves: 1 }, true), false);
});

// ── 纸片几何 ────────────────────────────────────────────────────────────────

test('对开翻下一页:右半页绕书脊往左扫', () => {
  const g = leafGeometry('next', 2);
  assert.equal(g.leftFrac, 0.5, '纸片从书脊(中线)起');
  assert.equal(g.widthFrac, 0.5, '半宽');
  assert.equal(g.origin, 'left center', '绕书脊那条边转');
  assert.equal(g.endAngle, -180);
});

test('对开翻上一页:左半页绕书脊往右扫(镜像)', () => {
  const g = leafGeometry('prev', 2);
  assert.equal(g.leftFrac, 0);
  assert.equal(g.widthFrac, 0.5);
  assert.equal(g.origin, 'right center');
  assert.equal(g.endAngle, 180);
});

test('单页:整页就是那张纸,两向都是整宽', () => {
  for (const dir of ['next', 'prev'] as const) {
    const g = leafGeometry(dir, 1);
    assert.equal(g.leftFrac, 0);
    assert.equal(g.widthFrac, 1);
  }
  assert.equal(leafGeometry('next', 1).origin, 'left center');
  assert.equal(leafGeometry('prev', 1).origin, 'right center');
});

test('起始角一律 0,终止角只有 ±180(不出现半途停住的角度)', () => {
  for (const halves of [1, 2]) {
    for (const dir of ['next', 'prev'] as const) {
      assert.ok([-180, 180].includes(leafGeometry(dir, halves).endAngle));
    }
  }
});

// ── 三层画谁 ────────────────────────────────────────────────────────────────

test('对开翻下一页:原左页不动、目标右页垫底、原右页翻走、目标左页翻进来', () => {
  const l = leafLayers('next', 2, [4, 5], [6, 7]);
  assert.deepEqual(l.under, [4, 7], '底层 = 原左 + 目标右');
  assert.equal(l.front, 5, '正面 = 翻走的原右页');
  assert.equal(l.back, 6, '背面 = 翻进来的目标左页');
});

test('对开翻上一页:镜像', () => {
  const l = leafLayers('prev', 2, [6, 7], [4, 5]);
  assert.deepEqual(l.under, [4, 7], '底层 = 目标左 + 原右');
  assert.equal(l.front, 6, '正面 = 翻走的原左页');
  assert.equal(l.back, 5, '背面 = 翻进来的目标右页');
});

test('单页:正面原页、背面目标页、底层目标页(转过 90° 就露出新页)', () => {
  const l = leafLayers('next', 1, [3], [4]);
  assert.deepEqual(l.under, [4]);
  assert.equal(l.front, 3);
  assert.equal(l.back, 4);
});

test('空半边(封面那侧没有页)不炸,如实给 null', () => {
  const l = leafLayers('next', 2, [null, 1], [2, null]);
  assert.deepEqual(l.under, [null, null]);
  assert.equal(l.front, 1);
  assert.equal(l.back, 2);
});

test('三层加起来不会把同一页同时画在底层和纸片正面(会重影)', () => {
  const l = leafLayers('next', 2, [4, 5], [6, 7]);
  assert.ok(!l.under.includes(l.front), `正面 ${l.front} 不该同时垫在底下`);
});

// ── 受光 ────────────────────────────────────────────────────────────────────

test('翻页受光:靠书脊那侧压暗(值取自 FlipBook)', () => {
  const src = readFileSync(join(here, '..', '..', 'FlipBook.tsx'), 'utf8');
  for (const dir of ['next', 'prev'] as const) {
    const g = leafShading(dir);
    assert.match(g, /^linear-gradient\(90deg,/);
    assert.ok(src.includes(g), `渐变 ${g} 要与 FlipBook 逐字一致`);
  }
  assert.notEqual(leafShading('next'), leafShading('prev'), '两个方向的受光是镜像');
});

// ── 架构守卫 ────────────────────────────────────────────────────────────────

test('架构守卫:flip 是纯函数层,不碰 DOM', () => {
  const src = readFileSync(join(here, 'flip.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(src, /\bdocument\b/);
  assert.doesNotMatch(src, /querySelector/);
  assert.doesNotMatch(src, /\bwindow\./);
});
