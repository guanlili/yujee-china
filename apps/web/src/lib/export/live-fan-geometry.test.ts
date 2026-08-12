import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  LIVE_FAN_SHAPE,
  fanCards,
  fanFaceIndex,
  fanOuterEdge,
  type FanParams,
} from './live-fan-geometry';

// 整本书是**一条折页**:每一页绕自己内侧的竖轴折起来,宽度按 cos 收;深度 0 的那
// 一两张就是摊平的当前跨页。翻页 = 把角度分布整体推进一格,于是「当前页收起、下一页
// 展开」是模型自带的,不需要另画一张翻动的纸。
//
// 这套是照用户给的「新翻书效果录屏」逐帧比对定下来的。旧的「叶片盖在已经画好的目标
// 跨页上」被证伪:那张纸一进中段就压成细缝,新内容第一帧就摊在底下,整段看着不动。

const P: FanParams = {
  bookW: 760,
  bookH: 538,
  spineX: 540,
  centerY: 720,
  count: 7,
  vp: 3.4,
  kMin: 0.8,
  gamma: 0.62,
  dark: 0.3,
  thetaMax: 32,
  gammaA: 0.22,
  vpRamp: 1,
};

const HW = P.bookW / 2;
type Cards = ReturnType<typeof fanCards>;
const right = (cs: Cards) => cs.filter((c) => c.side === 1);
const left = (cs: Cards) => cs.filter((c) => c.side === -1);
const deep = (cs: Cards) => cs.filter((c) => c.depth > 1e-9);
const flat = (cs: Cards) => cs.filter((c) => c.depth <= 1e-9);

test('停在某一屏时,深度 0 的两张就是摊平的左右两页(必须逐像素等于半页)', () => {
  const cards = fanCards(11, 22, P);
  const f = flat(cards);
  assert.equal(f.length, 2, '摊平的跨页应当正好由两张深度 0 的卡组成');
  const r = f.find((c) => c.side === 1)!;
  const l = f.find((c) => c.side === -1)!;
  for (const c of [r, l]) {
    assert.equal(c.view, 11, '摊平那两张必须来自当前这一屏');
    assert.ok(Math.abs(c.k - 1) < 1e-12, '摊平的页不缩');
    assert.ok(Math.abs(c.fold - 1) < 1e-12, '摊平的页不折');
    assert.ok(Math.abs(c.w - HW) < 1e-9, '宽必须正好是半页');
    assert.ok(Math.abs(c.h - P.bookH) < 1e-9, '高必须正好是跨页高');
    assert.equal(c.dark, 0, '摊平的页不压暗');
  }
  assert.ok(Math.abs(r.x - P.spineX) < 1e-9, '右页内缘贴书脊');
  assert.ok(Math.abs(l.x + l.w - P.spineX) < 1e-9, '左页外缘贴书脊');
});

test('书首左侧只剩摊平那张、书尾右侧只剩摊平那张', () => {
  const first = fanCards(0, 22, P);
  assert.equal(deep(left(first)).length, 0, '第一屏左边没有翻过的页');
  assert.equal(flat(left(first)).length, 1, '但摊平的左页还在');
  assert.equal(deep(right(first)).length, P.count);

  const last = fanCards(21, 22, P);
  assert.equal(deep(right(last)).length, 0, '最后一屏右边没有没翻的页');
  assert.equal(flat(right(last)).length, 1);
  assert.equal(deep(left(last)).length, P.count);
});

test('中间位置左右各封顶 count 张(另加摊平的两张),不引用越界视图', () => {
  const cards = fanCards(11, 22, P);
  assert.equal(deep(right(cards)).length, P.count);
  assert.equal(deep(left(cards)).length, P.count);
  for (const c of cards) {
    assert.ok(c.view >= 0 && c.view < 22, `视图下标越界: ${c.view}`);
    assert.ok(c.depth >= 0 && c.depth <= P.count, `深度越界: ${c.depth}`);
  }
});

test('count=0 就没有折页(等于关掉这个效果)', () => {
  assert.deepEqual(fanCards(11, 22, { ...P, count: 0 }), []);
});

