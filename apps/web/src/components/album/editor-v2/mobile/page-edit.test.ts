import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
  applyImageClear,
  applyImagePos,
  applyImageSwap,
  imagesPatchBody,
  applyPageBg,
  applyTextEdit,
  matchFontId,
  normalizeColor,
  pageBgPatchBody,
  imagePosPatchBody,
  probeToState,
  readImagePos,
  readPageBg,
  styleDiff,
  textPatchBody,
  type ComputedProbe,
  type TextStyleState,
} from './page-edit';
import { EDITOR_FONTS } from '../editor-fonts';
import type { EditorPage } from '../../types';

/* 移动端编辑落地的纯函数层。这一层是「改动生效」的全部真相:
   预览与落库共用同一套 patcher,所以这里绿了就等于「屏幕上看到的 = 存下去的」。 */

const here = dirname(fileURLToPath(import.meta.url));

const PROBE: ComputedProbe = {
  text: '原文',
  fontSize: '28px',
  color: 'rgb(17, 17, 17)',
  fontWeight: '400',
  fontStyle: 'normal',
  textAlign: 'start',
  fontFamily: 'nope-not-a-real-font',
};

const HTML =
  '<div data-template="mag-03" style="background:#fff">' +
  '<div data-text-key="title" style="font-size:28px">原文</div>' +
  '<img data-image-slot="p1" src="{{IMG_SRC:p1}}">' +
  '</div>';

function page(): EditorPage {
  return {
    pageIndex: 3,
    templateId: 'mag-03',
    imagesJson: { p1: 'photo-1' },
    textsJson: { title: '原文' },
    htmlJson: HTML,
  };
}
/** 存量/未烘页:没有 html 真相,只有模板 + 数据。 */
function pageWithoutHtml(): EditorPage {
  const p = page();
  delete p.htmlJson;
  return p;
}

// ── 读:computed → 面板初值 ──────────────────────────────────────────────────

test('normalizeColor:rgb/rgba 归一成 hex(取色格才能高亮命中)', () => {
  assert.equal(normalizeColor('rgb(17, 17, 17)'), '#111111');
  assert.equal(normalizeColor('rgba(255, 0, 8, 0.5)'), '#ff0008');
  assert.equal(normalizeColor('#ABCDEF'), '#abcdef');
  assert.equal(normalizeColor(''), null);
});

