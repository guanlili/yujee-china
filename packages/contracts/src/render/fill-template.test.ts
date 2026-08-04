import assert from 'node:assert/strict';
import test from 'node:test';

import { renderPageHtml } from './fill-template';

test('HTML renderer applies contract roles to CJK defaults and incompatible carriers', () => {
  const html = renderPageHtml(
    {
      templateId: 'mag-01',
      images: {},
      texts: {
        title: '春日相册',
        'title#artFont': 'inter',
        label: '序章',
        body: 'Summer 在上海',
        explain: '风吹过窗台',
      },
    },
    () => undefined,
  );

  assert.ok(html);
  assert.match(
    html,
    /data-text-key="title"[^>]*font-family:&quot;Noto Serif SC&quot;/,
    'Chinese title must use the title-role Noto Serif default',
  );
  assert.match(
    html,
    /data-text-key="label"[^>]*font-family:&quot;Zhi Mang Xing&quot;/,
    'Chinese decoration must use the decoration-role art font (三组策略:衬线/黑体/艺术字)',
  );
  assert.doesNotMatch(
    html,
    /data-text-key="title"[^>]*font-family:&quot;Inter&quot;/,
    'a body-only Inter carrier must not override a title slot',
  );
  // 模板作者可能删掉某个 explain 层（契约允许文字槽锚点+token 成对省略），
  // 所以只对 HTML 里实际渲染出来的 explain 槽断言，别写死。
  const explainSlots = ['body', 'explain'].filter((slot) =>
    html.includes(`data-text-key="${slot}"`),
  );
  assert.ok(explainSlots.length > 0, 'mag-01 至少要渲染一个正文/说明槽');
  for (const slot of explainSlots) {
    assert.match(
      html,
      new RegExp(`data-text-key="${slot}"[^>]*font-family:&quot;Noto Sans SC&quot;`),
      `${slot} must use one CJK family for the whole mixed/CJK explanation slot`,
    );
  }
});

test('TEXT token:含换行的文案包 white-space:pre-wrap 的 span(换行渲染支持)', () => {
  const html = renderPageHtml(
    {
      templateId: 'mag-01',
      images: {},
      texts: { title: '标题', body: '第一行\n第二行' },
    },
    () => undefined,
  );
  assert.ok(html);
  assert.ok(
    html.includes('<span style="white-space:pre-wrap">第一行\n第二行</span>'),
    '含换行的文案必须包 pre-wrap span,否则 \\n 被 HTML 渲染折叠成空格');
  // 单行文案不包(既有输出不变)
  assert.doesNotMatch(html, /<span style="white-space:pre-wrap">标题<\/span>/);
});