test('越深的卡:折得越扁、缩得越小、越矮、越暗', () => {
  const cards = deep(right(fanCards(11, 22, P))).sort((a, b) => a.depth - b.depth);
  for (let i = 1; i < cards.length; i++) {
    const prev = cards[i - 1]!;
    const cur = cards[i]!;
    assert.ok(cur.fold <= prev.fold + 1e-12, `第 ${i} 张反而更展开了`);
    assert.ok(cur.k < prev.k, `第 ${i} 张没有更小`);
    assert.ok(cur.h < prev.h, `第 ${i} 张没有更矮`);
    assert.ok(cur.dark > prev.dark, `第 ${i} 张没有更暗`);
  }
  assert.ok(cards[cards.length - 1]!.dark <= P.dark + 1e-9, '压暗不得超过上限');
  // 页堆的层次不能只靠折叠:深度 ≥1 折叠恒定,靠的是纵深缩放 + 外推把外缘推出去。
  const outerOf = (c: Cards[number]) => c.x + c.w - P.spineX;
  for (let i = 1; i < cards.length; i++) {
    assert.ok(outerOf(cards[i]!) > outerOf(cards[i - 1]!), `第 ${i} 张外缘没有更外,页堆会糊在一起`);
  }
});

test('卡宽 = 半页 × 纵深缩放 × 折叠因子;纵向仍以书的中线为轴', () => {
  for (const c of fanCards(11, 22, P)) {
    assert.ok(Math.abs(c.w - HW * c.k * c.fold) < 1e-6, '宽的构成不对');
    assert.ok(Math.abs(c.h - P.bookH * c.k) < 1e-6, '高只随纵深缩,不随折叠');
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

test('翻页途中:当前页单调收起、下一页单调展开(这就是那个动画)', () => {
  // pos 从 11 走到 12。视图 11 的宽度必须一路变窄,视图 12 一路变宽 ——
  // 旧模型在这一段几乎不变(目标页早就整张摊在底下),看着像没动。
  const widthOf = (pos: number, view: number, side: 1 | -1) => {
    const c = fanCards(pos, 22, P).find((x) => x.view === view && x.side === side);
    return c ? c.w : 0;
  };
  let prevOut = Infinity;
  let prevIn = -Infinity;
  for (let i = 0; i <= 10; i++) {
    const pos = 11 + i / 10;
    const out = widthOf(pos, 11, -1); // 收起中的那页(落到左边)
    const inc = widthOf(pos, 12, 1); // 展开中的那页
    assert.ok(out <= prevOut + 1e-9, `pos=${pos.toFixed(1)} 收起的页反而变宽了`);
    assert.ok(inc >= prevIn - 1e-9, `pos=${pos.toFixed(1)} 展开的页反而变窄了`);
    prevOut = out;
    prevIn = inc;
  }
  // 全程要有明显幅度,不能是「几乎不动」——那正是被证伪的旧模型的症状。
  // +25% 是竖版画幅解出来的上限:折得更狠,最外那张的外缘就会被 cos 收回书里,
  // 页堆没了;要两头都要就得把书再收窄,那样页面上的字又糊了。
  const start = widthOf(11, 12, 1) / HW;
  assert.ok(start < 0.85, `起手时下一页已经 ${(start * 100).toFixed(0)}% 宽,展开看不出来`);
  assert.ok(start > 0.6, '也不能折到几乎没有,那样像凭空长出来');
  assert.ok(Math.abs(widthOf(12, 12, 1) - HW) < 1e-9, '落定时下一页必须完全摊平');
});

test('翻页推进连续:pos 逼近整数时,即将摊平那张收敛到半页,不会跳变', () => {
  const err = (eps: number) => {
    const c = right(fanCards(12 - eps, 22, P)).sort((a, b) => a.depth - b.depth)[0]!;
    assert.equal(c.view, 12, '最浅那张应是即将走到正中的那一屏');
    return Math.max(Math.abs(c.x - P.spineX), Math.abs(c.w - HW), Math.abs(c.k - 1));
  };
  const e1 = err(1e-4);
  const e2 = err(1e-8);
  const e3 = err(1e-14);
  assert.ok(e1 < 6, `深度 1e-4 处已偏离半页 ${e1.toFixed(3)}px`);
  assert.ok(e2 < e1 && e3 < e2, '越靠近中心,误差必须越小(收敛)');
  assert.ok(e3 < 1e-3, `极限没收敛到半页:${e3}`);
});

test('整摞逐格平移:pos 每 +1,同深度的卡矩形不变、视图整体挪一位', () => {
  const a = fanCards(11, 22, P);
  const b = fanCards(12, 22, P);
  const key = (c: Cards[number]) => `${c.side}:${c.depth.toFixed(6)}`;
  const ma = new Map(a.map((c) => [key(c), c] as const));
  for (const c of b) {
    const same = ma.get(key(c));
    assert.ok(same, `${key(c)} 在上一屏没有对应卡`);
    assert.equal(same!.view + 1, c.view, '视图没有整体推进一格');
    assert.ok(Math.abs(same!.x - c.x) < 1e-6 && Math.abs(same!.w - c.w) < 1e-6, '同深度矩形应一致');
  }
});

test('取哪一面:右侧看 recto(最右面),左侧看 verso(最左面)', () => {
  assert.equal(fanFaceIndex(2, 1), 1, '右侧露的是那一屏的右页');
  assert.equal(fanFaceIndex(2, -1), 0, '左侧露的是那一屏的左页');
  // 封面/封尾是 solo,只有一面 —— 两侧都只能取它。
  assert.equal(fanFaceIndex(1, 1), 0);
  assert.equal(fanFaceIndex(1, -1), 0);
});

test('fanOuterEdge 与逐张扫出来的最外缘一致;没有折页时就是书自己的外缘', () => {
  const cards = right(fanCards(11, 22, P));
  const outermost = cards.reduce((m, c) => Math.max(m, c.x + c.w), 0);
  assert.ok(Math.abs(fanOuterEdge(P) - outermost) < 1e-6);
  assert.ok(Math.abs(fanOuterEdge({ ...P, count: 0 }) - (P.spineX + HW)) < 1e-6);
});

test('出片参数是唯一一份,且折页确实铺到书外', () => {
  assert.deepEqual(
    Object.keys(LIVE_FAN_SHAPE).sort(),
    ['count', 'dark', 'gamma', 'gammaA', 'kMin', 'thetaMax', 'vp', 'vpRamp'],
  );
  const outer = (fanOuterEdge({ ...P, ...LIVE_FAN_SHAPE }) - P.spineX) / HW;
  assert.ok(outer > 1, `折页没有露出书外(${outer.toFixed(2)}×),厚度就没了`);
});

test('靠中心那几张:内缘必须钉在书脊,外缘必须露到书外', () => {
  // 2026-08-12 活预览逐帧抓到的两个病,都出在「外推对近处也全额生效」:
  //   · 外推把内缘也推离书脊 → 翻页中途书从正中裂开一道口子;
  //   · 折叠把外缘收进书里 → 「展开」看着像从书底下滑出来,不是抡开。
  // 只验 depth ≤ 0.5:那是翻页正中间、横穿书脊那张纸宽度归零的时刻,谁也遮不住裂口。
  // 更深的那几张此刻被那张纸盖着,少许缺口看不见,而它们正需要外推来撑出页堆。
  for (const depth of [0.2, 0.35, 0.5]) {
    const c = fanCards(11 + depth, 22, P).find((x) => x.side === -1 && Math.abs(x.depth - depth) < 1e-9)!;
    assert.ok(c, `深度 ${depth} 应当有卡`);
    const gap = Math.abs(c.x + c.w - P.spineX); // 左侧卡的内缘 = x + w
    assert.ok(gap < HW * 0.02, `深度 ${depth} 的内缘离书脊 ${gap.toFixed(1)}px,正中会裂口`);
  }
  const d1 = fanCards(11, 22, P).find((x) => x.side === 1 && Math.abs(x.depth - 1) < 1e-9)!;
  assert.ok(
    d1.x + d1.w - P.spineX >= HW,
    `深度 1 那张外缘只到 ${((d1.x + d1.w - P.spineX) / HW).toFixed(2)}× 半页,缩在书里就看不见展开`,
  );
});
