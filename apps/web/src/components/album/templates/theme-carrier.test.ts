import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as React from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as { React?: typeof React }).React = React;

import { adaptPageToTemplateData } from '../adapt-layout';
import { getWebTemplate } from '../web-registry';
import { resolveThemeCarrier } from './theme-carrier';

const DISPLAY_BOLD_WEB_FONT_NEEDLE = 'Bebas Neue';

interface TextCarrierRenderCase {
  templateId: string;
  slotId: string;
  text: string;
  images?: Record<string, string>;
  extraTexts?: Record<string, string>;
  expectedText?: string;
}

const TEXT_CARRIER_RENDER_CASES: TextCarrierRenderCase[] = [
  { templateId: 'mag-01', slotId: 'heading', text: 'Heading Carrier', images: { image: 'p0' } },
  { templateId: 'mag-01', slotId: 'sideText', text: 'Side Carrier', images: { image: 'p0' } },
  { templateId: 'mag-02', slotId: 'heading', text: 'Contents Carrier' },
  { templateId: 'mag-02', slotId: 'numbers[0]', text: '42', expectedText: '42' },
  { templateId: 'mag-02', slotId: 'titles[0]', text: 'Chapter Carrier' },
  { templateId: 'mag-03', slotId: 'location', text: 'Location Carrier', images: { image: 'p0' } },
  { templateId: 'mag-04', slotId: 'dateNum', text: '44/24', expectedText: '44', images: { image1: 'p1', image2: 'p2', image3: 'p3' } },
  { templateId: 'mag-05', slotId: 'title', text: 'Title Carrier', images: { image: 'p0' } },
  { templateId: 'mag-05', slotId: 'topRight', text: 'Top Right Carrier', images: { image: 'p0' } },
  { templateId: 'mag-07', slotId: 'title', text: 'Title Carrier', images: { imageTop: 'p0', imageMain: 'p1' } },
  { templateId: 'mag-08', slotId: 'dateNum', text: '88/24', expectedText: '88', images: { image: 'p0' } },
  { templateId: 'mag-08', slotId: 'title', text: 'Title Carrier', images: { image: 'p0' } },
  { templateId: 'mag-09', slotId: 'title', text: 'Title Carrier', images: { imageTop: 'p0', imageMain: 'p1' } },
  { templateId: 'mag-11', slotId: 'title', text: 'Title Carrier', images: { image: 'p0' } },
  { templateId: 'mag-11', slotId: 'plate', text: 'Plate Carrier', images: { image: 'p0' } },
  {
    templateId: 'mag-13',
    slotId: 'title',
    text: 'Title Carrier',
    images: { image: 'p0' },
    extraTexts: { divider: '#112233' },
  },
  { templateId: 'mag-15', slotId: 'title', text: 'Title Carrier', images: { imagePerson: 'p0', imageRoad: 'p1' } },
  { templateId: 'mag-15', slotId: 'date', text: 'Date Carrier', images: { imagePerson: 'p0', imageRoad: 'p1' } },
  { templateId: 'mag-19', slotId: 'intro', text: 'Intro Carrier', images: { image: 'p0' } },
  { templateId: 'p01', slotId: 'title', text: 'Title Carrier', images: { image: 'p0' } },
  { templateId: 'p01', slotId: 'category', text: 'Category Carrier', images: { image: 'p0' } },
  { templateId: 'p01', slotId: 'vol', text: '77', images: { image: 'p0' } },
  { templateId: 'p01', slotId: 'date', text: '2030', images: { image: 'p0' } },
];

