import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

import {
  TEMPLATE_IDS,
  TEMPLATES,
  TemplateDef,
  TemplateImageSlot,
  TemplateTextSlot,
  getTemplate,
  validateSlotsForTemplate,
} from './templates';
import { TEMPLATES as INDEX_TEMPLATES } from './index';

// WP0.2 is a TRANSITIONAL (additive) migration: every template now carries the
// V3 fields (category / items / hint / variableDecor / svgs) AND keeps its
// legacy fields (slot / scene / orientation / quality / repeat) so the live web
// skeleton engine — a shared TS<->Python contract locked by golden fixtures —
// keeps working untouched. Legacy-field removal happens with the engine rewrite
// (alongside WP0.4). These tests assert BOTH layers are coherent.

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
  'p01',
];

const VALID_SLOTS = new Set(['cover', 'interior', 'ending']);
const VALID_SCENES = new Set([
  'opening',
  'portrait',
  'scenery',
  'record',
  'interlude',
  'textOnly',
  'ending',
]);
const VALID_CATEGORIES = new Set(['cover', 'interior', 'toc', 'ending']);
const VALID_ROLES = new Set(['title', 'body', 'explain', 'decoration']);
// variableDecor (themable styling) is only meaningful for title / decoration /
// svg slots — body / explain are reading content and must never carry it.
const VARIABLE_DECOR_ROLES = new Set(['title', 'decoration']);

type AnySlot = {
  id?: string;
  role?: string;
  lang?: string;
  maxChars?: number;
  hint?: string;
  variableDecor?: boolean;
};

