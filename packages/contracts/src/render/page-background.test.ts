import assert from 'node:assert/strict';
import test from 'node:test';

import { applyPageBackground } from './page-background';
import { bestInkFor, contrastRatio } from '../design/contrast';
import { renderPageHtml, fillTemplateHtml } from './fill-template';
import { getHtmlTemplate } from './html-templates/registry';
import { PAGE_BACKGROUND_CARRIER_KEY } from '../theme-carrier';
import { TEMPLATES } from '../templates.generated';

const ROOT = '<div data-template="mag-05" style="position:relative;width:794px;background:#fff;color:#1c1b18">x</div>';

test('无底色时逐字节不变', () => {
  assert.equal(applyPageBackground(ROOT, undefined), ROOT);
  assert.equal(applyPageBackground(ROOT, ''), ROOT);
});

test('background-color 追加在 style 末尾（必须盖住 background:#fff 简写）', () => {
  const out = applyPageBackground(ROOT, '#F3F0A8');
  const style = /style="([^"]*)"/.exec(out)![1]!;
  // 末尾现在是「底色 + 成对字色」两条（理由见文件末尾那一组测试）；关键是两者都排在
  // 模板自带的 background:#fff / color:#1c1b18 之后，源序靠后才盖得住。
  assert.ok(
    style.endsWith('background-color:#F3F0A8;color:#1A1A14'),
    `末尾不是新底色+成对字色：${style}`,
  );
  assert.ok(style.indexOf('background:#fff') < style.indexOf('background-color:'), '简写必须在前才盖得住');
});

test('页根没有 style 属性时补一个', () => {
  const bare = '<div data-template="mag-05">x</div>';
  assert.equal(
    applyPageBackground(bare, '#2D6DB0'),
    '<div data-template="mag-05" style="background-color:#2D6DB0;color:#F5F2E8">x</div>',
  );
});

test('重复应用是幂等的（同一个键覆盖，不追加第二份）', () => {
  const once = applyPageBackground(ROOT, '#F3F0A8');
  const twice = applyPageBackground(once, '#F3F0A8');
  assert.equal(twice, once);
  const changed = applyPageBackground(once, '#2D6DB0');
  assert.equal((changed.match(/background-color:/g) ?? []).length, 1, '不能留下两个 background-color');
});

test('非法色值原样返回（拒绝比写坏安全）', () => {
  assert.equal(applyPageBackground(ROOT, 'red; content:url(x)'), ROOT);
  assert.equal(applyPageBackground(ROOT, 'rgb(1,2,3)'), ROOT);
});

test('找不到页根时原样返回', () => {
  assert.equal(applyPageBackground('<p>no root</p>', '#F3F0A8'), '<p>no root</p>');
});

function sample(templateId: string, extraTexts: Record<string, string> = {}) {
  const tpl = (TEMPLATES as Record<string, { texts?: { id: string; sample?: string }[]; images?: { id: string }[] }>)[templateId]!;
  const texts: Record<string, string> = {};
  for (const t of tpl.texts ?? []) texts[t.id] = t.sample ?? '';
  const images: Record<string, string> = {};
  for (const im of tpl.images ?? []) images[im.id] = `p-${im.id}`;
  return { templateId, images, texts: { ...texts, ...extraTexts } };
}

test('没有 #pageBackground 键时，renderPageHtml 与不加包装的 fillTemplateHtml 逐字节相同', () => {
  for (const id of ['mag-05', 'mag-13', 'mag-01', 'mag-62']) {
    const page = sample(id);
    const wrapped = renderPageHtml(page, () => 'IMG');
    const bare = fillTemplateHtml(getHtmlTemplate(id)!, page, () => 'IMG');
    assert.ok(wrapped, `${id} 渲染失败`);
    assert.equal(wrapped, bare, `${id}：无 carrier 时包装层必须是 no-op，任何一字节差异都是全站回归`);
  }
});

test('有 #pageBackground 键时，页根末尾出现该底色', () => {
  const html = renderPageHtml(sample('mag-05', { [PAGE_BACKGROUND_CARRIER_KEY]: '#F3F0A8' }), () => 'IMG')!;
  const style = /data-template="mag-05"[^>]*style="([^"]*)"/.exec(html)![1]!;
  assert.ok(style.endsWith('background-color:#F3F0A8;color:#1A1A14'), `末尾不是底色+字色：${style}`);
});

