import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  gridCellRect,
  gridScrollFrames,
  gridScrollY,
  gridSpec,
  gridTailFrames,
} from './live-grid-motion';

// Live 视频翻完全书后接的「全部页面一览」:三列缩略图从顶滚到底。
// 这里锁排布的自洽(格子铺得满、不越界)与滚动的两个端点(起于 0、正好停在底)。

const OUT_W = 1080;
const OUT_H = 1440;
const RATIO = (794 * 2) / 1123; // 跨页 宽/高
const FPS = 30;

test('格子横向恰好铺满画幅:列宽×列数 + 列间距 + 左右留白 = 画幅宽', () => {
  const s = gridSpec(42, OUT_W, OUT_H, RATIO);
  const used = s.cols * s.cellW + (s.cols - 1) * s.gap + s.pad * 2;
  assert.ok(Math.abs(used - OUT_W) < 1e-6, `横向没铺满: ${used} vs ${OUT_W}`);
  assert.ok(Math.abs(s.cellH - s.cellW / RATIO) < 1e-6, '格子必须是跨页比例');
});

test('行数与总高按格数推,最后一格的底边正好落在内容底', () => {
  const s = gridSpec(42, OUT_W, OUT_H, RATIO);
  assert.equal(s.rows, Math.ceil(42 / s.cols));
  const want = s.pad * 2 + s.rows * s.cellH + (s.rows - 1) * s.gap;
  assert.ok(Math.abs(s.contentH - want) < 1e-6);
  const last = gridCellRect(41, s);
  assert.ok(
    Math.abs(last.y + last.h - (s.offsetY + s.contentH - s.pad)) < 1e-6,
    '最后一格没贴到内容底',
  );
});

test('格子按行优先落位,不重叠不越界', () => {
  const s = gridSpec(42, OUT_W, OUT_H, RATIO);
  const first = gridCellRect(0, s);
  assert.ok(Math.abs(first.x - s.pad) < 1e-6 && Math.abs(first.y - s.pad) < 1e-6);
  const secondRow = gridCellRect(s.cols, s);
  assert.ok(Math.abs(secondRow.x - s.pad) < 1e-6, '换行必须回到最左');
  assert.ok(Math.abs(secondRow.y - (s.offsetY + s.pad + s.cellH + s.gap)) < 1e-6);
  for (let i = 0; i < 42; i++) {
    const r = gridCellRect(i, s);
    assert.ok(r.x >= s.pad - 1e-6 && r.x + r.w <= OUT_W - s.pad + 1e-6, `第 ${i} 格横向越界`);
  }
});

test('短书铺不满一屏时滚动距离为 0(不许出现负滚动/往回滚)', () => {
  const s = gridSpec(4, OUT_W, OUT_H, RATIO);
  assert.ok(s.contentH < OUT_H, '这个夹具本就该一屏放得下');
  assert.equal(s.scroll, 0);
  assert.equal(gridScrollY(0, gridScrollFrames(s.scroll, FPS), s.scroll), 0);
  assert.equal(gridScrollY(5, gridScrollFrames(s.scroll, FPS), s.scroll), 0);
});

test('短书的网格纵向居中,不许顶在画幅上沿把下半屏空掉', () => {
  // 真片取证发现的:7 屏的书铺 3 行、内容高 798,顶对齐时画幅下半截全是空背景,
  // 看着像渲染坏了。一屏放得下就居中。
  const s = gridSpec(7, OUT_W, OUT_H, RATIO);
  assert.ok(s.contentH < OUT_H);
  assert.ok(Math.abs(s.offsetY - (OUT_H - s.contentH) / 2) < 1e-6, '没有居中');
  const first = gridCellRect(0, s);
  const last = gridCellRect(6, s);
  const topGap = first.y;
  const bottomGap = OUT_H - (last.y + last.h);
  assert.ok(Math.abs(topGap - bottomGap) < 1e-6, `上下留白不等:${topGap} vs ${bottomGap}`);
});

test('长书要滚,就不居中(否则滚动起点会错位)', () => {
  const s = gridSpec(42, OUT_W, OUT_H, RATIO);
  assert.ok(s.scroll > 0);
  assert.equal(s.offsetY, 0);
  assert.ok(Math.abs(gridCellRect(0, s).y - s.pad) < 1e-6, '长书首格仍贴上留白');
});

