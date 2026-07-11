// HTML 模板锚点完整性校验(M2 的验收器,挂在 templates:check 上)。
// 对 registry 里每个模板断言:模板 JSON 声明的每个槽位在 HTML 里有对应锚点与 token,
// 根节点 data-template 与 id 一致,无未注册模板残留 token。
// 全部 48 个模板注册后,再打开 REQUIRE_ALL 让"缺模板"也算失败(见 M2 收尾)。
import { TEMPLATES } from '../src/templates';

import { getHtmlTemplate } from '../src/render/html-templates/registry';

const REQUIRE_ALL = process.env.HTML_TEMPLATES_REQUIRE_ALL === '1';

let failures = 0;
const fail = (msg: string) => {
  failures += 1;
  console.error(`✖ ${msg}`);
};

let covered = 0;
for (const tpl of Object.values(TEMPLATES)) {
  const html = getHtmlTemplate(tpl.id);
  if (!html) {
    if (REQUIRE_ALL) fail(`${tpl.id}: 未注册 HTML 模板`);
    continue;
  }
  covered += 1;

  if (!new RegExp(`data-template="${tpl.id}"`).test(html)) {
    fail(`${tpl.id}: 根节点缺 data-template="${tpl.id}"`);
  }
  if (html.length > 60000) {
    fail(`${tpl.id}: 模板本体 ${html.length} 字符,逼近 64KB 页面上限,留不出文案余量`);
  }

  for (const slot of tpl.texts) {
    // folio 等个别槽在具体模板可以选择不渲染(与 React 版一致);但渲染了就必须带锚点。
    const hasToken = html.includes(`{{TEXT:${slot.id}}}`);
    const hasAnchor = html.includes(`data-text-key="${slot.id}"`);
    if (hasToken !== hasAnchor) {
      fail(`${tpl.id}: 文字槽 ${slot.id} 锚点与 token 不成对(anchor=${hasAnchor}, token=${hasToken})`);
    }
    if (slot.variableDecor && hasToken) {
      if (!html.includes(`{{COLOR:${slot.id}`)) fail(`${tpl.id}: variableDecor 槽 ${slot.id} 缺 {{COLOR:}} token`);
      if (!html.includes(`{{FONT:${slot.id}`)) fail(`${tpl.id}: variableDecor 槽 ${slot.id} 缺 {{FONT:}} token`);
    }
  }

  for (const slot of tpl.images) {
    if (!html.includes(`data-image-slot="${slot.id}"`)) {
      fail(`${tpl.id}: 图槽 ${slot.id} 缺 data-image-slot 锚点`);
    }
    if (!html.includes(`{{IMG_SRC:${slot.id}}}`)) {
      fail(`${tpl.id}: 图槽 ${slot.id} 缺 {{IMG_SRC:}} token`);
    }
  }

  // 反向:HTML 里引用的槽必须是模板声明过的
  const declared = new Set([...tpl.texts.map((s) => s.id), ...tpl.images.map((s) => s.id)]);
  for (const m of html.matchAll(/\{\{(?:TEXT|COLOR|FONT|IMG_SRC|IMG_POS|IMG_TF):([^}|]+)(?:\|[^}]*)?\}\}/g)) {
    const slotId = m[1]!.trim().replace(/\[\d+\]$/, '');
    if (!declared.has(slotId)) fail(`${tpl.id}: HTML 引用了未声明的槽 "${slotId}"`);
  }
}

if (failures > 0) {
  console.error(`\nHTML 模板锚点校验失败:${failures} 处`);
  process.exit(1);
}
console.log(`HTML 模板锚点校验通过(覆盖 ${covered}/${Object.keys(TEMPLATES).length} 个模板${REQUIRE_ALL ? ',已要求全量' : ''})`);
