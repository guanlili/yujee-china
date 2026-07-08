import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
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
  { templateId: 'mag-01', slotId: 'title', text: 'Heading Carrier', images: { image: 'p0' } },
  { templateId: 'mag-01', slotId: 'label', text: 'Side Carrier', images: { image: 'p0' } },
  { templateId: 'mag-02', slotId: 'number[0]', text: '42', expectedText: '42' },
  { templateId: 'mag-02', slotId: 'title[0]', text: 'Chapter Carrier' },
  { templateId: 'mag-03', slotId: 'label', text: 'Location Carrier', images: { image: 'p0' } },
  { templateId: 'mag-04', slotId: 'date', text: '44/24', expectedText: '44', images: { image1: 'p1', image2: 'p2', image3: 'p3' } },
  { templateId: 'mag-05', slotId: 'title', text: 'Title Carrier', images: { image: 'p0' } },
  { templateId: 'mag-05', slotId: 'label', text: 'Top Right Carrier', images: { image: 'p0' } },
  { templateId: 'mag-07', slotId: 'title', text: 'Title Carrier', images: { image1: 'p0', image2: 'p1' } },
  { templateId: 'mag-08', slotId: 'date', text: '88/24', expectedText: '88', images: { image: 'p0' } },
  { templateId: 'mag-08', slotId: 'title', text: 'Title Carrier', images: { image: 'p0' } },
  { templateId: 'mag-09', slotId: 'title', text: 'Title Carrier', images: { image1: 'p0', image2: 'p1' } },
  { templateId: 'mag-11', slotId: 'title', text: 'Title Carrier', images: { image: 'p0' } },
  { templateId: 'mag-11', slotId: 'label', text: 'Plate Carrier', images: { image: 'p0' } },
  {
    templateId: 'mag-13',
    slotId: 'title',
    text: 'Title Carrier',
    images: { image: 'p0' },
    extraTexts: { divider: '#112233' },
  },
  { templateId: 'mag-15', slotId: 'title', text: 'Title Carrier', images: { image1: 'p0', image2: 'p1' } },
  { templateId: 'mag-15', slotId: 'date', text: 'Date Carrier', images: { image1: 'p0', image2: 'p1' } },
  { templateId: 'mag-19', slotId: 'title', text: 'Intro Carrier', images: { image: 'p0' } },
  { templateId: 'p01', slotId: 'title', text: 'Title Carrier', images: { image: 'p0' } },
  { templateId: 'p01', slotId: 'label1', text: 'Category Carrier', images: { image: 'p0' } },
  { templateId: 'p01', slotId: 'label2', text: '77', images: { image: 'p0' } },
  { templateId: 'p01', slotId: 'date', text: '2030', images: { image: 'p0' } },
];

