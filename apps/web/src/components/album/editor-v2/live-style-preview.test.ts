/* ════════════════════════════════════════════════════════════════════════════
   Live 弹窗里那张「翻页 Live」示意图,必须画的是**当下真在导出的那套动效**。

   这条守卫是有账的:示意图 2026-07-28 做的时候导出还是「一张纸绕左边扫过去」,
   而 8/3–8/13 导出被重写了两代(折页模型 → 扇形页堆 + 新跨页从书脊两半张开),
   示意图没人动 —— 用户在弹窗里看到的翻页跟他导出拿到的片子完全不是一回事。

   所以下面这几条不是「断言几个数」,是把示意图的扇形矩形与明暗**从
   live-fan-geometry 的真几何里现算出来**再比:谁把 LIVE_FAN_SHAPE 调了
   (再铺开一点、再压暗一点),这里会红,逼着示意图跟上,不会再漂第三次。
   ════════════════════════════════════════════════════════════════════════════ */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { PAGE } from '../templates/constants';
import { LIVE_FAN_SHAPE, fanCards } from '@/lib/export/live-fan-geometry';

const here = dirname(fileURLToPath(import.meta.url));

/** 源码断言前必须剥注释 —— 否则一句说明文字就能把守卫喂饱(CSS 侧同样要剥)。 */
function stripBlockComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** TSX 专用:先摘 JSX 的 {/* … *​/} 花括号壳。这条**不能**喂给 CSS ——
 *  CSS 里 `…{` 换行接一条注释就会被它当成壳,从那里一路吞到下一个 `*​/ }`。 */
function stripComments(src: string): string {
  return stripBlockComments(src.replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, ''));
}

/** 媒体查询里同名规则会顶包(.motion-book 在窄屏那段又出现一次),取基础规则前先摘掉。 */
function stripAtRules(css: string): string {
  let out = '';
  for (let i = 0; i < css.length; i++) {
    if (!css.startsWith('@media', i)) {
      out += css[i];
      continue;
    }
    const open = css.indexOf('{', i);
    if (open < 0) break;
    let depth = 0;
    let j = open;
    for (; j < css.length; j++) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}' && --depth === 0) break;
    }
    i = j;
  }
  return out;
}

const css = stripAtRules(stripBlockComments(readFileSync(join(here, 'editor-port.css'), 'utf8')));
const desktop = stripComments(readFileSync(join(here, 'EditorPort.tsx'), 'utf8'));
const mobile = stripComments(readFileSync(join(here, 'mobile/modals/ExportModals.tsx'), 'utf8'));

// 示意图里的书:横向就这么点余量,扇形最外一张要留在方框里 —— 书宽 84 是挑定的那版。
const THUMB_BOOK_W = 84;
const THUMB_BOOK_H = THUMB_BOOK_W / ((PAGE.width * 2) / PAGE.height);
/** 画到第几张为止(真几何是 7 张,示意图只画得下最靠里的 3 张)。 */
const THUMB_FAN_CARDS = 3;
/** 卡的底色 = 页面灰 #dedede 按 darkAt 往压暗色 #0b0f16 调 —— 与 live-video 的压暗同源。 */
const PAGE_GREY = 0xde;
const FAN_SHADE = 0x0b;

function cssRule(selector: string): string {
  const re = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'g');
  const hits = [...css.matchAll(re)];
  assert.equal(hits.length, 1, `editor-port.css 里 ${selector} 应恰好有一条规则(现在 ${hits.length} 条)`);
  return hits[0][1];
}

function pxOf(rule: string, prop: string): number {
  const m = rule.match(new RegExp(`(?:^|[;\\s])${prop}\\s*:\\s*(-?[\\d.]+)px`));
  assert.ok(m, `${prop} 应以 px 写死在规则里:${rule}`);
  return Number(m[1]);
}

