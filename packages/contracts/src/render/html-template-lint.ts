// HTML 模板锚点/token 完整性 lint(check-html-templates 脚本与 M2 子代理自验共用)。
import type { TemplateDef } from '../templates';

export function lintTemplateHtml(tpl: TemplateDef, html: string): string[] {
  const errors: string[] = [];
  if (!new RegExp(`data-template="${tpl.id}"`).test(html)) {
    errors.push(`${tpl.id}: 根节点缺 data-template="${tpl.id}"`);
  }
  if (html.length > 60000) {
    errors.push(`${tpl.id}: 模板本体 ${html.length} 字符,逼近 64KB 页面上限,留不出文案余量`);
  }
  for (const slot of tpl.texts) {
    const hasToken = html.includes(`{{TEXT:${slot.id}}}`);
    const hasAnchor = html.includes(`data-text-key="${slot.id}"`);
    if (hasToken !== hasAnchor) {
      errors.push(`${tpl.id}: 文字槽 ${slot.id} 锚点与 token 不成对(anchor=${hasAnchor}, token=${hasToken})`);
    }
    if (slot.variableDecor && hasToken) {
      if (!html.includes(`{{COLOR:${slot.id}`)) errors.push(`${tpl.id}: variableDecor 槽 ${slot.id} 缺 {{COLOR:}} token`);
      if (!html.includes(`{{FONT:${slot.id}`)) errors.push(`${tpl.id}: variableDecor 槽 ${slot.id} 缺 {{FONT:}} token`);
    }
  }
  for (const slot of tpl.images) {
    if (!html.includes(`data-image-slot="${slot.id}"`)) errors.push(`${tpl.id}: 图槽 ${slot.id} 缺 data-image-slot 锚点`);
    if (!html.includes(`{{IMG_SRC:${slot.id}}}`)) errors.push(`${tpl.id}: 图槽 ${slot.id} 缺 {{IMG_SRC:}} token`);
  }
  const declared = new Set([
    ...tpl.texts.map((s) => s.id),
    ...tpl.images.map((s) => s.id),
    // items 重复组(V3 网格模板):base[i] bracket 路径寻址,基名视为已声明。
    ...(tpl.items?.texts?.map((s) => s.id) ?? []),
    ...(tpl.items?.images?.map((s) => s.id) ?? []),
  ]);
  for (const m of html.matchAll(/\{\{(?:TEXT|COLOR|FONT|IMG_SRC|IMG_POS|IMG_TF):([^}|]+)(?:\|[^}]*)?\}\}/g)) {
    const slotId = m[1]!.trim().replace(/\[\d+\]$/, '');
    if (!declared.has(slotId)) errors.push(`${tpl.id}: HTML 引用了未声明的槽 "${slotId}"`);
  }
  return errors;
}
