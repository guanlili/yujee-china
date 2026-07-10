import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Text as PdfText } from '@react-pdf/renderer';
import * as React from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as { React?: typeof React }).React = React;

import { adaptPageToTemplateData } from '../adapt-layout';
import { getPdfTemplate, PDF_TEMPLATE_REGISTRY } from '../pdf-registry';
import { getWebTemplate } from '../web-registry';
import { PDF_FONTS } from './constants';
import { FONT_CATALOG, type AlbumTextRole } from './font-catalog';
import { resolveThemeCarrier } from './theme-carrier';
import type { TemplateData } from './types';

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

test('resolveThemeCarrier defaults each role by the slot text language', () => {
  const cases = [
    {
      role: 'title' as const,
      text: '我们的夏天',
      webFontFamily: '"Noto Serif SC", "Source Han Serif SC", "Songti SC", serif',
      pdfFontFamily: 'NotoSerifSC',
    },
    {
      role: 'body' as const,
      text: '风从海上来。',
      webFontFamily: '"Noto Sans SC", "PingFang SC", "Heiti SC", sans-serif',
      pdfFontFamily: 'NotoSansSC',
    },
    {
      role: 'explain' as const,
      text: '拍摄于上海',
      webFontFamily: '"Noto Sans SC", "PingFang SC", "Heiti SC", sans-serif',
      pdfFontFamily: 'NotoSansSC',
    },
    {
      role: 'decoration' as const,
      text: '第一章',
      webFontFamily: '"Noto Sans SC", "PingFang SC", "Heiti SC", sans-serif',
      pdfFontFamily: 'NotoSansSC',
    },
    {
      role: 'title' as const,
      text: 'A Summer Together',
      webFontFamily: '"Playfair Display", "Noto Serif SC", "Songti SC", serif',
      pdfFontFamily: 'Playfair Display',
    },
    {
      role: 'body' as const,
      text: 'The wind came in from the sea.',
      webFontFamily: '"Inter", "Noto Sans SC", "PingFang SC", sans-serif',
      pdfFontFamily: 'Inter',
    },
    {
      role: 'explain' as const,
      text: 'Photographed in Shanghai',
      webFontFamily: '"Inter", "Noto Sans SC", "PingFang SC", sans-serif',
      pdfFontFamily: 'Inter',
    },
    {
      role: 'decoration' as const,
      text: 'CHAPTER ONE',
      webFontFamily: '"Inter", "Noto Sans SC", "PingFang SC", sans-serif',
      pdfFontFamily: 'Inter',
    },
  ];

  for (const renderCase of cases) {
    const carrier = resolveThemeCarrier({ title: renderCase.text }, 'title', renderCase.role);
    assert.equal(carrier.text, renderCase.text);
    assert.equal(carrier.webFontFamily, renderCase.webFontFamily);
    assert.equal(carrier.pdfFontFamily, renderCase.pdfFontFamily);
  }
});

test('resolveThemeCarrier lets an explicit role-compatible font render English text', () => {
  const carrier = resolveThemeCarrier(
    {
      body: 'A quiet morning',
      'body#accentColor': '#C0392B',
      'body#artFont': 'lora',
    },
    'body',
    'body',
  );

  assert.equal(carrier.text, 'A quiet morning');
  assert.equal(carrier.accentColor, '#C0392B');
  assert.equal(carrier.artFont, 'lora');
  assert.equal(carrier.webFontFamily, '"Lora", "Noto Serif SC", "Songti SC", serif');
  assert.equal(carrier.pdfFontFamily, 'Lora');
});

test('resolveThemeCarrier ignores an explicit font that is incompatible with the role', () => {
  const carrier = resolveThemeCarrier(
    { title: 'Homecoming', 'title#artFont': 'inter' },
    'title',
    'title',
  );

  assert.equal(carrier.artFont, 'inter');
  assert.equal(carrier.webFontFamily, '"Playfair Display", "Noto Serif SC", "Songti SC", serif');
  assert.equal(carrier.pdfFontFamily, 'Playfair Display');
});