function checkTextSlot(id: string, slot: AnySlot): void {
  assert.ok(slot.id, `${id} text slot needs an id`);
  assert.ok(VALID_ROLES.has(slot.role ?? ''), `${id}.${slot.id} role should be valid`);
  assert.ok(slot.lang === 'user' || slot.lang === 'en', `${id}.${slot.id} lang should be valid`);
  if (slot.maxChars !== undefined) {
    assert.ok(slot.maxChars > 0, `${id}.${slot.id} maxChars should be positive`);
  }
  if (slot.hint !== undefined) {
    assert.ok(
      typeof slot.hint === 'string' && slot.hint.length > 0,
      `${id}.${slot.id} hint should be a non-empty string`,
    );
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

test('image and text slot schemas accept the V3 id-keyed shape', () => {
  assert.deepEqual(TemplateImageSlot.parse({ id: 'image' }), { id: 'image' });
  assert.deepEqual(
    TemplateImageSlot.parse({ id: 'image', orientation: ['portrait'] }),
    { id: 'image', orientation: ['portrait'] },
  );
  assert.deepEqual(
    TemplateTextSlot.parse({ id: 'caption', role: 'explain', lang: 'user' }),
    { id: 'caption', role: 'explain', lang: 'user' },
  );
  assert.deepEqual(
    TemplateTextSlot.parse({
      id: 'title',
      role: 'title',
      maxChars: 12,
      lang: 'user',
      variableDecor: true,
      hint: '主标题',
    }),
    { id: 'title', role: 'title', maxChars: 12, lang: 'user', variableDecor: true, hint: '主标题' },
  );
});

test('every template parses, mirrors its id, and carries coherent legacy + V3 fields', () => {
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

    // Legacy classification still present (engine reads it).
    assert.ok(VALID_SLOTS.has(template.slot as string), `${id} slot should be valid`);
    assert.ok(VALID_SCENES.has(template.scene as string), `${id} scene should be valid`);
    // V3 classification added.
    assert.ok(VALID_CATEGORIES.has(template.category as string), `${id} category should be valid`);

    // pairing only allowed on interior pages.
    if (template.pairing) {
      assert.equal(template.slot, 'interior', `${id} pairing requires interior`);
    }

    for (const slot of template.images) {
      assert.ok(slot.id, `${id} image slot needs an id`);
    }

    for (const slot of template.texts) {
      checkTextSlot(id, slot);
    }

    // V3 repeat group, when present, validates the same way.
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

test('every V3 category pool is non-empty', () => {
  const byCategory = new Map<string, number>();
  for (const id of EXPECTED_TEMPLATE_IDS) {
    const category = (TEMPLATES[id] as { category?: string }).category ?? '';
    byCategory.set(category, (byCategory.get(category) ?? 0) + 1);
  }
  for (const category of VALID_CATEGORIES) {
    assert.ok((byCategory.get(category) ?? 0) > 0, `category pool "${category}" must be non-empty`);
  }
});

test('legacy metadata is preserved for the live skeleton engine', () => {
  assert.deepEqual(getTemplate('mag-04')?.images, [
    { id: 'image1', orientation: ['square'], quality: ['hero', 'detail'] },
    { id: 'image2', orientation: ['square'], quality: ['detail', 'fill'] },
    { id: 'image3', orientation: ['square'], quality: ['detail', 'fill'] },
  ]);
  assert.equal(getTemplate('mag-02')?.texts.find((t) => t.id === 'numbers')?.repeat, true);
  assert.equal(getTemplate('mag-02')?.texts.find((t) => t.id === 'titles')?.repeat, true);
  assert.equal(getTemplate('mag-10')?.texts.find((t) => t.id === 'cells')?.repeat, true);
});

test('V3 fields are added: category, hint, variableDecor, items, svgs', () => {
  // category mapping (slot+scene kept, category added).
  assert.equal(getTemplate('mag-01')?.category, 'cover');
  assert.equal(getTemplate('mag-02')?.category, 'toc');
  assert.equal(getTemplate('mag-20')?.category, 'ending');
  assert.equal(getTemplate('mag-05')?.category, 'interior');

  // hint authored on a content slot.
  const caption = getTemplate('mag-05')?.texts.find((t) => t.id === 'caption');
  assert.ok(typeof caption?.hint === 'string' && caption.hint.length > 0);

  // variableDecor on a decoration slot, absent on the page folio.
  assert.equal(getTemplate('mag-03')?.texts.find((t) => t.id === 'location')?.variableDecor, true);
  assert.equal(getTemplate('mag-03')?.texts.find((t) => t.id === 'folio')?.variableDecor, undefined);

  // items repeat group present for the toc / grid templates.
  assert.deepEqual(getTemplate('mag-02')?.items?.texts?.map((s) => s.id), [
    'numbers',
    'titles',
    'descriptions',
  ]);
  assert.deepEqual(getTemplate('mag-10')?.items?.images?.map((s) => s.id), ['image']);
  assert.deepEqual(getTemplate('mag-10')?.items?.texts?.map((s) => s.id), ['caption']);

  // svgs decoration slot (fixture coverage for the new svgs[] field).
  assert.deepEqual(getTemplate('mag-13')?.svgs, [{ id: 'divider', variableDecor: true }]);
});

test('generated templates are synchronized with template JSON files', () => {
  execFileSync('pnpm', ['--filter', '@yujee/contracts', 'templates:check'], {
    cwd: new URL('../../..', import.meta.url),
    stdio: 'pipe',
  });
});

test('slot validation accepts legacy + V3 item bracket paths and rejects unknown slots', () => {
  // legacy repeat addressing (still valid).
  assert.deepEqual(
    validateSlotsForTemplate(
      'mag-10',
      ['cells[0].image', 'cells[1].image', 'cells[2].image', 'cells[3].image'],
      ['cells', 'folio'],
    ),
    { ok: true },
  );
  assert.deepEqual(
    validateSlotsForTemplate(
      'mag-02',
      [],
      ['heading', 'numbers[0]', 'titles[0]', 'descriptions[0]', 'folio'],
    ),
    { ok: true },
  );
  // V3 items addressing for mag-10 (image[i] / caption[i]) also resolves.
  assert.deepEqual(
    validateSlotsForTemplate('mag-10', ['image[0]', 'image[1]'], ['caption[0]', 'folio']),
    { ok: true },
  );

  assert.deepEqual(validateSlotsForTemplate('mag-02', ['image'], ['titles[0]']), {
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
