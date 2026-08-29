// 四风格配色稿生成器:改 BOOK_STYLES 的色值后跑一次,出一张自包含 HTML 给人眼验收。
// 照片用内联 SVG 渐变占位(断网可看)。风格定义只从 @yujee/contracts/design 读,
// 不在这里硬写色值 —— 硬写就成了第二份真相源。多巴胺的每页内页色从 BOOK_STYLES
// dopamine 条目的 interiorInks(= THIRD_SET_INTERIOR)按行轮换读,同样不重复定义。
//
// 跑法:cd apps/web && npx tsx scripts/render-style-preview.mts ~/Desktop/Agent四风格配色稿.html
//
// 为什么封面/封尾也要刷 pageBackground:与成书主路径同一口径 —— assembleDesignedPages
// 把 pageBackground 刷进[封面,...内页,封尾]的每一页(design-apply.ts:applyPageBackground),
// 不是只刷内页。少刷封面/封尾会让预览把 mag-01/mag-23 的模板默认白、p01 的模板默认深底
// 当成"这个风格的样子"展示出来,那正是这次改动要解决的"四个白分不出"问题本身。
// 多巴胺的 pageBackground 是"代表色"(book-styles.ts 原话),用于封面/封尾预览与兜底。

import { writeFileSync } from 'node:fs';
import { renderPageHtml } from '@yujee/contracts/render';
import { TEMPLATES } from '@yujee/contracts';
import { BOOK_STYLES, type BookStyle } from '@yujee/contracts/design';

const INTERIORS = ['mag-05', 'mag-13', 'mag-18'];