test('resolveThemeCarrier falls back from English-only fonts for Chinese and mixed text', () => {
  const chineseTitle = resolveThemeCarrier(
    { title: '归家', 'title#artFont': 'playfair-display' },
    'title',
    'title',
  );
  const mixedBody = resolveThemeCarrier(
    { body: 'Summer 在上海', 'body#artFont': 'lora' },
    'body',
    'body',
  );

  assert.equal(chineseTitle.webFontFamily, '"Noto Serif SC", "Source Han Serif SC", "Songti SC", serif');
  assert.equal(chineseTitle.pdfFontFamily, 'NotoSerifSC');
  assert.equal(mixedBody.webFontFamily, '"Noto Sans SC", "PingFang SC", "Heiti SC", sans-serif');
  assert.equal(mixedBody.pdfFontFamily, 'NotoSansSC');
});

test('resolveThemeCarrier falls back from an English title font for Kana-only Japanese', () => {
  const resolvedFamilies = ['なつのおもいで', 'ナツノオモイデ'].map((text) => {
    const carrier = resolveThemeCarrier(
      { title: text, 'title#artFont': 'playfair-display' },
      'title',
      'title',
    );
    return [carrier.webFontFamily, carrier.pdfFontFamily];
  });

  assert.deepEqual(resolvedFamilies, [
    ['"Noto Serif SC", "Source Han Serif SC", "Songti SC", serif', 'NotoSerifSC'],
    ['"Noto Serif SC", "Source Han Serif SC", "Songti SC", serif', 'NotoSerifSC'],
  ]);
});