test('长书滚动距离 = 内容高 - 画幅高', () => {
  const s = gridSpec(42, OUT_W, OUT_H, RATIO);
  assert.ok(s.contentH > OUT_H);
  assert.ok(Math.abs(s.scroll - (s.contentH - OUT_H)) < 1e-6);
});

test('滚动起于 0、正好停在底,中途单调不回头', () => {
  const s = gridSpec(42, OUT_W, OUT_H, RATIO);
  const frames = gridScrollFrames(s.scroll, FPS);
  assert.ok(frames > 1);
  assert.equal(gridScrollY(0, frames, s.scroll), 0, '第一帧必须在顶');
  assert.ok(
    Math.abs(gridScrollY(frames - 1, frames, s.scroll) - s.scroll) < 1e-9,
    '最后一帧必须正好停在底(滚过头会露出画幅外的空白)',
  );
  let prev = -1;
  for (let f = 0; f < frames; f++) {
    const y = gridScrollY(f, frames, s.scroll);
    assert.ok(y >= prev - 1e-9, `第 ${f} 帧往回滚了`);
    assert.ok(y <= s.scroll + 1e-9, `第 ${f} 帧滚过了底`);
    prev = y;
  }
});

test('滚动首尾有缓动:开头与结尾比匀速慢,中段比匀速快', () => {
  const s = gridSpec(42, OUT_W, OUT_H, RATIO);
  const frames = gridScrollFrames(s.scroll, FPS);
  const at = (f: number) => gridScrollY(f, frames, s.scroll) / s.scroll;
  const q = Math.floor((frames - 1) * 0.08);
  assert.ok(at(q) < 0.08, '开头没有缓入');
  assert.ok(at(frames - 1 - q) > 0.92, '结尾没有缓出');
  assert.ok(Math.abs(at(Math.floor((frames - 1) / 2)) - 0.5) < 0.06, '中段应大致过半');
});

test('滚动时长有下限、随距离增长,但不至于长到没边', () => {
  const short = gridScrollFrames(120, FPS);
  const long = gridScrollFrames(4000, FPS);
  assert.ok(short >= FPS * 3, '再短也要滚够 3 秒,不然看不清');
  assert.ok(long > short, '滚得远就该滚得久');
  assert.ok(long <= FPS * 20, '再长也不该超过 20 秒');
});

test('不用滚的书只凝视一下,不许拿滚动下限去空转', () => {
  // 复用 MIN_SCROLL_SEC 的话,短书会得到 3 秒纹丝不动的「滚动」,加上定格
  // 就是 4 秒多静止画面 —— 十几秒的片子最后三分之一冻住。
  const still = gridScrollFrames(0, FPS);
  assert.ok(still < FPS * 3, `不用滚却排了 ${(still / FPS).toFixed(1)} 秒`);
  assert.ok(still >= FPS, '也不能一闪而过,至少留 1 秒看清');
});

test('结尾帧账闭合:三段之和 === total(进度条不许走过 100% 还在渲)', () => {
  for (const scroll of [0, 120, 608, 4000]) {
    const t = gridTailFrames(scroll, FPS);
    assert.equal(t.total, t.fade + t.scroll + t.hold, `scroll=${scroll} 时帧账没闭合`);
    assert.equal(t.scroll, gridScrollFrames(scroll, FPS), '滚动段必须与 gridScrollFrames 同源');
    assert.ok(t.fade >= 1 && t.hold >= 1);
  }
});

test('短书的结尾段总长明显短于长书(短书不该陪着空转)', () => {
  const shortBook = gridTailFrames(gridSpec(7, OUT_W, OUT_H, RATIO).scroll, FPS);
  const longBook = gridTailFrames(gridSpec(42, OUT_W, OUT_H, RATIO).scroll, FPS);
  assert.ok(shortBook.total < longBook.total);
  assert.ok(shortBook.total <= FPS * 3, `短书结尾拖了 ${(shortBook.total / FPS).toFixed(1)} 秒`);
});