// 断网可看:照片用内联渐变占位,不拉网图。
const FAKE = (seed: string) => {
  const h = [...seed].reduce((a, c) => a + c.charCodeAt(0), 0);
  const a = `hsl(${h % 360} 28% 62%)`, b = `hsl(${(h * 7) % 360} 24% 38%)`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="600" height="800" fill="url(#g)"/></svg>`;
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
};

type PageColors = { title: string; body: string; caption: string };

function render(templateId: string, colors: PageColors, bg: string): string {
  const tpl = (TEMPLATES as any)[templateId];
  if (!tpl) return `<div class="miss">缺 ${templateId}</div>`;
  const texts: Record<string, string> = {};
  for (const t of tpl.texts ?? []) {
    texts[t.id] = t.sample ?? '';
    const role = t.role ?? 'text';
    texts[t.id + '#accentColor'] =
      role === 'title' || role === 'decoration' ? colors.title : role === 'explain' ? colors.caption : colors.body;
  }
  const images: Record<string, string> = {};
  for (const im of tpl.images ?? []) images[im.id] = 'p-' + im.id;
  const html = renderPageHtml({ templateId, images, texts }, (pid: string) => {
    const slot = Object.entries(images).find(([, v]) => v === pid)?.[0];
    return slot ? FAKE(templateId + slot) : '';
  });
  if (!html) return `<div class="miss">${templateId} 渲染失败</div>`;
  // 与 page-html-dom.patchHtmlPageStyle 同一处真相:页根 [data-template] 的 inline background-color。
  // background-color 必须追加在 style 末尾:模板根节点写的是 background:#fff/深色 简写,
  // 前置会被它盖掉(web 的 upsertStyleAttr 用 Map 保序,新 key 天然落到末尾)。
  return html.replace(/<([a-z0-9]+)\b([^>]*\bdata-template="[^"]*"[^>]*?)>/i, (_m, tag, attrs) => {
    const st = /style="([^"]*)"/.exec(attrs);
    if (st) return `<${tag}${attrs.replace(st[0], `style="${st[1]};background-color:${bg}"`)}>`;
    return `<${tag}${attrs} style="background-color:${bg}">`;
  });
}

// 某风格某张内页的三色 + 底色:有 interiorInks(只有多巴胺)就按行轮换逐页换色,
// 其余三套整本一个底色 + 一套三色。
function interiorColorsOf(style: BookStyle, k: number): { colors: PageColors; bg: string } {
  const inks = style.interiorInks;
  if (inks && inks.length > 0) {
    const ink = inks[k % inks.length]!;
    return { colors: { title: ink.accent, body: ink.body, caption: ink.body }, bg: ink.bg };
  }
  return { colors: coverColorsOf(style), bg: style.pageBackground };
}

function coverColorsOf(style: BookStyle): PageColors {
  return { title: style.colors.title, body: style.colors.body, caption: style.colors.explain };
}

const rows = BOOK_STYLES.map((s) => {
  const coverColors = coverColorsOf(s);
  const cover = `<div class="cell"><div class="cap">封面 ${s.coverTemplateId}</div><div class="pg">${render(s.coverTemplateId, coverColors, s.pageBackground)}</div></div>`;
  const inner = INTERIORS.map((id, k) => {
    const { colors, bg } = interiorColorsOf(s, k);
    const label = s.interiorInks ? ` · ${bg}` : '';
    return `<div class="cell"><div class="cap">内页 ${id}${label}</div><div class="pg">${render(id, colors, bg)}</div></div>`;
  }).join('');
  const ending = `<div class="cell"><div class="cap">封底 ${s.endingTemplateId}</div><div class="pg">${render(s.endingTemplateId, coverColors, s.pageBackground)}</div></div>`;
  return `<section>
  <h2><b>${s.name}</b><span class="sw" style="background:${s.pageBackground}"></span><code>底 ${s.pageBackground}</code><code>标题 ${s.colors.title}</code><code>正文 ${s.colors.body}</code><code>注释 ${s.colors.explain}</code></h2>
  <p class="d">${s.mood}</p>
  <div class="row">${cover}${inner}${ending}</div></section>`;
}).join('\n');

const outPath = process.argv[2];
if (!outPath) {
  console.error('用法: npx tsx scripts/render-style-preview.mts <输出路径.html>');
  process.exit(1);
}

writeFileSync(outPath, `<!doctype html><html lang="zh"><meta charset="utf-8"><title>Agent 四风格配色稿</title><style>
*{box-sizing:border-box}
body{margin:0;background:#5c5f5e;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;padding:28px 24px 60px;color:#fff}
h1{font-size:19px;margin:0 0 6px}
.lead{font-size:13px;opacity:.75;margin:0 0 26px;line-height:1.7;max-width:840px}
section{border-top:1px solid #ffffff26;padding:20px 0 4px}
h2{font-size:15px;font-weight:500;margin:0 0 4px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
h2 b{font-size:17px}
h2 code{font-size:11px;background:#0000003d;padding:2px 6px;border-radius:3px;font-family:ui-monospace,monospace}
.sw{width:17px;height:17px;border-radius:3px;border:1px solid #ffffff4d}
.d{font-size:12px;opacity:.65;margin:0 0 12px}
.row{display:flex;gap:14px;overflow-x:auto;padding-bottom:8px}
.cell{flex:0 0 auto}
.cap{font-size:10px;opacity:.5;margin-bottom:4px;font-family:ui-monospace,monospace}
.pg{width:238px;height:337px;overflow:hidden;position:relative;box-shadow:0 2px 12px #0000004d;background:#fff}
.pg > *{transform:scale(.2998);transform-origin:top left}
.miss{color:#c00;font-size:14px;padding:12px}
</style>
<h1>设计 Agent · 四风格配色稿</h1>
<p class="lead">每一行 = Agent 可以调用的一个风格(BOOK_STYLES,实时读)。左起:封面 → 三张内页 → 封底。
多巴胺行的内页底色按 interiorInks 五色轮换,实际成书时每页独立随机抽;封面/封尾用代表色演示。
要看的是:另外三套的底色现在拉开成了「暖白 / 冷灰 / 暖砂」,不再是三张分不出的白。</p>
${rows}</html>`);
console.log('OK', outPath);