test('resolveThemeCarrier falls back from an English title font for Hangul-only Korean', () => {
  const carrier = resolveThemeCarrier(
    { title: '우리의 여름', 'title#artFont': 'playfair-display' },
    'title',
    'title',
  );

  assert.equal(carrier.webFontFamily, '"Noto Serif SC", "Source Han Serif SC", "Songti SC", serif');
  assert.equal(carrier.pdfFontFamily, 'NotoSerifSC');
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
    : new RegExp(
        `resolveThemeCarrier\\(\\s*data\\s*,\\s*['"]${b}['"](?:\\s*,\\s*['"](?:title|body|explain|decoration)['"])?\\s*\\)`,
      );
  return pattern.test(source);
}

interface ResolvedCarrierDeclaration {
  themeVar: string;
  role?: string;
}

function resolvedCarrierDeclaration(
  source: string,
  slot: TemplateTextSlot,
): ResolvedCarrierDeclaration | undefined {
  const b = escapeRegExp(slot.base);
  const pattern = slot.repeat
    ? new RegExp(
        'const\\s+(\\w+)\\s*=\\s*resolveThemeCarrier\\(\\s*data\\s*,\\s*`'
          + b
          + '\\[\\$\\{[^}]+\\}\\]`(?:\\s*,\\s*[\'\"]([^\'\"]+)[\'\"])?\\s*\\)',
      )
    : new RegExp(
        `const\\s+(\\w+)\\s*=\\s*resolveThemeCarrier\\(\\s*data\\s*,\\s*['"]${b}['"](?:\\s*,\\s*['"]([^'"]+)['"])?\\s*\\)`,
      );
  const match = pattern.exec(source);
  return match ? { themeVar: match[1]!, role: match[2] } : undefined;
}

interface ExpandedPdfNode {
  type: unknown;
  props: Record<string, unknown>;
  children: ExpandedPdfNode[];
  text?: string;
}

function expandPdfTree(value: React.ReactNode): ExpandedPdfNode[] {
  if (value === null || value === undefined || typeof value === 'boolean') return [];
  if (Array.isArray(value)) return value.flatMap(expandPdfTree);
  if (typeof value === 'string' || typeof value === 'number') {
    return [{ type: '#text', props: {}, children: [], text: String(value) }];
  }
  if (!React.isValidElement(value)) return [];

  const element = value as React.ReactElement<Record<string, unknown>>;
  if (typeof element.type === 'function') {
    const render = element.type as (props: Record<string, unknown>) => React.ReactNode;
    return expandPdfTree(render(element.props));
  }

  return [{
    type: element.type,
    props: element.props,
    children: expandPdfTree(element.props.children as React.ReactNode),
  }];
}

function pdfNodeText(node: ExpandedPdfNode): string {
  return node.text ?? node.children.map(pdfNodeText).join('');
}

function normalizedPdfNodeText(node: ExpandedPdfNode): string {
  return pdfNodeText(node).replace(/\s+/g, '');
}

function allPdfTextNodes(nodes: ExpandedPdfNode[]): ExpandedPdfNode[] {
  const found: ExpandedPdfNode[] = [];
  for (const node of nodes) {
    if (node.type === PdfText) found.push(node);
    found.push(...allPdfTextNodes(node.children));
  }
  return found;
}

function deepestPdfTextNodesContaining(
  nodes: ExpandedPdfNode[],
  marker: string,
): ExpandedPdfNode[] {
  return allPdfTextNodes(nodes).filter((node) => (
    normalizedPdfNodeText(node).includes(marker)
    && !allPdfTextNodes(node.children).some((child) => normalizedPdfNodeText(child).includes(marker))
  ));
}

function findPdfParent(
  nodes: ExpandedPdfNode[],
  target: ExpandedPdfNode,
): ExpandedPdfNode | undefined {
  for (const node of nodes) {
    if (node.children.includes(target)) return node;
    const parent = findPdfParent(node.children, target);
    if (parent) return parent;
  }
  return undefined;
}

function pdfNodeFontFamily(node: ExpandedPdfNode): unknown {
  const style = node.props.style;
  const styles = Array.isArray(style) ? style : [style];
  let fontFamily: unknown;
  for (const entry of styles) {
    if (typeof entry === 'object' && entry !== null && 'fontFamily' in entry) {
      fontFamily = (entry as { fontFamily?: unknown }).fontFamily;
    }
  }
  return fontFamily;
}

interface PdfSentinelCase {
  slotId: string;
  role: AlbumTextRole;
  marker: string;
  expectedFontFamily: string;
}

function buildPdfSentinelData(
  templateId: string,
  slots: TemplateTextSlot[],
): { data: TemplateData; cases: PdfSentinelCase[] } {
  const texts: Record<string, string> = {};
  const usedFamilies = new Set<string>();
  const cases: PdfSentinelCase[] = [];

  for (const slot of slots) {
    const role = slot.role as AlbumTextRole;
    const candidate = Object.entries(FONT_CATALOG).find(([, entry]) => (
      (entry.roles as readonly AlbumTextRole[]).includes(role)
      && !usedFamilies.has(entry.pdfFontFamily)
    ));
    assert.ok(candidate, `${templateId}.${slot.base} needs a distinct compatible PDF font`);

    const slotId = slot.repeat ? `${slot.base}[0]` : slot.base;
    const marker = `PDFMARKER_${templateId}_${slotId}`.replace(/[^A-Z0-9_]/gi, '_').toUpperCase();
    texts[slotId] = `X${marker}`;
    texts[`${slotId}#artFont`] = candidate[0];
    usedFamilies.add(candidate[1].pdfFontFamily);
  }

  const data = adaptPageToTemplateData(
    { templateId, images: {}, texts },
    () => undefined,
  );
  for (const slot of slots) {
    const slotId = slot.repeat ? `${slot.base}[0]` : slot.base;
    const marker = `PDFMARKER_${templateId}_${slotId}`.replace(/[^A-Z0-9_]/gi, '_').toUpperCase();
    const expectedFontFamily = resolveThemeCarrier(
      data,
      slotId,
      slot.role as AlbumTextRole,
    ).pdfFontFamily;
    assert.ok(expectedFontFamily, `${templateId}.${slotId} must resolve a PDF font`);
    cases.push({
      slotId,
      role: slot.role as AlbumTextRole,
      marker,
      expectedFontFamily,
    });
  }

  return { data, cases };
}

function groupPdfSlotsWithoutBaseCollisions(slots: TemplateTextSlot[]): TemplateTextSlot[][] {
  const groups: TemplateTextSlot[][] = [];
  for (const slot of slots) {
    let group = groups.find((candidate) => !candidate.some((item) => item.base === slot.base));
    if (!group) {
      group = [];
      groups.push(group);
    }
    group.push(slot);
  }
  return groups.length > 0 ? groups : [[]];
}

test('every Web text carrier resolves its contract role and applies its resolved font', () => {
  const missing: string[] = [];

  for (const templateId of listTemplateIds()) {
    let slots: TemplateTextSlot[];
    let source: string;
    try {
      slots = readTemplateTextSlots(templateId);
      source = readFileSync(new URL(`./${templateId}/index.tsx`, import.meta.url), 'utf8');
    } catch {
      continue;
    }

    for (const slot of slots) {
      if (!referencesSlot(source, slot.base)) continue;
      const renderedSlot = `${slot.base}${slot.repeat ? '[n]' : ''}`;
      const declaration = resolvedCarrierDeclaration(source, slot);
      if (!declaration) {
        missing.push(`${templateId}/index.tsx :: ${renderedSlot} missing theme resolver`);
        continue;
      }

      const label = `${templateId}/index.tsx :: ${renderedSlot} (${declaration.themeVar})`;
      if (declaration.role !== slot.role) {
        missing.push(
          `${label} resolves role=${declaration.role ?? '<missing>'}; expected role=${slot.role}`,
        );
      }
      if (!new RegExp(`\\b${escapeRegExp(declaration.themeVar)}\\.webFontFamily\\b`).test(source)) {
        missing.push(`${label} does not apply ${declaration.themeVar}.webFontFamily`);
      }
    }
  }

  const webUtilsSource = readFileSync(new URL('./web-utils.tsx', import.meta.url), 'utf8');
  if (!/interface WebFolioProps\s*{[^}]*fontFamily\?: string;/s.test(webUtilsSource)) {
    missing.push('web-utils.tsx :: WebFolioProps.fontFamily is missing');
  }
  if (!/function WebFolio\(\s*{[^}]*fontFamily[^}]*}\s*:\s*WebFolioProps\s*\)/s.test(webUtilsSource)) {
    missing.push('web-utils.tsx :: WebFolio does not consume its fontFamily prop');
  }
  if (!/fontFamily:\s*fontFamily\s*\?\?\s*WEB_FONTS\.serifEn/.test(webUtilsSource)) {
    missing.push('web-utils.tsx :: WebFolio does not apply its fontFamily prop');
  }

  assert.deepEqual(
    missing,
    [],
    `Web 文字槽未完整接入合同 role 和解析后字体：\n${missing.join('\n')}`,
  );
});