const PDF_TEXT_CARRIER_SLOTS: Record<string, string[]> = {
  'mag-01': ['title', 'label'],
  'mag-02': ['title', 'number[${i}]', 'title[${i}]'],
  'mag-03': ['label'],
  'mag-04': ['date'],
  'mag-05': ['title', 'label'],
  'mag-07': ['title'],
  'mag-08': ['date', 'title'],
  'mag-09': ['title'],
  'mag-11': ['title', 'label'],
  'mag-13': ['title'],
  'mag-15': ['title', 'date'],
  'mag-19': ['title'],
  p01: ['title', 'label1', 'label2', 'date'],
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
        'label#accentColor': '#C0392B',
        'label#artFont': 'sans-modern',
      },
    },
    (photoId) => `/photos/${photoId}.jpg`,
  );
  const Template = getWebTemplate('mag-03');
  assert.ok(Template, 'mag-03 web template must resolve');

  const html = renderToStaticMarkup(createElement(Template!, { data, totalPages: 5, imagePos: {} }));

  assert.match(html, /color:#C0392B/);
  assert.doesNotMatch(html, />#C0392B</);
  assert.doesNotMatch(html, /label#accentColor/);
});

test('resolveThemeCarrier reads repeat-slot carriers without clobbering repeat text', () => {
  const data = adaptPageToTemplateData(
    {
      templateId: 'mag-02',
      images: {},
      texts: {
        'number[0]': '01',
        'number[0]#accentColor': '#C0392B',
        'number[0]#artFont': 'sans-modern',
      },
    },
    () => undefined,
  );

  const carrier = resolveThemeCarrier(data, 'number[0]');
  assert.equal(carrier.accentColor, '#C0392B');
  assert.equal(carrier.webFontFamily, '"Inter", "Noto Sans SC", "PingFang SC", sans-serif');
  assert.deepEqual(data.number, ['01']);
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

test('mag-02 web resolves repeat title carriers per row', () => {
  const data = adaptPageToTemplateData(
    {
      templateId: 'mag-02',
      images: {},
      texts: {
        'title[0]': 'First Row',
        'title[0]#accentColor': '#111111',
        'title[0]#artFont': 'sans-modern',
        'title[1]': 'Second Row',
        'title[1]#accentColor': '#C0392B',
        'title[1]#artFont': 'display-bold',
      },
    },
    () => undefined,
  );
  const Template = getWebTemplate('mag-02');
  assert.ok(Template, 'mag-02 web template must resolve');

  const html = renderToStaticMarkup(createElement(Template!, { data, totalPages: 5, imagePos: {} }));

  assert.match(html, />Second Row</);
  assert.match(html, /color:#C0392B/);
  assert.match(html, new RegExp(escapeRegExp(DISPLAY_BOLD_WEB_FONT_NEEDLE)));
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

// variableDecor 门控已废弃：所有文字槽都按角色接受配色 carrier（set_text_colors 一键刷）。
// 下面这条通用一致性测试守着新铁律——每个被渲染的文字槽都必须 resolveThemeCarrier，
// 不允许写死 color 而无视 carrier。它是全量模板配色改造的工单与安全网。

const CONTRACTS_TEMPLATES_DIR = new URL(
  '../../../../../../packages/contracts/templates/',
  import.meta.url,
);

interface TemplateTextSlot {
  base: string;
  repeat: boolean;
  role: string;
}

function readTemplateTextSlots(templateId: string): TemplateTextSlot[] {
  const raw = JSON.parse(
    readFileSync(new URL(`${templateId}.json`, CONTRACTS_TEMPLATES_DIR), 'utf8'),
  ) as {
    texts?: { id?: string; role?: string }[];
    items?: { texts?: { id?: string; role?: string }[] };
  };
  const slots: TemplateTextSlot[] = [];
  for (const s of raw.texts ?? []) {
    if (s?.id) slots.push({ base: s.id, repeat: false, role: s.role ?? 'text' });
  }
  for (const s of raw.items?.texts ?? []) {
    if (s?.id) slots.push({ base: s.id, repeat: true, role: s.role ?? 'text' });
  }
  return slots;
}

function listTemplateIds(): string[] {
  return readdirSync(new URL('.', import.meta.url), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'html')
    .map((entry) => entry.name)
    .sort();
}

// 源码是否把该槽当数据渲染（heuristic：出现 d.base / data.base / data['base'] / data[`base）。
function referencesSlot(source: string, base: string): boolean {
  const b = escapeRegExp(base);
  return new RegExp(`\\b(?:d|data)(?:\\.${b}\\b|\\[['"\`]${b}\\b)`).test(source);
}

// 源码是否为该槽解析了主题 carrier（普通槽用引号名，重复槽用反引号 base[ 形式）。
function resolvesCarrier(source: string, slot: TemplateTextSlot): boolean {
  const b = escapeRegExp(slot.base);
  const pattern = slot.repeat
    ? new RegExp(`resolveThemeCarrier\\(\\s*data\\s*,\\s*\`${b}\\[`)
    : new RegExp(`resolveThemeCarrier\\(\\s*data\\s*,\\s*['"]${b}['"]\\s*\\)`);
  return pattern.test(source);
}

test('every rendered text slot consumes its accent carrier (web + pdf)', () => {
  const missing: string[] = [];
  for (const templateId of listTemplateIds()) {
    let slots: TemplateTextSlot[];
    try {
      slots = readTemplateTextSlots(templateId);
    } catch {
      continue; // 无对应 contracts JSON 的目录跳过。
    }
    for (const renderer of ['index.tsx', 'pdf.tsx'] as const) {
      let source: string;
      try {
        source = readFileSync(new URL(`./${templateId}/${renderer}`, import.meta.url), 'utf8');
      } catch {
        continue;
      }
      for (const slot of slots) {
        if (!referencesSlot(source, slot.base)) continue;
        if (!resolvesCarrier(source, slot)) {
          missing.push(`${templateId}/${renderer} :: ${slot.base}${slot.repeat ? '[n]' : ''} (role=${slot.role})`);
        }
      }
    }
  }
  assert.deepEqual(
    missing,
    [],
    `这些文字槽写死了颜色、没有 resolveThemeCarrier（需接入 set_text_colors 配色）：\n${missing.join('\n')}`,
  );
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
    { templateId: 'mag-11', themeVar: 'labelTheme', dataProp: 'label' },
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
