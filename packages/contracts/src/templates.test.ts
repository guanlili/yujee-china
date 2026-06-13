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
  'mag-12',
  'mag-13',
  'mag-14',
  'mag-15',
  'mag-16',
  'mag-17',
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
const VALID_ROLES = new Set(['title', 'body', 'explain', 'decoration']);

test('registry contains the 21 templates imported from memoir', () => {
  assert.deepEqual(TEMPLATE_IDS, EXPECTED_TEMPLATE_IDS);
  assert.equal(INDEX_TEMPLATES, TEMPLATES);
});

test('image and text slot schemas accept the new id-keyed shape', () => {
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
      id: 'caption',
      role: 'explain',
      maxChars: 80,
      lang: 'user',
    }),
    { id: 'caption', role: 'explain', maxChars: 80, lang: 'user' },
  );
});

test('every template parses, mirrors its id, and uses valid slot/scene/role', () => {
  for (const id of EXPECTED_TEMPLATE_IDS) {
    const template = TEMPLATES[id];

    assert.ok(template, `${id} should be registered`);
    assert.deepEqual(TemplateDef.parse(template), template);
    assert.equal(template.id, id);
    assert.ok(VALID_SLOTS.has(template.slot), `${id} slot should be valid`);
    assert.ok(VALID_SCENES.has(template.scene), `${id} scene should be valid`);
    // pairing only allowed on interior pages
    if (template.pairing) {
      assert.equal(template.slot, 'interior', `${id} pairing requires interior`);
    }

    for (const slot of template.images) {
      assert.ok(slot.id, `${id} image slot needs an id`);
      if (slot.orientation) {
        assert.ok(slot.orientation.length > 0, `${id}.${slot.id} orientation hint should not be empty`);
      }
      if (slot.quality) {
        assert.ok(slot.quality.length > 0, `${id}.${slot.id} quality hint should not be empty`);
      }
    }

    for (const slot of template.texts) {
      assert.ok(slot.id, `${id} text slot needs an id`);
      assert.ok(VALID_ROLES.has(slot.role), `${id}.${slot.id} role should be valid`);
      assert.ok(slot.lang === 'user' || slot.lang === 'en', `${id}.${slot.id} lang should be valid`);
      if (slot.maxChars !== undefined) {
        assert.ok(slot.maxChars > 0, `${id}.${slot.id} maxChars should be positive`);
      }
    }
  }
});

test('selected template metadata matches the new schema semantics', () => {
  assert.deepEqual(getTemplate('mag-04')?.images, [
    { id: 'image1', orientation: ['landscape'], quality: ['hero', 'detail'] },
    { id: 'image2', orientation: ['portrait'], quality: ['detail', 'fill'] },
    { id: 'image3', orientation: ['square'], quality: ['detail', 'fill'] },
  ]);
  assert.deepEqual(
    getTemplate('mag-05')?.texts.find((t) => t.id === 'caption'),
    { id: 'caption', role: 'body', maxChars: 120, lang: 'user' },
  );
  assert.deepEqual(
    getTemplate('mag-03')?.texts.find((t) => t.id === 'caption'),
    { id: 'caption', role: 'explain', maxChars: 60, lang: 'user' },
  );
  assert.deepEqual(
    getTemplate('p01')?.texts.find((t) => t.id === 'vol'),
    { id: 'vol', role: 'decoration', maxChars: 4, lang: 'en' },
  );
  // repeat slots carry the flag the renderer keys off
  assert.equal(getTemplate('mag-02')?.texts.find((t) => t.id === 'items')?.repeat, true);
});

test('generated templates are synchronized with template JSON files', () => {
  execFileSync('pnpm', ['--filter', '@yujee/contracts', 'templates:check'], {
    cwd: new URL('../../..', import.meta.url),
    stdio: 'pipe',
  });
});

test('slot validation accepts known memoir slots and rejects unknown slots', () => {
  assert.deepEqual(
    validateSlotsForTemplate(
      'mag-10',
      ['cells[0].image', 'cells[1].image', 'cells[2].image', 'cells[3].image'],
      ['cells', 'folio'],
    ),
    { ok: true },
  );
  assert.deepEqual(validateSlotsForTemplate('mag-02', [], ['items', 'folio']), { ok: true });

  assert.deepEqual(validateSlotsForTemplate('mag-02', ['image'], ['items']), {
    ok: false,
    reason: 'image slot "image" not in template mag-02',
  });
  assert.deepEqual(validateSlotsForTemplate('mag-01', ['image'], ['headline']), {
    ok: false,
    reason: 'text slot "headline" not in template mag-01',
  });
});
