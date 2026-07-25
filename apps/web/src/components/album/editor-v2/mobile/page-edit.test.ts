import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
  applyPageBg,
  applyTextEdit,
  matchFontId,
  normalizeColor,
  pageBgPatchBody,
  probeToState,
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
