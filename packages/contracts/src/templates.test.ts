import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

import {
  ITEMS_GRID_CAPACITY,
  TEMPLATE_IDS,
  TEMPLATES,
  TemplateDef,
  TemplateImageSlot,
  TemplateTextSlot,
  getTemplate,
  validateSlotsForTemplate,
} from './templates';
import { TEMPLATES as INDEX_TEMPLATES } from './index';

// The template contract is category-only: every template declares a single
// `category` (cover | toc | interior | ending) — the legacy `slot` + `scene`
// fields are gone. These tests assert the new shape and the migrated text-slot
// ids (title / body / explain* / label* / folio / date …).

const EXPECTED_TEMPLATE_IDS = [
  'mag-01',
  'mag-02',
  'mag-03',
  'mag-04',
  'mag-05',
  'mag-06',
  'mag-07',
  'mag-08',
  'mag-09',
  'mag-10',
  'mag-11',
  'mag-13',
  'mag-15',
  'mag-18',
  'mag-19',
  'mag-20',
  'mag-22',
  'mag-23',
  'mag-25',
  'mag-26',
  'mag-27',
  'mag-28',
  'mag-29',
  'mag-30',
  'mag-31',
  'mag-32',
  'mag-33',
  'mag-34',
  'mag-35',
  'mag-36',
  'mag-37',
  'mag-38',
  'mag-39',
  'mag-40',
  'mag-41',
  'mag-42',
  'mag-43',
  'mag-44',
  'mag-45',
  'mag-46',
  'mag-47',
  'mag-48',
  'mag-49',
  'mag-50',
  'mag-51',
  'mag-52',
  'mag-53',
  'p01',
];

const VALID_CATEGORIES = new Set(['cover', 'toc', 'interior', 'ending']);
const VALID_ROLES = new Set(['title', 'body', 'explain', 'decoration']);
// variableDecor (themable styling) is only meaningful for title / decoration /
// svg slots — body / explain are reading content and must never carry it.
const VARIABLE_DECOR_ROLES = new Set(['title', 'decoration']);

type AnySlot = {
  id?: string;
  role?: string;
  lang?: string;
  maxChars?: number;
  variableDecor?: boolean;
};

function checkTextSlot(id: string, slot: AnySlot): void {
  assert.ok(slot.id, `${id} text slot needs an id`);
  assert.ok(VALID_ROLES.has(slot.role ?? ''), `${id}.${slot.id} role should be valid`);
  assert.ok(slot.lang === 'user' || slot.lang === 'en', `${id}.${slot.id} lang should be valid`);
  if (slot.maxChars !== undefined) {
    assert.ok(slot.maxChars > 0, `${id}.${slot.id} maxChars should be positive`);
  }
  if (slot.variableDecor !== undefined) {
    assert.ok(
      VARIABLE_DECOR_ROLES.has(slot.role ?? ''),
      `${id}.${slot.id} variableDecor only allowed on title / decoration`,
    );
  }
}

test('registry contains the active template set', () => {
  assert.deepEqual(TEMPLATE_IDS, EXPECTED_TEMPLATE_IDS);
  assert.equal(INDEX_TEMPLATES, TEMPLATES);
});

test('image and text slot schemas accept the id-keyed shape', () => {
  assert.deepEqual(TemplateImageSlot.parse({ id: 'image' }), { id: 'image' });
  assert.deepEqual(
    TemplateImageSlot.parse({ id: 'image', orientation: ['portrait'] }),
    { id: 'image', orientation: ['portrait'] },
  );
  assert.deepEqual(
    TemplateTextSlot.parse({ id: 'explain', role: 'explain', lang: 'user' }),
    { id: 'explain', role: 'explain', lang: 'user' },
  );
  assert.deepEqual(
    TemplateTextSlot.parse({
      id: 'title',
      role: 'title',
      maxChars: 12,
      lang: 'user',
      variableDecor: true,
    }),
    { id: 'title', role: 'title', maxChars: 12, lang: 'user', variableDecor: true },
  );
});

