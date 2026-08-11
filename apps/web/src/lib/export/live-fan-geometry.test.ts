import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  LIVE_FAN_SHAPE,
  fanCards,
  fanFaceIndex,
  fanOuterEdge,
  type FanParams,
} from './live-fan-geometry';

// 扇形的几何是照「新翻书效果录屏」逐帧量出来的:卡片**不是**绕书脊旋转
// (那样会缩进书里去),而是整摞朝书脊外侧一个消失点等比缩小 —— 第 j 张 =
// 同一个页面矩形以消失点为中心缩放 k_j。这里锁的就是这条规律和它的边界。

const P: FanParams = {
  bookW: 760,
  bookH: 538,
  spineX: 540,
  centerY: 720,
  count: 7,
  vp: 2.6,
  kMin: 0.8,
  gamma: 0.62,
  dark: 0.3,
};

const HW = P.bookW / 2;
const right = (cards: ReturnType<typeof fanCards>) => cards.filter((c) => c.side === 1);
const left = (cards: ReturnType<typeof fanCards>) => cards.filter((c) => c.side === -1);

test('书首左侧无卡、书尾右侧无卡', () => {
  const first = fanCards(0, 22, P);
  assert.equal(left(first).length, 0, '第一屏左边没有翻过的页');
  assert.equal(right(first).length, P.count);

  const last = fanCards(21, 22, P);
  assert.equal(right(last).length, 0, '最后一屏右边没有没翻的页');
  assert.equal(left(last).length, P.count);
});

test('中间位置左右各封顶 count 张,且不引用越界视图', () => {
  const cards = fanCards(11, 22, P);
  assert.equal(right(cards).length, P.count);
  assert.equal(left(cards).length, P.count);
  for (const c of cards) {
    assert.ok(c.view >= 0 && c.view < 22, `视图下标越界: ${c.view}`);
    assert.ok(c.depth > 0 && c.depth <= P.count, `深度越界: ${c.depth}`);
  }
});

test('页数不够时按实际有的页出卡,不补空卡', () => {
  // 只有 4 屏,站在第 1 屏:右边最多 2 张(视图 2、3),左边最多 1 张(视图 0)。
  const cards = fanCards(1, 4, P);
  assert.deepEqual(right(cards).map((c) => c.view).sort(), [2, 3]);
  assert.deepEqual(left(cards).map((c) => c.view), [0]);
});

test('count=0 就没有扇形(等于关掉这个效果)', () => {
  assert.deepEqual(fanCards(11, 22, { ...P, count: 0 }), []);
});

test('越深的卡:缩得越小、越矮、越暗、外缘越往外', () => {
  const cards = right(fanCards(11, 22, P)).sort((a, b) => a.depth - b.depth);
  for (let i = 1; i < cards.length; i++) {
    const prev = cards[i - 1]!;
    const cur = cards[i]!;
    assert.ok(cur.k < prev.k, `第 ${i} 张没有更小`);
    assert.ok(cur.h < prev.h, `第 ${i} 张没有更矮`);
    assert.ok(cur.dark > prev.dark, `第 ${i} 张没有更暗`);
    assert.ok(cur.x + cur.w > prev.x + prev.w, `第 ${i} 张外缘没有更外`);
  }
  assert.ok(cards[cards.length - 1]!.dark <= P.dark + 1e-9, '压暗不得超过上限');
});

test('卡是正矩形:宽恒为半页宽×缩放,纵向以书的中线为轴等比缩', () => {
  for (const c of fanCards(11, 22, P)) {
    assert.ok(Math.abs(c.w - HW * c.k) < 1e-6, '宽必须是半页宽等比缩放');
    assert.ok(Math.abs(c.h - P.bookH * c.k) < 1e-6, '高必须是跨页高等比缩放');
    assert.ok(Math.abs(c.y + c.h / 2 - P.centerY) < 1e-6, '纵向必须仍居中');
  }
});

test('左右镜像:同深度两侧对书脊对称', () => {
  const cards = fanCards(11, 22, P);
  const r = right(cards).find((c) => Math.abs(c.depth - 3) < 1e-9)!;
  const l = left(cards).find((c) => Math.abs(c.depth - 3) < 1e-9)!;
  assert.ok(r && l);
  assert.ok(Math.abs(r.x - P.spineX - (P.spineX - (l.x + l.w))) < 1e-6, '内缘不对称');
  assert.ok(Math.abs(r.x + r.w - P.spineX - (P.spineX - l.x)) < 1e-6, '外缘不对称');
});

test('外扩换算锁死录屏实测值:vp=4.25 / kMin=0.75 → 最外缘 1.81×半页宽', () => {
  // 录屏里书脊到最外一张外缘 = 1.81×半页宽。锁的是**换算本身**(证明 vp/kMin 的
  // 含义没被改坏),不是出片值 —— 出片用的是 LIVE_FAN_SHAPE,见下一条。
  const p = { ...P, vp: 4.25, kMin: 0.75 };
  const cards = right(fanCards(11, 22, p));
  const deepest = cards.reduce((a, b) => (a.depth > b.depth ? a : b));
  const outer = (deepest.x + deepest.w - P.spineX) / HW;
  assert.ok(Math.abs(outer - 1.81) < 0.01, `外扩系数 ${outer.toFixed(3)},应为 1.81`);
  // fanOuterEdge 必须与逐张扫出来的最外缘一致(守卫用的就是它)。
  assert.ok(Math.abs(fanOuterEdge(p) - (deepest.x + deepest.w)) < 1e-6);
});