test('every PDF text carrier resolves its contract role and applies its resolved font', () => {
  const missing: string[] = [];

  for (const templateId of listTemplateIds()) {
    let slots: TemplateTextSlot[];
    let source: string;
    try {
      slots = readTemplateTextSlots(templateId);
      source = readFileSync(new URL(`./${templateId}/pdf.tsx`, import.meta.url), 'utf8');
    } catch {
      continue;
    }

    for (const slot of slots) {
      if (!referencesSlot(source, slot.base)) continue;
      const renderedSlot = `${slot.base}${slot.repeat ? '[n]' : ''}`;
      const declaration = resolvedCarrierDeclaration(source, slot);
      if (!declaration) {
        missing.push(`${templateId}/pdf.tsx :: ${renderedSlot} missing theme resolver`);
        continue;
      }

      const label = `${templateId}/pdf.tsx :: ${renderedSlot} (${declaration.themeVar})`;
      if (declaration.role !== slot.role) {
        missing.push(
          `${label} resolves role=${declaration.role ?? '<missing>'}; expected role=${slot.role}`,
        );
      }
      if (!new RegExp(`\\b${escapeRegExp(declaration.themeVar)}\\.pdfFontFamily\\b`).test(source)) {
        missing.push(`${label} does not apply ${declaration.themeVar}.pdfFontFamily`);
      }
      if (
        slot.base === 'folio'
        && !new RegExp(
          `<PdfFolio(?=[^>]*\\bfontFamily=\\{${escapeRegExp(declaration.themeVar)}\\.pdfFontFamily\\})[^>]*/>`,
        ).test(source)
      ) {
        missing.push(`${label} does not pass its font to PdfFolio`);
      }
    }
  }

  const pdfUtilsSource = readFileSync(new URL('./pdf-utils.tsx', import.meta.url), 'utf8');
  if (!/interface PdfFolioProps\s*{[^}]*fontFamily\?: string;/s.test(pdfUtilsSource)) {
    missing.push('pdf-utils.tsx :: PdfFolioProps.fontFamily is missing');
  }
  if (!/function PdfFolio\(\s*{[^}]*fontFamily[^}]*}\s*:\s*PdfFolioProps\s*\)/s.test(pdfUtilsSource)) {
    missing.push('pdf-utils.tsx :: PdfFolio does not consume its fontFamily prop');
  }
  if (!/fontFamily:\s*fontFamily\s*\?\?\s*PDF_FONTS\.serifEn/.test(pdfUtilsSource)) {
    missing.push('pdf-utils.tsx :: PdfFolio does not apply its fontFamily prop');
  }

  assert.deepEqual(
    missing,
    [],
    `PDF 文字槽未完整接入合同 role 和解析后字体：\n${missing.join('\n')}`,
  );
});

