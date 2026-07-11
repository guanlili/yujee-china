// HTML 模板锚点完整性校验(M2 的验收器,挂在 templates:check 上)。
// HTML_TEMPLATES_REQUIRE_ALL=1 时未注册模板也算失败(M2 全量后打开)。
import { TEMPLATES } from '../src/templates';
import { getHtmlTemplate } from '../src/render/html-templates/registry';
import { lintTemplateHtml } from '../src/render/html-template-lint';

const REQUIRE_ALL = process.env.HTML_TEMPLATES_REQUIRE_ALL === '1';
let failures = 0;
let covered = 0;
for (const tpl of Object.values(TEMPLATES)) {
  const html = getHtmlTemplate(tpl.id);
  if (!html) {
    if (REQUIRE_ALL) { failures += 1; console.error(`✖ ${tpl.id}: 未注册 HTML 模板`); }
    continue;
  }
  covered += 1;
  for (const err of lintTemplateHtml(tpl, html)) { failures += 1; console.error(`✖ ${err}`); }
}
if (failures > 0) { console.error(`\nHTML 模板锚点校验失败:${failures} 处`); process.exit(1); }
console.log(`HTML 模板锚点校验通过(覆盖 ${covered}/${Object.keys(TEMPLATES).length} 个模板${REQUIRE_ALL ? ',已要求全量' : ''})`);