test('fanOuterEdge 的边界:没有扇形时就是书自己的外缘', () => {
  assert.ok(Math.abs(fanOuterEdge({ ...P, count: 0 }) - (P.spineX + HW)) < 1e-6);
});

test('出片参数是唯一一份,且比录屏原值收得更紧(竖版画幅塞不下那么满)', () => {
  assert.deepEqual(Object.keys(LIVE_FAN_SHAPE).sort(), ['count', 'dark', 'gamma', 'kMin', 'vp']);
  const outer = (fanOuterEdge({ ...P, ...LIVE_FAN_SHAPE }) - P.spineX) / HW;
  assert.ok(outer > 1, '出片参数至少要让扇形露出书外');
  assert.ok(outer < 1.81, `出片外扩 ${outer.toFixed(2)}× 不该达到录屏那么满`);
});

test('翻页推进连续:pos 逼近整数时,最浅那张收敛到中心半页,不会跳变', () => {
  // pos = k + t,t 从 0 走到 1 时整摞恰好推进一格。t→1 时视图 k+1 从扇形里
  // 走到正中:它的矩形必须收敛到中心半页,否则翻页落定那一帧会闪。
  //
  // γ<1 是「靠近书的几张更密」的来源(录屏观感),代价是这个收敛不是线性的 ——
  // 所以这里验的是「越靠近误差越小、极限为 0」,不是某个拍脑袋的 ε。拿固定 ε 卡
  // 亚像素,等于变相逼着 γ=1,把效果本身测没了。
  const err = (eps: number) => {
    const shallow = right(fanCards(11 + 1 - eps, 22, P)).sort((a, b) => a.depth - b.depth)[0]!;
    assert.equal(shallow.view, 12, '最浅那张应是即将走到正中的那一屏');
    return Math.max(
      Math.abs(shallow.x - P.spineX),
      Math.abs(shallow.w - HW),
      Math.abs(shallow.k - 1),
    );
  };
  const e1 = err(1e-4);
  const e2 = err(1e-8);
  const e3 = err(1e-14);
  assert.ok(e1 < 1, `深度 1e-4 处已偏离中心半页 ${e1.toFixed(3)}px`);
  assert.ok(e2 < e1 && e3 < e2, '越靠近中心,误差必须越小(收敛)');
  assert.ok(e3 < 1e-3, `极限没收敛到中心半页:${e3}`);
});

test('翻页推进连续:整摞逐格平移,pos 每 +1 卡集合整体挪一位', () => {
  const a = fanCards(11, 22, P);
  const b = fanCards(12, 22, P);
  const shiftR = right(a).map((c) => c.view + 1).sort((x, y) => x - y);
  const gotR = right(b).map((c) => c.view).sort((x, y) => x - y);
  assert.deepEqual(gotR, shiftR, '右侧扇形没有整体推进一格');
  // 同深度的矩形与 pos 无关(只随深度变),所以两次调用逐张对得上。
  const byDepth = (cs: typeof a) => new Map(cs.map((c) => [c.depth.toFixed(6), c] as const));
  const ma = byDepth(right(a));
  for (const c of right(b)) {
    const same = ma.get(c.depth.toFixed(6));
    assert.ok(same, `深度 ${c.depth} 在上一屏没有对应卡`);
    assert.ok(Math.abs(same!.x - c.x) < 1e-6 && Math.abs(same!.h - c.h) < 1e-6, '同深度矩形应一致');
  }
});

test('过渡中途的卡:深度带小数,矩形落在两格之间', () => {
  const mid = right(fanCards(11.5, 22, P)).sort((a, b) => a.depth - b.depth);
  const at0 = right(fanCards(11, 22, P)).sort((a, b) => a.depth - b.depth);
  const at1 = right(fanCards(12, 22, P)).sort((a, b) => a.depth - b.depth);
  const card = mid.find((c) => c.view === 13)!;
  const before = at0.find((c) => c.view === 13)!;
  const after = at1.find((c) => c.view === 13)!;
  assert.ok(card.k > before.k && card.k < after.k, '中途缩放应落在前后两格之间');
});

test('取哪一面:右侧看 recto(最右面),左侧看 verso(最左面)', () => {
  assert.equal(fanFaceIndex(2, 1), 1, '右侧扇形露的是那一屏的右页');
  assert.equal(fanFaceIndex(2, -1), 0, '左侧扇形露的是那一屏的左页');
  // 封面/封尾是 solo,只有一面 —— 两侧都只能取它。
  assert.equal(fanFaceIndex(1, 1), 0);
  assert.equal(fanFaceIndex(1, -1), 0);
});