test('TemplateDef rejects the removed legacy slot/scene fields', () => {
  const base = {
    id: 'legacy-check',
    category: 'interior' as const,
    images: [{ id: 'image' }],
    texts: [{ id: 'body', role: 'body' as const, lang: 'user' as const }],
  };
  assert.equal(TemplateDef.safeParse(base).success, true);
  assert.equal(TemplateDef.safeParse({ ...base, slot: 'interior' }).success, false);
  assert.equal(TemplateDef.safeParse({ ...base, scene: 'record' }).success, false);
  // category is now required.
  const { category: _omit, ...withoutCategory } = base;
  assert.equal(TemplateDef.safeParse(withoutCategory).success, false);
});

test('pairing is only valid on interior templates', () => {
  const pairing = { forced: true, with: 'mag-08', side: 'left' as const };
  const make = (category: 'cover' | 'toc' | 'interior' | 'ending') => ({
    id: 'pairing-check',
    category,
    pairing,
    images: [{ id: 'image' }],
    texts: [{ id: 'body', role: 'body' as const, lang: 'user' as const }],
  });
  assert.equal(TemplateDef.safeParse(make('interior')).success, true);
  assert.equal(TemplateDef.safeParse(make('cover')).success, false);
  assert.equal(TemplateDef.safeParse(make('toc')).success, false);
  assert.equal(TemplateDef.safeParse(make('ending')).success, false);
});

test('every template parses, mirrors its id, and carries a valid category', () => {
  for (const id of EXPECTED_TEMPLATE_IDS) {
    const template = TEMPLATES[id] as Record<string, unknown> & {
      images: AnySlot[];
      texts: AnySlot[];
      items?: { images?: AnySlot[]; texts?: AnySlot[] };
      svgs?: AnySlot[];
    };

    assert.ok(template, `${id} should be registered`);
    assert.deepEqual(TemplateDef.parse(template), template);
    assert.equal(template.id, id);

    // Single category classification; no legacy slot/scene.
    assert.ok(VALID_CATEGORIES.has(template.category as string), `${id} category should be valid`);
    assert.equal('slot' in template, false, `${id} must not carry legacy slot`);
    assert.equal('scene' in template, false, `${id} must not carry legacy scene`);

    // pairing only allowed on interior pages.
    if (template.pairing) {
      assert.equal(template.category, 'interior', `${id} pairing requires interior`);
    }

    for (const slot of template.images) {
      assert.ok(slot.id, `${id} image slot needs an id`);
    }

    for (const slot of template.texts) {
      checkTextSlot(id, slot);
    }

    // Repeat group, when present, validates the same way.
    for (const slot of template.items?.images ?? []) {
      assert.ok(slot.id, `${id} items image slot needs an id`);
    }
    for (const slot of template.items?.texts ?? []) {
      checkTextSlot(`${id}.items`, slot);
    }

    for (const slot of template.svgs ?? []) {
      assert.ok(slot.id, `${id} svg slot needs an id`);
    }
  }
});

test('every category pool is non-empty', () => {
  const byCategory = new Map<string, number>();
  for (const id of EXPECTED_TEMPLATE_IDS) {
    const category = (TEMPLATES[id] as { category?: string }).category ?? '';
    byCategory.set(category, (byCategory.get(category) ?? 0) + 1);
  }
  for (const category of VALID_CATEGORIES) {
    assert.ok((byCategory.get(category) ?? 0) > 0, `category pool "${category}" must be non-empty`);
  }
});

test('category assignment for the head/toc/tail/body anchors', () => {
  assert.equal(getTemplate('mag-01')?.category, 'cover');
  assert.equal(getTemplate('mag-13')?.category, 'cover');
  assert.equal(getTemplate('p01')?.category, 'cover');
  assert.equal(getTemplate('mag-02')?.category, 'toc');
  assert.equal(getTemplate('mag-20')?.category, 'ending');
  assert.equal(getTemplate('mag-05')?.category, 'interior');
});