test('every rendered PDF sentinel uses its exact resolved Text node font', () => {
  for (const templateId of Object.keys(PDF_TEMPLATE_REGISTRY).sort()) {
    const source = readFileSync(new URL(`./${templateId}/pdf.tsx`, import.meta.url), 'utf8');
    const renderedSlots = readTemplateTextSlots(templateId).filter(
      (slot) => referencesSlot(source, slot.base),
    );
    const Template = getPdfTemplate(templateId);
    assert.ok(Template, `${templateId} PDF template must resolve`);
    for (const slotGroup of groupPdfSlotsWithoutBaseCollisions(renderedSlots)) {
      const { data, cases } = buildPdfSentinelData(templateId, slotGroup);
      const tree = expandPdfTree(createElement(Template, { data, totalPages: 37, imagePos: {} }));

      for (const renderCase of cases) {
        const label = `${templateId}.${renderCase.slotId} (${renderCase.role})`;
        const textNodes = deepestPdfTextNodesContaining(tree, renderCase.marker);
        assert.ok(textNodes.length > 0, `${label} sentinel must reach a PDF Text node`);
        for (const textNode of textNodes) {
          assert.equal(
            pdfNodeFontFamily(textNode),
            renderCase.expectedFontFamily,
            `${label} must apply its resolved family to the exact Text node`,
          );
        }

        if (renderCase.slotId === 'folio') {
          const folioNode = textNodes.find((node) => {
            const parent = findPdfParent(tree, node);
            return parent?.children.some(
              (child) => child.type === PdfText && normalizedPdfNodeText(child) === '/37',
            );
          });
          assert.ok(folioNode, `${label} must render through PdfFolio`);
          const folioParent = findPdfParent(tree, folioNode);
          assert.ok(folioParent, `${label} PdfFolio parent must resolve`);
          const folioTexts = folioParent.children.filter((child) => child.type === PdfText);
          assert.equal(folioTexts.length, 2, `${label} PdfFolio must render folio and /total Text nodes`);
          for (const textNode of folioTexts) {
            assert.equal(
              pdfNodeFontFamily(textNode),
              renderCase.expectedFontFamily,
              `${label} must apply its resolved family to both PdfFolio Text nodes`,
            );
          }
        }
      }
    }
  }
});

test('mag-18 applies explanation fonts to the dynamic text nodes only', () => {
  const source = readFileSync(new URL('./mag-18/index.tsx', import.meta.url), 'utf8');

  for (const plate of ['I', 'II']) {
    assert.match(
      source,
      new RegExp(
        `<p\\s+style=\\{\\{\\s*margin: '0 0 7px',\\s*fontFamily: WEB_FONTS\\.montserrat,[\\s\\S]*?>\\s*PLATE ${plate}\\s*</p>`,
      ),
      `mag-18 should preserve the static PLATE ${plate} font`,
    );
  }

  for (const index of [1, 2]) {
    assert.match(
      source,
      new RegExp(
        `<p\\s+style=\\{\\{\\s*margin: 0,\\s*fontFamily: explain${index}Theme\\.webFontFamily,[\\s\\S]*?>\\s*\\{d\\.explain${index} \\|\\| ''\\}\\s*</p>`,
      ),
      `mag-18 should apply explain${index}Theme.webFontFamily to d.explain${index}`,
    );
  }
});