function greyOf(rule: string): number {
  const m = rule.match(/background\s*:\s*#([0-9a-f]{2})\1\1\b/i);
  assert.ok(m, `扇形卡应有 #rrggbb 的中性灰底色:${rule}`);
  return parseInt(m[1], 16);
}

/** 示意图那摞卡:真几何在缩略图尺寸下的解,由深到浅(= 画的先后)。 */
function thumbFanCards() {
  const p = {
    ...LIVE_FAN_SHAPE,
    bookW: THUMB_BOOK_W,
    bookH: THUMB_BOOK_H,
    spineX: THUMB_BOOK_W / 2,
    centerY: THUMB_BOOK_H / 2,
  };
  // pos 取中段,fanCards 才两侧都给卡;左侧那摞由 CSS 的 scaleX(-1) 镜像出来,这里只取右侧。
  return fanCards(10, 20, p)
    .filter((c) => c.side === 1 && c.depth >= 1 && c.depth <= THUMB_FAN_CARDS)
    .sort((a, b) => b.depth - a.depth);
}

test('翻页示意图两端同款:扇形页堆 + 新跨页从书脊两半张开', () => {
  for (const [name, src] of [['桌面 EditorPort', desktop], ['移动端 ExportModals', mobile]] as const) {
    assert.match(src, /motion-fan motion-fan-left/, `${name} 应画左侧扇形页堆`);
    assert.match(src, /motion-fan motion-fan-right/, `${name} 应画右侧扇形页堆`);
    assert.match(src, /motion-leaf motion-leaf-left/, `${name} 应画张开的左半跨页`);
    assert.match(src, /motion-leaf motion-leaf-right/, `${name} 应画张开的右半跨页`);
    assert.doesNotMatch(src, /motion-page-turn/, `${name} 不该再留 8/3 就删掉的叶片扫过模型`);
  }
  assert.doesNotMatch(css, /yujee-motion-page-turn/, 'CSS 不该再留叶片扫过的 keyframes');
  assert.match(css, /@keyframes yujee-motion-spread-open/, 'CSS 应有跨页对开的 keyframes');
});

test('桌面与移动端的示意图是同一副骨架,不是各写一份', () => {
  const shapeOf = (src: string) => {
    const m = src.match(/<span className="motion-book">[\s\S]*?\n\s*<\/span>/);
    assert.ok(m, '两端都应有 motion-book 这副骨架');
    return m[0].replace(/\s+/g, ' ').trim();
  };
  assert.equal(shapeOf(mobile), shapeOf(desktop), '移动端弹窗的示意图骨架应与桌面逐字一致');
});

test('示意图的扇形矩形是从导出真几何 LIVE_FAN_SHAPE 缩下来的', () => {
  const expected = thumbFanCards();
  assert.equal(expected.length, THUMB_FAN_CARDS, '真几何应给出示意图要画的那几张卡');

  const book = cssRule('.editor-port .motion-book');
  assert.equal(pxOf(book, 'width'), THUMB_BOOK_W, '示意图书宽应是挑定的 84');
  assert.ok(
    Math.abs(pxOf(book, 'height') - THUMB_BOOK_H) <= 0.1,
    `示意图书高应按跨页比例给出 ${THUMB_BOOK_H.toFixed(1)}`,
  );

  expected.forEach((card, i) => {
    const rule = cssRule(`.editor-port .motion-fan i:nth-child(${i + 1})`);
    const got = {
      left: pxOf(rule, 'left'),
      top: pxOf(rule, 'top'),
      width: pxOf(rule, 'width'),
      height: pxOf(rule, 'height'),
    };
    const want = { left: card.x, top: card.y, width: card.w, height: card.h };
    for (const key of ['left', 'top', 'width', 'height'] as const) {
      assert.ok(
        Math.abs(got[key] - want[key]) <= 0.1,
        `第 ${i + 1} 张扇形卡的 ${key} 应是 ${want[key].toFixed(1)}px(真几何 depth ${card.depth}),现在是 ${got[key]}px`,
      );
    }
  });
});

test('扇形卡按「由深到浅」排,深的先画 —— 与 paintFan 照 fanCards 返回序画一致', () => {
  const expected = thumbFanCards();
  const depths = expected.map((c) => c.depth);
  assert.deepEqual(depths, [...depths].sort((a, b) => b - a), '取到的顺序本身应是由深到浅');

  // DOM 靠后者压在上面:nth-child(1) 必须是最深(最小、最暗)那张,最浅那张收尾压在最上。
  const rects = expected.map((_, i) => cssRule(`.editor-port .motion-fan i:nth-child(${i + 1})`));
  const widths = rects.map((r) => pxOf(r, 'width'));
  const greys = rects.map((r) => greyOf(r));
  assert.deepEqual(
    widths,
    [...widths].sort((a, b) => a - b),
    '先画的应是更深更窄那张,否则整摞被最外一张盖成一块板',
  );
  assert.deepEqual(greys, [...greys].sort((a, b) => a - b), '先画的应更暗,越靠上越浅');
});

test('扇形卡的明暗也是真几何的 darkAt 算出来的', () => {
  thumbFanCards().forEach((card, i) => {
    const rule = cssRule(`.editor-port .motion-fan i:nth-child(${i + 1})`);
    const want = Math.round(PAGE_GREY * (1 - card.dark) + FAN_SHADE * card.dark);
    assert.ok(
      Math.abs(greyOf(rule) - want) <= 1,
      `第 ${i + 1} 张卡的灰应是 ${want}(#dedede 按 dark ${card.dark.toFixed(3)} 压暗),` +
        `现在是 ${greyOf(rule)}`,
    );
  });
});
