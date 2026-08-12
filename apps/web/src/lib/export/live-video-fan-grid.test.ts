import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { LIVE_FAN_SHAPE, fanOuterEdge } from './live-fan-geometry';

// 扇形页堆与结尾「全部页面一览」的**接线**。几何与时间线本身在
// live-fan-geometry / live-grid-motion 里有真单测;这里锁的是 live-video 确实
// 走了那两个模块、画的顺序对、以及封面合着时不画页堆。
// (live-video 是 DOM+WebCodecs 客户端代码,仓里没有 jsdom 夹具,故做源文本断言,
// 与 live-video-flip-realism.test.ts 同一路数。)

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, 'live-video.ts'), 'utf8');

test('扇形几何来自 live-fan-geometry,不在画布里重算一套', () => {
  assert.match(src, /from '\.\/live-fan-geometry'/);
  assert.match(src, /\bfanCards\(/, 'fanCards 必须被调用');
  assert.match(src, /\bfanFaceIndex\(/, '取哪一面必须走 fanFaceIndex');
  // 卡是正矩形 —— 不许有人把它退回逐列切片(那是翻动那张纸才需要的)。
  const fn = /function paintFanCard\([^]*?\n\}/.exec(src);
  assert.ok(fn, 'expected a paintFanCard primitive');
  assert.doesNotMatch(fn![0], /projectLeafColumn|for \(const s of slices\)/, '扇形卡不该逐列投影');
  assert.match(fn![0], /ctx\.drawImage\(face, c\.x, c\.y, c\.w, c\.h\)/, '一次 drawImage 贴完');
});

test('网格排布与滚动来自 live-grid-motion', () => {
  assert.match(src, /from '\.\/live-grid-motion'/);
  for (const name of ['gridSpec', 'gridCellRect', 'gridScrollY', 'gridTailFrames']) {
    assert.match(src, new RegExp(`\\b${name}\\(`), `${name} 必须被调用,不许本地再算一遍`);
  }
});

test('页堆画在书之下,暗角画在页堆之下', () => {
  // 停留那一帧的顺序:底(背景+暗角)→ 页堆 → 书。顺序错了书会被自己的页堆盖住。
  // 只比先后,不钉参数写法 —— 钉整行的话改个形参名就红,而行为没变。
  const hold = /^\s*paintGround\(ctx\);\n\s*paintViewBook\(ctx, a\);\n\s*paintFan\(/m;
  assert.match(src, hold, '停留帧的绘制顺序不对(底 → 书底 → 折页)');
  const ground = /const ground = layer\(\(c\) => \{[^}]*\}\);/.exec(src);
  assert.ok(ground, '垫底背景 + 暗角必须预渲成一层');
  assert.match(ground![0], /paintBg\(c\);[^]*paintVignette\(c\)/, '暗角必须压在垫底背景之上');
});

test('不随帧变的东西一律预渲:垫底/暗角一层,投影用精灵', () => {
  // 同一文件里书影早有先例(「逐帧现算太贵」)。暗角是整幅渐变、背景可能是几千像素
  // 的大图,每帧重来一遍在长相册上就是几千次白工。
  assert.match(src, /const paintGround = [^]*?ctx\.drawImage\(ground, 0, 0\)/, '底必须是贴预渲层');
  assert.match(src, /function makeShadowSprite\(/, '投影要预渲成精灵');
  assert.doesNotMatch(
    src,
    /function paintRectShadow\(/,
    '逐帧现算任意矩形投影的老路必须退场',
  );
  // 扇形的 face 要先降采样再逐帧贴(原图 1588×2246,一帧 14 张现降太贵)。
  assert.match(src, /function fanFaceOf\(/);
  assert.match(src, /paintFanCard\(ctx, fanFaceOf\(face\)/, '扇形必须画降采样后的 face');
});

test('垫底背景仍然是用户选的那张,没有被固定深色底顶掉', () => {
  // 2026-08-11 拍板:保留 options.background,只在其上叠暗角。
  assert.match(src, /const bg = options\.background \?\? null;/);
  assert.match(src, /bg\?\.kind === 'preset'/);
  assert.match(src, /bg\?\.kind === 'upload'/);
});

test('封面/封尾合着时不画页堆;开合过程里书脊位置只有一处推导', () => {
  assert.match(src, /fanAlphaOf[^\n]*v\.solo/, '合着的书没有摊开的页堆');
  // 书脊位置由 edgeSpineOf 给出,paintEdgeFlip 与页堆共用;不许谁再推一次。
  const decl = /const edgeSpineOf = [^]*?;\n/.exec(src);
  assert.ok(decl, 'expected an edgeSpineOf helper');
  assert.ok(
    !src.replace(decl![0], '').includes('startShiftPct'),
    '书脊位置只该在 edgeSpineOf 里推一次,别处不许再算',
  );
  assert.match(src, /paintFan\([^;]*edgeSpineOf\(/, '页堆必须跟着书脊走');
});

test('页堆与翻页同一条缓动:整摞随那张纸推进一格', () => {
  // pos = k + flipEase(t) —— 用线性 t 的话页堆会与纸脱拍。
  assert.match(src, /const e = flipEase\(t\);\n\s*paintSpreadGround[\s\S]{0,80}paintFan\(ctx, k \+ e,/);
});

test('页堆的 alpha 与调用方相乘而不是覆写(交叉淡出里不许硬挺着不淡)', () => {
  const fn = /function paintFan\([^]*?\n  \}/.exec(src);
  assert.ok(fn, 'expected paintFan');
  assert.match(fn![0], /ctx\.globalAlpha = ctx\.globalAlpha \* alpha/);
});

test('结尾接上全部页面一览:三段都从同一份帧账取数', () => {
  assert.match(src, /const thumbs = views\.map\(renderThumb\)/);
  assert.match(src, /const tail = gridTailFrames\(grid\.scroll, FPS\)/);
  for (const seg of ['tail.fade', 'tail.scroll', 'tail.hold']) {
    assert.ok(src.includes(`f < ${seg}`), `${seg} 必须直接驱动发帧循环`);
  }
  // 进度总帧数用 tail.total —— 帧账闭合由 live-grid-motion.test.ts 保证,
  // 这样以后加第五段也不会出现「进度走到 100% 还在渲」。
  assert.match(src, /\+ tail\.total;/);
  assert.doesNotMatch(src, /GRID_FADE_FRAMES|GRID_HOLD_FRAMES/, '本地帧数常量必须退场');
});

test('扇形不许铺出画幅(拿出片参数和真实画幅量,不是拿测试夹具)', () => {
  // vp 从 2.6 调到 3.5 这种「再铺开一点」会直接出画,几何单测发现不了 ——
  // 数从 live-video 的源码里抠,盯的就是实际出片的那一组。
  const num = (re: RegExp, what: string) => {
    const m = re.exec(src);
    assert.ok(m, `没找到 ${what}`);
    return Number(m![1]);
  };
  const outW = num(/const OUT_W = (\d+);/, 'OUT_W');
  const bookW = num(/const BOOK_W = (\d+);/, 'BOOK_W');
  const outH = num(/const OUT_H = (\d+);/, 'OUT_H');
  const bookH = bookW / ((794 * 2) / 1123);
  const outer = fanOuterEdge({
    ...LIVE_FAN_SHAPE,
    bookW,
    bookH,
    spineX: outW / 2,
    centerY: outH / 2,
  });
  // 卡片本体必须整张在画幅内。参数是解出来的:θmax/vp 正好把最外一张顶到 1056,
  // 离画幅右缘还有 24px —— 再往外推一点点就切卡,那是肉眼可见的坏。
  assert.ok(outer <= outW, `扇形外缘 ${outer.toFixed(0)} 超出画幅 ${outW}`);
  assert.ok(outW - outer >= 20, `只剩 ${(outW - outer).toFixed(0)}px 余量,再调就切卡了`);
  // 说明:投影(偏移 24 + 模糊 48)的那截尾巴允许溢出画幅。它压在暗角最深处又正好
  // 在画面边缘,切掉看不出;为它把扇形收窄不划算。
  assert.ok(outW - outer < 8 * 3 + 16 * 3, '这条注释描述的余量前提没了,请重新评估');
});

test('缩略图到结尾才渲,不在翻页阶段白占内存', () => {
  const flipLoop = src.indexOf('for (let k = 0; k < n; k++)');
  const buildThumbs = src.indexOf('const thumbs = views.map(renderThumb)');
  assert.ok(flipLoop > 0 && buildThumbs > flipLoop, '缩略图不该在翻页循环之前就建好');
});

test('书收窄到 560 给页堆腾地方,书脊仍在画布中线(透视原点没被挪歪)', () => {
  assert.match(src, /const BOOK_W = 560;/);
  assert.match(src, /const BOOK_X = \(OUT_W - BOOK_W\) \/ 2;/);
  // paintLeaf 的 originX 取 OUT_W/2,书脊必须与它重合,否则翻页透视会歪。
  assert.match(src, /const SPINE = BOOK_X \+ HALF_W;/);
  assert.match(src, /const originX = OUT_W \/ 2;/);
});
