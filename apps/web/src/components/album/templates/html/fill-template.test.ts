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
    /data-text-key="label"[^>]*font-family:&quot;Noto Sans SC&quot;/,
    'Chinese decoration must use the decoration-role Noto Sans default',
  );
  assert.doesNotMatch(
    html,
    /data-text-key="title"[^>]*font-family:&quot;Inter&quot;/,
    'a body-only Inter carrier must not override a title slot',
  );
});