const PDF_TEXT_CARRIER_SLOTS: Record<string, string[]> = {
  'mag-01': ['heading', 'sideText'],
  'mag-02': ['heading', 'numbers[${i}]', 'titles[${i}]'],
  'mag-03': ['location'],
  'mag-04': ['dateNum'],
  'mag-05': ['title', 'topRight'],
  'mag-07': ['title'],
  'mag-08': ['dateNum', 'title'],
  'mag-09': ['title'],
  'mag-11': ['title', 'plate'],
  'mag-13': ['title'],
  'mag-15': ['title', 'date'],
  'mag-19': ['intro'],
  p01: ['title', 'category', 'vol', 'date'],
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function carrierKey(slotId: string, suffix: '#accentColor' | '#artFont'): string {
  return `${slotId}${suffix}`;
}

function accentColorFor(index: number): string {
  return `#C${String(index + 1).padStart(5, '0')}`;
}

test('resolveThemeCarrier returns sibling accent/font without changing base text', () => {
  const data = adaptPageToTemplateData(
    {
      templateId: 'mag-08',
      images: { image: 'p0' },
      texts: {
        title: 'Homecoming',
        'title#accentColor': '#C0392B',
        'title#artFont': 'serif-classic',
      },
    },
    (photoId) => `/photos/${photoId}.jpg`,
  );

  const carrier = resolveThemeCarrier(data, 'title');
  assert.equal(data.title, 'Homecoming');
  assert.equal(carrier.text, 'Homecoming');
  assert.equal(carrier.accentColor, '#C0392B');
  assert.equal(carrier.webFontFamily, '"EB Garamond", "Noto Serif SC", "Songti SC", serif');
});

test('mag-03 consumes location carrier as style without rendering raw color text', () => {
  const data = adaptPageToTemplateData(
    {
      templateId: 'mag-03',
      images: { image: 'p0' },
      texts: {
        'location#accentColor': '#C0392B',
        'location#artFont': 'sans-modern',
      },
    },
    (photoId) => `/photos/${photoId}.jpg`,
  );
  const Template = getWebTemplate('mag-03');
  assert.ok(Template, 'mag-03 web template must resolve');

  const html = renderToStaticMarkup(createElement(Template!, { data, totalPages: 5, imagePos: {} }));

  assert.match(html, /color:#C0392B/);
  assert.doesNotMatch(html, />#C0392B</);
  assert.doesNotMatch(html, /location#accentColor/);
});

test('resolveThemeCarrier reads repeat-slot carriers without clobbering repeat text', () => {
  const data = adaptPageToTemplateData(
    {
      templateId: 'mag-02',
      images: {},
      texts: {
        'numbers[0]': '01',
        'numbers[0]#accentColor': '#C0392B',
        'numbers[0]#artFont': 'sans-modern',
      },
    },
    () => undefined,
  );

  const carrier = resolveThemeCarrier(data, 'numbers[0]');
  assert.equal(carrier.accentColor, '#C0392B');
  assert.equal(carrier.webFontFamily, '"Inter", "Noto Sans SC", "PingFang SC", sans-serif');
  assert.deepEqual(data.numbers, [{ body: '01', caption: '01' }]);
});

test('mag-08 consumes title carrier while preserving title text', () => {
  const data = adaptPageToTemplateData(
    {
      templateId: 'mag-08',
      images: { image: 'p0' },
      texts: {
        title: 'Homecoming',
        'title#accentColor': '#C0392B',
        'title#artFont': 'display-bold',
      },
    },
    (photoId) => `/photos/${photoId}.jpg`,
  );
  const Template = getWebTemplate('mag-08');
  assert.ok(Template, 'mag-08 web template must resolve');

  const html = renderToStaticMarkup(createElement(Template!, { data, totalPages: 5, imagePos: {} }));

  assert.match(html, />Homecoming</);
  assert.match(html, /color:#C0392B/);
  assert.doesNotMatch(html, />#C0392B</);
  assert.doesNotMatch(html, /title#accentColor/);
});

test('web templates consume every text variableDecor carrier as style only', () => {
  for (const [index, renderCase] of TEXT_CARRIER_RENDER_CASES.entries()) {
    const accentColor = accentColorFor(index);
    const data = adaptPageToTemplateData(
      {
        templateId: renderCase.templateId,
        images: renderCase.images ?? {},
        texts: {
          ...(renderCase.extraTexts ?? {}),
          [renderCase.slotId]: renderCase.text,
          [carrierKey(renderCase.slotId, '#accentColor')]: accentColor,
          [carrierKey(renderCase.slotId, '#artFont')]: 'display-bold',
        },
      },
      (photoId) => `/photos/${photoId}.jpg`,
    );
    const Template = getWebTemplate(renderCase.templateId);
    assert.ok(Template, `${renderCase.templateId} web template must resolve`);

    const html = renderToStaticMarkup(createElement(Template!, { data, totalPages: 5, imagePos: {} }));

    const label = `${renderCase.templateId}.${renderCase.slotId}`;
    assert.match(
      html,
      new RegExp(escapeRegExp(renderCase.expectedText ?? renderCase.text)),
      `${label} should preserve slot text`,
    );
    assert.match(
      html,
      new RegExp(`color:${escapeRegExp(accentColor)}`, 'i'),
      `${label} should apply carrier accent color`,
    );
    assert.match(
      html,
      new RegExp(escapeRegExp(DISPLAY_BOLD_WEB_FONT_NEEDLE)),
      `${label} should apply carrier art font`,
    );
    assert.doesNotMatch(
      html,
      new RegExp(`>${escapeRegExp(accentColor)}<`),
      `${label} should not render raw accent carrier text`,
    );
    assert.doesNotMatch(
      html,
      />display-bold</,
      `${label} should not render raw art font carrier text`,
    );

    if (renderCase.templateId === 'mag-13') {
      assert.match(html, /background-color:#112233/, 'mag-13 divider should remain value-as-color');
    }
  }
});

test('web templates ignore carriers for non-variableDecor text slots', () => {
  const data = adaptPageToTemplateData(
    {
      templateId: 'p01',
      images: { image: 'p0' },
      texts: {
        body: 'Body copy is not variable decor.',
        'body#accentColor': '#0BAD0B',
        'body#artFont': 'display-bold',
      },
    },
    (photoId) => `/photos/${photoId}.jpg`,
  );
  const Template = getWebTemplate('p01');
  assert.ok(Template, 'p01 web template must resolve');

  const html = renderToStaticMarkup(createElement(Template!, { data, totalPages: 5, imagePos: {} }));

  assert.match(html, /Body copy is not variable decor\./);
  assert.doesNotMatch(html, /#0BAD0B/);
  assert.doesNotMatch(html, new RegExp(escapeRegExp(DISPLAY_BOLD_WEB_FONT_NEEDLE)));
});

test('PDF templates resolve every text variableDecor carrier in source', () => {
  for (const [templateId, slots] of Object.entries(PDF_TEXT_CARRIER_SLOTS)) {
    const source = readFileSync(new URL(`./${templateId}/pdf.tsx`, import.meta.url), 'utf8');
    for (const slotId of slots) {
      const pattern = slotId.includes('${i}')
        ? new RegExp(`resolveThemeCarrier\\(data,\\s*\`${escapeRegExp(slotId)}\`\\)`)
        : new RegExp(`resolveThemeCarrier\\(data,\\s*['"]${escapeRegExp(slotId)}['"]\\)`);
      assert.match(source, pattern, `${templateId}.pdf should resolve carrier for ${slotId}`);
    }
  }
});

test('PDF templates uppercase carrier text for decoration slots in source', () => {
  const cases = [
    { templateId: 'mag-11', themeVar: 'plateTheme', dataProp: 'plate' },
    { templateId: 'mag-15', themeVar: 'dateTheme', dataProp: 'date' },
  ];

  for (const renderCase of cases) {
    const source = readFileSync(new URL(`./${renderCase.templateId}/pdf.tsx`, import.meta.url), 'utf8');
    const pattern = new RegExp(
      `\\(${renderCase.themeVar}\\.text\\s*\\?\\?\\s*d\\.${renderCase.dataProp}\\s*\\?\\?\\s*''\\)\\.toUpperCase\\(\\)`,
    );
    assert.match(
      source,
      pattern,
      `${renderCase.templateId}.pdf should uppercase ${renderCase.dataProp} carrier/base text`,
    );
  }
});