test('matchFontId:computed 的 font-family 串反查得回字体表 id', () => {
  const f = EDITOR_FONTS[0]!;
  assert.equal(matchFontId(f.stack), f.id);
  assert.equal(matchFontId('"' + f.stack.split(',')[0]!.replace(/["']/g, '') + '", serif'), f.id);
  assert.equal(matchFontId('some-unknown-family'), null);
  assert.equal(matchFontId(''), null);
});

test('probeToState:面板打开时显示元素真实样式,不是空白', () => {
  const s = probeToState(PROBE);
  assert.equal(s.text, '原文');
  assert.equal(s.fontSize, 28);
  assert.equal(s.color, '#111111');
  assert.equal(s.bold, false);
  assert.equal(s.italic, false);
  assert.equal(s.align, 'left', 'computed 的 start 要归一成 left');
});

test('probeToState:bold 关键字与 600+ 数值都算粗', () => {
  assert.equal(probeToState({ ...PROBE, fontWeight: 'bold' }).bold, true);
  assert.equal(probeToState({ ...PROBE, fontWeight: '700' }).bold, true);
  assert.equal(probeToState({ ...PROBE, fontWeight: '600' }).bold, true);
  assert.equal(probeToState({ ...PROBE, fontWeight: '500' }).bold, false);
});

// ── 写:只写改过的项 ────────────────────────────────────────────────────────

test('styleDiff:没改动就不写任何 CSS(不把模板继承值烘死进 html)', () => {
  const base = probeToState(PROBE);
  assert.deepEqual(styleDiff(base, base), {});
});

test('styleDiff:只写用户真改过的项', () => {
  const base = probeToState(PROBE);
  assert.deepEqual(styleDiff({ ...base, fontSize: 40 }, base), { 'font-size': '40px' });
  assert.deepEqual(styleDiff({ ...base, color: '#ff0000' }, base), { color: '#ff0000' });
  assert.deepEqual(styleDiff({ ...base, align: 'center' }, base), { 'text-align': 'center' });
});

test('styleDiff:关掉粗/斜写 null(= 移除该声明,回落模板)', () => {
  const base = probeToState({ ...PROBE, fontWeight: '700', fontStyle: 'italic' });
  assert.deepEqual(styleDiff({ ...base, bold: false }, base), { 'font-weight': null });
  assert.deepEqual(styleDiff({ ...base, italic: false }, base), { 'font-style': null });
});

test('styleDiff:字号被夹在 6..200(与桌面 applyFontSizeToSelection 同)', () => {
  const base = probeToState(PROBE);
  assert.deepEqual(styleDiff({ ...base, fontSize: 999 }, base), { 'font-size': '200px' });
  assert.deepEqual(styleDiff({ ...base, fontSize: 1 }, base), { 'font-size': '6px' });
});

test('styleDiff:换字体写具体字体栈,不写 var(--…)(导出环境没有编辑器变量)', () => {
  const base = probeToState(PROBE);
  const f = EDITOR_FONTS[0]!;
  const props = styleDiff({ ...base, fontId: f.id }, base);
  assert.equal(props['font-family'], f.stack);
  assert.doesNotMatch(String(props['font-family']), /var\(--/);
});

// ── 打进页面 ────────────────────────────────────────────────────────────────

test('applyTextEdit:改文字同时落 html 真相与 textsJson', () => {
  const base = probeToState(PROBE);
  const { page: next } = applyTextEdit(page(), 'title', { ...base, text: '新文案' }, base);
  assert.equal(next.textsJson.title, '新文案');
  assert.match(String(next.htmlJson), /data-text-key="title"[^>]*>新文案</);
  assert.doesNotMatch(String(next.htmlJson), />原文</);
});

test('applyTextEdit:改样式写进那个槽的行内 style,不碰别的槽', () => {
  const base = probeToState(PROBE);
  const { page: next, props } = applyTextEdit(page(), 'title', { ...base, fontSize: 40 }, base);
  assert.deepEqual(props, { 'font-size': '40px' });
  assert.match(String(next.htmlJson), /font-size:40px/);
  assert.match(String(next.htmlJson), /data-image-slot="p1"/, '图片槽必须原样留着');
});

// ── 换图 / 清空图槽 ─────────────────────────────────────────────────────────

test('applyImageSwap:只改数据层,html 的 IMG_SRC token 一个字不动', () => {
  const before = page();
  const next = applyImageSwap(before, 'p1', 'photo-9');
  assert.equal(next.imagesJson.p1, 'photo-9');
  assert.equal(next.htmlJson, before.htmlJson, 'html 不该被碰 —— token 靠 images 现查现解析');
  assert.match(String(next.htmlJson), /\{\{IMG_SRC:p1\}\}/, 'token 必须原样留着');
  assert.notEqual(next.imagesJson, before.imagesJson, '不许原地改 base(预览要能取消还原)');
  assert.equal(before.imagesJson.p1, 'photo-1', 'base 必须没被改');
});

test('applyImageSwap:换图保留该槽的位置/缩放(换的是内容不是版面)', () => {
  const withPos = { ...page(), imagePosJson: { p1: { x: 10, y: -5, scale: 1.4 } } };
  const next = applyImageSwap(withPos, 'p1', 'photo-9');
  assert.deepEqual(next.imagePosJson?.p1, { x: 10, y: -5, scale: 1.4 });
});

test('applyImageClear:删掉 key 而不是置空串(空串会在数据里留假记录)', () => {
  const next = applyImageClear(page(), 'p1');
  assert.equal('p1' in next.imagesJson, false, '必须删 key');
  assert.equal(next.imagesJson.p1, undefined);
});

test('applyImageClear:版式不变 —— html 与 token 原样保留,框还占着位', () => {
  const before = page();
  const next = applyImageClear(before, 'p1');
  assert.equal(next.htmlJson, before.htmlJson);
  assert.match(String(next.htmlJson), /\{\{IMG_SRC:p1\}\}/, '槽还在,以后放张图回去就复原');
});

test('applyImageClear:连该槽的位置/缩放一起抹掉(否则新图会继承上一张的平移)', () => {
  const withPos = { ...page(), imagePosJson: { p1: { x: 10, y: -5, scale: 1.4 }, p2: { x: 1, y: 2, scale: 1 } } };
  const next = applyImageClear(withPos, 'p1');
  assert.equal(next.imagePosJson?.p1, undefined, 'p1 的位置要一起清');
  assert.deepEqual(next.imagePosJson?.p2, { x: 1, y: 2, scale: 1 }, '别的槽不许动');
});

test('applyImageClear:不动别的图槽', () => {
  const two = { ...page(), imagesJson: { p1: 'photo-1', p2: 'photo-2' } };
  const next = applyImageClear(two, 'p1');
  assert.deepEqual(next.imagesJson, { p2: 'photo-2' });
});

test('imagesPatchBody:发全量 imagesJson(服务端整体替换,单键会把别的槽抹掉)', () => {
  const two = { ...page(), imagesJson: { p1: 'photo-1', p2: 'photo-2' } };
  const body = imagesPatchBody(applyImageSwap(two, 'p1', 'photo-9'));
  assert.deepEqual(body.imagesJson, { p1: 'photo-9', p2: 'photo-2' });
  assert.ok('imagePosJson' in body, '位置要一起发 —— 清空时靠它把那槽的位置抹掉');
});

test('imagesPatchBody:清空后发出去的全量里确实没有那个 key', () => {
  const two = { ...page(), imagesJson: { p1: 'photo-1', p2: 'photo-2' } };
  const body = imagesPatchBody(applyImageClear(two, 'p1'));
  assert.deepEqual(body.imagesJson, { p2: 'photo-2' });
});

test('applyTextEdit:换字体后 htmlJson 必须还在(丢了就等于预览全废)', () => {
  // 回归 #304:字体栈是双引号形态,曾被 patcher 的注入护栏判为非法 → 返回 null →
  // patched() 把 htmlJson 置 undefined。后果不只是「字体不上屏」:这一页 html 真相
  // 一丢,下次开面板 draftBase.htmlJson 已是 undefined,改颜色/字号也全预览不出来,
  // 用户看到的就是「颜色、字体全都不可用,只有刷新才显示」。
  const base = probeToState(PROBE);
  for (const f of EDITOR_FONTS) {
    const { page: next, props } = applyTextEdit(page(), 'title', { ...base, fontId: f.id }, base);
    assert.equal(props['font-family'], f.stack);
    assert.equal(typeof next.htmlJson, 'string', `字体 ${f.id} 让 htmlJson 变成了 ${typeof next.htmlJson}`);
    // 字体栈以实体形态落在那个槽上,且裸双引号不许出现(会截断 style 属性)。
    assert.doesNotMatch(String(next.htmlJson), /style="[^"]*font-family:"/);
    assert.match(String(next.htmlJson), /data-text-key="title"[^>]*font-family:/);
  }
});

test('applyTextEdit:换字体后再改颜色/字号仍能继续打补丁(级联不失效)', () => {
  const base = probeToState(PROBE);
  const f = EDITOR_FONTS[0]!;
  const afterFont = applyTextEdit(page(), 'title', { ...base, fontId: f.id }, base).page;
  assert.equal(typeof afterFont.htmlJson, 'string');
  // 把「换过字体的那一页」当成新的 base(等价于关掉面板再打开),继续改颜色。
  const afterColor = applyTextEdit(afterFont, 'title', { ...base, color: '#13b8a6' }, base).page;
  assert.equal(typeof afterColor.htmlJson, 'string', '第二次改动不该丢 html');
  assert.match(String(afterColor.htmlJson), /color:#13b8a6/);
  assert.match(String(afterColor.htmlJson), /font-family:&quot;/, '字体栈要保住');
});

test('applyTextEdit:文字被转义,html 不可注入', () => {
  const base = probeToState(PROBE);
  const { page: next } = applyTextEdit(page(), 'title', { ...base, text: '<script>x</script>' }, base);
  assert.doesNotMatch(String(next.htmlJson), /<script>/);
  assert.match(String(next.htmlJson), /&lt;script&gt;/);
});

test('applyTextEdit:锚点缺失 → 丢掉 html 真相(回落模板重烘,不显示旧内容)', () => {
  const base = probeToState(PROBE);
  const { page: next } = applyTextEdit(page(), 'no-such-slot', { ...base, text: 'x' }, base);
  assert.equal(next.htmlJson, undefined);
  assert.equal(next.textsJson['no-such-slot'], 'x', '数据层仍要写(重烘时用得上)');
});

test('applyTextEdit:没有 html 真相时只动数据层,不炸', () => {
  const base = probeToState(PROBE);
  const { page: next } = applyTextEdit(pageWithoutHtml(), 'title', { ...base, text: 'x' }, base);
  assert.equal(next.htmlJson, undefined);
  assert.equal(next.textsJson.title, 'x');
});

test('applyTextEdit:总是从 base 重算 —— 反复改不累加、能回到原值', () => {
  const base = probeToState(PROBE);
  const src = page();
  const big = applyTextEdit(src, 'title', { ...base, fontSize: 40 }, base).page;
  const small = applyTextEdit(src, 'title', { ...base, fontSize: 12 }, base).page;
  assert.match(String(small.htmlJson), /font-size:12px/);
  assert.doesNotMatch(String(small.htmlJson), /font-size:40px/);
  // 改回初值 = 无差集 = 原样(取消即把 base 放回去,不需要反向撤销)
  const backToBase = applyTextEdit(src, 'title', base, base).page;
  assert.equal(backToBase.htmlJson, src.htmlJson);
  assert.notEqual(big.htmlJson, src.htmlJson);
});

test('applyPageBg:写页根的 background-color;null 移除覆写', () => {
  const withBg = applyPageBg(page(), '#eef7f6');
  assert.match(String(withBg.htmlJson), /data-template="mag-03"[^>]*background-color:#eef7f6/);
  const cleared = applyPageBg(withBg, null);
  assert.doesNotMatch(String(cleared.htmlJson), /background-color/);
});

test('readPageBg:面板打开时能读回当前底色(它没有点击目标可探)', () => {
  assert.equal(readPageBg(page()), null, '没写过覆写 = 无背景');
  assert.equal(readPageBg(applyPageBg(page(), '#EEF7F6')), '#eef7f6');
  assert.equal(readPageBg(applyPageBg(page(), 'rgb(238, 247, 246)')), '#eef7f6');
  // 清空后要读回 null,否则「无背景」格高亮不上
  assert.equal(readPageBg(applyPageBg(applyPageBg(page(), '#eef7f6'), null)), null);
  assert.equal(readPageBg(pageWithoutHtml()), null);
});

test('readPageBg:不会把 background(简写)误读成 background-color', () => {
  // 页根自带 style="background:#fff" —— 那是模板默认纸白,不是用户设的底色。
  assert.equal(readPageBg(page()), null);
});

// ── 落库 payload ────────────────────────────────────────────────────────────

test('textPatchBody:textsJson 发全量(服务端是整体替换 page.texts)', () => {
  const p = { ...page(), textsJson: { title: '新', sub: '旧' } };
  const body = textPatchBody(p, 'title', { 'font-size': '40px' });
  assert.deepEqual(body.textsJson, { title: '新', sub: '旧' });
  assert.deepEqual(body.textStyles, { title: { 'font-size': '40px' } });
});

test('textPatchBody:没有样式改动就不带 textStyles(空对象会白跑一次 patch)', () => {
  assert.equal('textStyles' in textPatchBody(page(), 'title', {}), false);
});

test('pageBgPatchBody:走 pageStyle 通道', () => {
  assert.deepEqual(pageBgPatchBody('#eef7f6'), { pageStyle: { 'background-color': '#eef7f6' } });
  assert.deepEqual(pageBgPatchBody(null), { pageStyle: { 'background-color': null } });
});

// ── 架构守卫 ────────────────────────────────────────────────────────────────

test('架构守卫:page-edit 是纯函数层,不碰 DOM', () => {
  // 先剥注释:抬头说明里就写着「不碰 document/querySelector」,那是文字不是代码。
  const src = readFileSync(join(here, 'page-edit.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(src, /\bdocument\b/);
  assert.doesNotMatch(src, /querySelector/);
  assert.doesNotMatch(src, /getComputedStyle/);
  assert.doesNotMatch(src, /\bwindow\./);
});

// ── 图片位置/缩放 ───────────────────────────────────────────────────────────

test('applyImagePos:html 与数据层必须同时写(只写一边 = 刷新回退 或 导出不一致)', () => {
  const next = applyImagePos(page(), 'p1', { x: 30, y: 40, scale: 1.5 });
  assert.deepEqual(next.imagePosJson?.p1, { x: 30, y: 40, scale: 1.5 }, '数据层要写');
  assert.match(String(next.htmlJson), /object-position:30% 40%/, 'html 也要写');
  assert.match(String(next.htmlJson), /transform:scale\(1\.5\)/);
});

test('applyImagePos:越界值被夹进合法区间(scale≥1 是「不出白边」的硬不变式)', () => {
  const a = applyImagePos(page(), 'p1', { x: -20, y: 999, scale: 0.2 });
  assert.deepEqual(a.imagePosJson?.p1, { x: 0, y: 100, scale: 1 });
  const b = applyImagePos(page(), 'p1', { x: 50, y: 50, scale: 99 });
  assert.equal(b.imagePosJson?.p1?.scale, 2, 'scale 上限 2');
});

test('readImagePos:没设过就是默认(居中、不放大)', () => {
  assert.deepEqual(readImagePos(page(), 'p1'), { x: 50, y: 50, scale: 1 });
  const moved = applyImagePos(page(), 'p1', { x: 10, y: 20, scale: 1.2 });
  assert.deepEqual(readImagePos(moved, 'p1'), { x: 10, y: 20, scale: 1.2 });
});

test('imagePosPatchBody:落库发的是整张 imagePosJson', () => {
  const moved = applyImagePos(page(), 'p1', { x: 10, y: 20, scale: 1.2 });
  assert.deepEqual(imagePosPatchBody(moved), { imagePosJson: { p1: { x: 10, y: 20, scale: 1.2 } } });
});