test('image-slot orientation/quality hints are preserved for matching', () => {
  assert.deepEqual(getTemplate('mag-04')?.images, [
    { id: 'image1', orientation: ['square'], quality: ['hero', 'detail'] },
    { id: 'image2', orientation: ['square'], quality: ['detail', 'fill'] },
  ]);
});

test('text ids are the migrated semantic ids', () => {
  assert.deepEqual(
    getTemplate('mag-01')?.texts.map((t) => t.id),
    ['title', 'label', 'explain1', 'explain2', 'folio'],
  );
  assert.deepEqual(
    getTemplate('mag-05')?.texts.map((t) => t.id),
    ['title', 'label', 'explain', 'folio'],
  );
  // toc top-level texts + repeat-group item texts.
  assert.deepEqual(getTemplate('mag-02')?.texts.map((t) => t.id), ['title', 'folio']);
  assert.deepEqual(getTemplate('mag-02')?.items?.texts?.map((t) => t.id), [
    'number',
    'title',
    'description',
  ]);
  // grid repeat group: image + explain item slots.
  assert.deepEqual(getTemplate('mag-10')?.items?.images?.map((s) => s.id), ['image']);
  assert.deepEqual(getTemplate('mag-10')?.items?.texts?.map((s) => s.id), ['explain']);
  // p01 cover decoration labels.
  assert.deepEqual(
    getTemplate('p01')?.texts.map((t) => t.id),
    ['title', 'body', 'label1', 'label2', 'date'],
  );
});

test('generated templates are synchronized with template JSON files', () => {
  execFileSync('pnpm', ['--filter', '@yujee/contracts', 'templates:check'], {
    cwd: new URL('../../..', import.meta.url),
    stdio: 'pipe',
  });
});

test('slot validation accepts item bracket paths and rejects unknown slots', () => {
  // mag-10 grid: items.images[].image addressed as image[i]; items.texts[].explain as explain[i].
  assert.deepEqual(
    validateSlotsForTemplate('mag-10', ['image[0]', 'image[1]'], ['explain[0]', 'folio']),
    { ok: true },
  );
  // mag-02 toc: items number/title/description addressed as base[i]; top-level title/folio.
  assert.deepEqual(
    validateSlotsForTemplate(
      'mag-02',
      [],
      ['title', 'number[0]', 'title[0]', 'description[0]', 'folio'],
    ),
    { ok: true },
  );

  assert.deepEqual(validateSlotsForTemplate('mag-02', ['image'], ['title[0]']), {
    ok: false,
    reason: 'image slot "image" not in template mag-02',
  });
  assert.deepEqual(validateSlotsForTemplate('mag-02', [], ['items[0].title']), {
    ok: false,
    reason: 'text slot "items[0].title" not in template mag-02',
  });
  assert.deepEqual(validateSlotsForTemplate('mag-01', ['image'], ['headline']), {
    ok: false,
    reason: 'text slot "headline" not in template mag-01',
  });
});

test('items-grid bracket paths are bounded by the shared grid capacity', () => {
  assert.equal(ITEMS_GRID_CAPACITY, 4);
  assert.deepEqual(
    validateSlotsForTemplate('mag-10', [`image[${ITEMS_GRID_CAPACITY - 1}]`], [
      `explain[${ITEMS_GRID_CAPACITY - 1}]`,
    ]),
    { ok: true },
  );
  assert.deepEqual(validateSlotsForTemplate('mag-10', [`image[${ITEMS_GRID_CAPACITY}]`], []), {
    ok: false,
    reason: `image slot "image[${ITEMS_GRID_CAPACITY}]" exceeds items-grid capacity ${ITEMS_GRID_CAPACITY} in template mag-10`,
  });
  assert.deepEqual(validateSlotsForTemplate('mag-10', [], [`explain[${ITEMS_GRID_CAPACITY}]`]), {
    ok: false,
    reason: `text slot "explain[${ITEMS_GRID_CAPACITY}]" exceeds items-grid capacity ${ITEMS_GRID_CAPACITY} in template mag-10`,
  });
});
