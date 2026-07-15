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
    // 声明了就必须渲染。曾允许「锚点和 token 一起缺」,结果攒出 13 个哑槽:
    // JSON 声明着、AI 给它写文案、页面上却一个字不显示 —— 用户付 token 买看不见的字。
    // 工作台删图层现在会级联删掉 JSON 声明(dev/template-box),所以「留声明不渲染」
    // 不再有合法场景。
    if (!hasToken || !hasAnchor) {
      errors.push(
        `${tpl.id}: 文字槽 ${slot.id} 声明了但 HTML 不渲染(anchor=${hasAnchor}, token=${hasToken})——删声明或补锚点`,
      );
    }
    if (slot.variableDecor && hasToken) {
      if (!html.includes(`{{COLOR:${slot.id}`)) errors.push(`${tpl.id}: variableDecor 槽 ${slot.id} 缺 {{COLOR:}} token`);
      if (!html.includes(`{{FONT:${slot.id}`)) errors.push(`${tpl.id}: variableDecor 槽 ${slot.id} 缺 {{FONT:}} token`);
    }
  }
  // items 重复组的文字槽:至少第 0 个实例要在 HTML 里渲染(mag-10/mag-02 先例)。
  for (const slot of tpl.items?.texts ?? []) {
    if (!html.includes(`data-text-key="${slot.id}[0]"`) || !html.includes(`{{TEXT:${slot.id}[0]}}`)) {
      errors.push(`${tpl.id}: items 文字槽 ${slot.id} 声明了但 HTML 连 ${slot.id}[0] 都不渲染`);
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
  for (const m of html.matchAll(/\{\{(?:TEXT|COLOR|FONT|IMG_SRC|IMG_POS|IMG_TF|FIT_SIZE):([^}|]+)(?:\|[^}]*)?\}\}/g)) {
    const slotId = m[1]!.trim().replace(/\[\d+\]$/, '');
    if (!declared.has(slotId)) errors.push(`${tpl.id}: HTML 引用了未声明的槽 "${slotId}"`);
  }
  return errors;
}
