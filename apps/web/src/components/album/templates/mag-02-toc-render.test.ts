import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Templates author JSX against Next's automatic runtime (no `import React`).
// Under tsx's classic JSX transform their compiled output references a global
// `React`, so expose it for this render test.
(globalThis as { React?: typeof React }).React = React;
import { adaptPageToTemplateData } from '../adapt-layout';
import { getWebTemplate } from '../web-registry';
import { getPdfTemplate } from '../pdf-registry';

// Regression for the React error #31 prod crash (2026-06-18): mag-02's repeat
// text slots (numbers/titles/descriptions) arrive as plain strings from the
// agent, which adapt-layout wraps into {body, caption} objects. The template
// used to render those objects straight as JSX children → "Objects are not
// valid as a React child" → whole page (my-albums card / editor / PDF) white
// screens. This renders mag-02 through the real web template with the wrapped
// shape and asserts it produces text instead of throwing.
test('mag-02 renders repeat text slots ({body,caption} shape) without crashing', () => {
  const data = adaptPageToTemplateData(
    {
      templateId: 'mag-02',
      images: {},
      texts: {
        'number[0]': '01',
        'title[0]': 'Beginnings',
        'description[0]': 'The first quiet mornings.',
        'number[1]': '02',
        'title[1]': 'Together',
        'description[1]': 'The faces we held close.',
      },
    },
    () => undefined,
  );

  const Template = getWebTemplate('mag-02');
  assert.ok(Template, 'mag-02 web template must resolve');

  // Pre-fix this throws React #31; the assertion is that it does NOT throw.
  const html = renderToStaticMarkup(
    createElement(Template!, { data, totalPages: 5, imagePos: {} }),
  );

  assert.match(html, /Beginnings/);
  assert.match(html, /Together/);
  assert.match(html, /The first quiet mornings\./);
  // Never leak the raw object into markup.
  assert.doesNotMatch(html, /\[object Object\]/);
});

// The PDF twin (pdf.tsx) shares the same repeat-slot bug surface and was fixed
// alongside index.tsx; render its react-pdf primitives through the same child
// validation so a future {body,caption}-as-child leak white-screens the test,
// not the editor/export.
test('mag-02 PDF variant renders repeat text slots without crashing', () => {
  const data = adaptPageToTemplateData(
    {
      templateId: 'mag-02',
      images: {},
      texts: { 'number[0]': '01', 'title[0]': 'Beginnings', 'description[0]': 'Quiet mornings.' },
    },
    () => undefined,
  );
  const Template = getPdfTemplate('mag-02');
  assert.ok(Template, 'mag-02 pdf template must resolve');
  const markup = renderToStaticMarkup(
    createElement(Template!, { data, totalPages: 5, imagePos: {} }),
  );
  assert.match(markup, /Beginnings/);
  assert.doesNotMatch(markup, /\[object Object\]/);
});

// mag-10 is the only other template with a repeat text slot (`cells`). It reads
// the scalar `.caption` today (safe), but guard against a refactor that renders
// the whole cell object as a child.
test('mag-10 renders its repeat cells slot without crashing', () => {
  const data = adaptPageToTemplateData(
    {
      templateId: 'mag-10',
      images: {},
      texts: { 'explain[0]': 'A quiet caption' },
    },
    () => undefined,
  );
  const Template = getWebTemplate('mag-10');
  assert.ok(Template, 'mag-10 web template must resolve');
  const html = renderToStaticMarkup(
    createElement(Template!, { data, totalPages: 5, imagePos: {} }),
  );
  assert.match(html, /A quiet caption/);
  assert.doesNotMatch(html, /\[object Object\]/);
});
