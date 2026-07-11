// 单模板锚点 lint(M2 迁移期用):`tsx scripts/lint-one-html-template.ts mag-02`
// 直接按文件名约定动态 import,模板尚未进 registry 也能自验。
import { getTemplate } from '../src/templates';
import { lintTemplateHtml } from '../src/render/html-template-lint';

const id = process.argv[2];
if (!id) {
  console.error('用法: tsx scripts/lint-one-html-template.ts <templateId>');
  process.exit(2);
}
const tpl = getTemplate(id);
if (!tpl) {
  console.error(`未知模板 id: ${id}`);
  process.exit(2);
}

const mod = (await import(`../src/render/html-templates/${id}.ts`)) as Record<string, unknown>;
const exportName = Object.keys(mod).find((k) => k.endsWith('_HTML'));
const html = exportName ? mod[exportName] : undefined;
if (typeof html !== 'string') {
  console.error(`${id}.ts 未导出 *_HTML 字符串常量`);
  process.exit(1);
}

const errors = lintTemplateHtml(tpl, html);
if (errors.length > 0) {
  for (const err of errors) console.error(`✖ ${err}`);
  process.exit(1);
}
console.log(`✓ ${id} 锚点 lint 通过(${html.length} 字符)`);