test('#pageBackground 不会被当成文字槽渲进页面内容', () => {
  const html = renderPageHtml(sample('mag-05', { [PAGE_BACKGROUND_CARRIER_KEY]: '#F3F0A8' }), () => 'IMG')!;
  assert.ok(!html.includes('>#F3F0A8<'), 'carrier 值漏进了页面文字');
});

// ───────────── 底色与页根字色成对写(最终评审 Important 2) ─────────────
// 评审实测:apply_book_style('dopamine') 之后,页根字色仍是模板写死的 #1c1b18,
// 压在橙 #C83E18 上 3.41、绿 #107E47 上 3.36、蓝 #2D6DB0 上 3.22 —— 全都低于
// 本分支自己定的 4.5 硬线。受害者是**不带 carrier** 的静态装饰(mag-10 的 1/2/3/4
// 序号用的正是 color:currentColor),它们只跟页根 color 走。
// 修在 carrier 一处:写 background-color 的同时按 bestInkFor(底色) 写成对的 color,
// 四个写工具(set_page_background / apply_book_style / set_text_colors 重烘 /
// swap_page_template 重烘)全都受益,不必逐个工具各写一遍。

/** 把 style 属性拆成 prop→value —— 不能用 includes('color:'),那会被 background-color 喂饱。 */
function declsOf(html: string): Record<string, string> {
  const style = /style="([^"]*)"/.exec(html)?.[1] ?? '';
  const out: Record<string, string> = {};
  for (const d of style.split(';')) {
    const at = d.indexOf(':');
    if (at < 0) continue;
    out[d.slice(0, at).trim().toLowerCase()] = d.slice(at + 1).trim();
  }
  return out;
}

test('写底色时成对写页根字色:深底翻浅字,对比度过 4.5', () => {
  for (const bg of ['#C83E18', '#107E47', '#2D6DB0']) {
    const decls = declsOf(applyPageBackground(ROOT, bg));
    assert.equal(decls['background-color'], bg);
    assert.equal(decls.color, bestInkFor(bg), `${bg} 的页根字色没跟着翻`);
    const ratio = contrastRatio(bg, decls.color!);
    assert.ok(ratio >= 4.5, `${bg} 上页根字色只有 ${ratio.toFixed(2)}:1`);
  }
});

test('浅底同样成对写(深字),不留模板默认值', () => {
  const decls = declsOf(applyPageBackground(ROOT, '#F3F0A8'));
  assert.equal(decls.color, bestInkFor('#F3F0A8'));
  assert.notEqual(decls.color, '#1c1b18', '模板默认字色必须被换掉');
});

test('成对的 color 排在模板自带 color 之后才盖得住;重复应用不留第二份', () => {
  const once = applyPageBackground(ROOT, '#2D6DB0');
  const style = /style="([^"]*)"/.exec(once)![1]!;
  assert.equal((style.match(/(^|;)\s*color:/g) ?? []).length, 1, '只能留一个 color 声明');
  assert.equal(applyPageBackground(once, '#2D6DB0'), once, '幂等');
  const changed = applyPageBackground(once, '#F3F0A8');
  assert.equal(declsOf(changed).color, bestInkFor('#F3F0A8'), '换底色时字色跟着换');
  assert.equal((/style="([^"]*)"/.exec(changed)![1]!.match(/(^|;)\s*color:/g) ?? []).length, 1);
});

test('页根没有 style 属性时,底色和字色一起补上', () => {
  const bare = '<div data-template="mag-05">x</div>';
  const decls = declsOf(applyPageBackground(bare, '#2D6DB0'));
  assert.equal(decls['background-color'], '#2D6DB0');
  assert.equal(decls.color, bestInkFor('#2D6DB0'));
});

test('renderPageHtml 走 carrier 时,页根字色同样成对写出来', () => {
  const html = renderPageHtml(sample('mag-10', { [PAGE_BACKGROUND_CARRIER_KEY]: '#C83E18' }), () => 'IMG')!;
  const root = /<[a-z0-9]+\b[^>]*\bdata-template="mag-10"[^>]*>/i.exec(html)![0]!;
  assert.equal(declsOf(root).color, bestInkFor('#C83E18'), 'mag-10 的序号走 currentColor,只认页根 color');
});