test('mag-18 PDF tree preserves the static PLATE label family', () => {
  const Template = getPdfTemplate('mag-18');
  assert.ok(Template, 'mag-18 PDF template must resolve');
  const tree = expandPdfTree(createElement(Template, { data: {}, totalPages: 37, imagePos: {} }));

  for (const plate of ['I', 'II']) {
    const textNodes = allPdfTextNodes(tree).filter(
      (node) => normalizedPdfNodeText(node) === `PLATE${plate}`,
    );
    assert.equal(textNodes.length, 1, `mag-18 PDF should render one static PLATE ${plate} label`);
    assert.equal(
      pdfNodeFontFamily(textNodes[0]!),
      PDF_FONTS.montserrat,
      `mag-18 PDF should preserve the static PLATE ${plate} font`,
    );
  }
});

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
      const contractSlot = readTemplateTextSlots(templateId).find(
        (slot) => slot.base === slotId.replace('[${i}]', ''),
      );
      assert.ok(contractSlot, `${templateId}.${slotId} must have a contract role`);
      const pattern = slotId.includes('${i}')
        ? new RegExp(
            `resolveThemeCarrier\\(data,\\s*\`${escapeRegExp(slotId)}\`,\\s*['"]${contractSlot.role}['"]\\)`,
          )
        : new RegExp(
            `resolveThemeCarrier\\(data,\\s*['"]${escapeRegExp(slotId)}['"],\\s*['"]${contractSlot.role}['"]\\)`,
          );
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

test('every concrete album font has a real asset and matching Web/PDF registration', () => {
  const webRoot = fileURLToPath(new URL('../../../../', import.meta.url));
  const css = readFileSync(new URL('../../../styles/globals.css', import.meta.url), 'utf8');
  const pdfUtils = readFileSync(new URL('./pdf-utils.tsx', import.meta.url), 'utf8');
  const sources = readFileSync(new URL('../../../../fonts/SOURCES.md', import.meta.url), 'utf8');
  const legacyPacks = new Set([
    'serif-classic',
    'sans-modern',
    'script-elegant',
    'display-bold',
  ]);

  for (const [pack, rawEntry] of Object.entries(FONT_CATALOG)) {
    if (legacyPacks.has(pack)) continue;
    const entry = rawEntry as typeof rawEntry & {
      asset?: { delivery: 'server-subset' | 'public'; file: string };
    };
    assert.ok(entry.asset, `${pack} must declare its concrete font asset`);
    const asset = entry.asset!;
    const expectedDelivery = entry.script === 'cjk' ? 'server-subset' : 'public';
    assert.equal(asset.delivery, expectedDelivery, `${pack} must use ${expectedDelivery} delivery`);

    const assetPath = asset.delivery === 'server-subset'
      ? `${webRoot}fonts/${asset.file}`
      : `${webRoot}public/fonts/${asset.file}`;
    assert.ok(existsSync(assetPath), `${pack} asset is missing: ${assetPath}`);
    assert.match(sources, new RegExp(escapeRegExp(asset.file)), `${pack} source must be recorded`);

    const primaryWebFamily = entry.webFontFamily.match(/^"([^"]+)"/)?.[1];
    assert.ok(primaryWebFamily, `${pack} must name a concrete primary Web family`);
    const normalizedPdfFamily = entry.pdfFontFamily.replace(/\s+/g, '').toLowerCase();
    const normalizedWebFamily = primaryWebFamily.replace(/\s+/g, '').toLowerCase();
    assert.equal(
      normalizedPdfFamily,
      normalizedWebFamily,
      `${pack} PDF family must be the same real family as Web, not a surrogate`,
    );

    if (asset.delivery === 'public') {
      const face = new RegExp(
        `@font-face\\s*\\{(?=[^}]*font-family:\\s*['"]${escapeRegExp(primaryWebFamily)}['"])(?=[^}]*url\\(['"]?\\/fonts\\/${escapeRegExp(asset.file)}['"]?\\))(?=[^}]*font-display:\\s*swap)[^}]*\\}`,
        's',
      );
      assert.match(css, face, `${pack} must have a font-display: swap Web registration`);
      assert.match(
        pdfUtils,
        new RegExp(`['"]${escapeRegExp(asset.file)}['"]`),
        `${pack} must have a PDF registration for its real asset`,
      );
    }
  }

  assert.ok(
    existsSync(`${webRoot}public/fonts/OFL-1.1.txt`),
    'public album fonts must ship the OFL-1.1 license',
  );
});
