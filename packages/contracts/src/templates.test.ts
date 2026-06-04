import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

import {
  TEMPLATE_IDS,
  TEMPLATES,
  TemplateDef,
  TemplateSlotConstraint,
  TemplateTextSlotConstraint,
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

test('registry contains the 21 templates imported from memoir', () => {
  assert.deepEqual(TEMPLATE_IDS, EXPECTED_TEMPLATE_IDS);
  assert.equal(INDEX_TEMPLATES, TEMPLATES);
});

test('template schemas accept soft optional image and text recommendations', () => {
  assert.deepEqual(TemplateSlotConstraint.parse({}), {});
  assert.deepEqual(TemplateSlotConstraint.parse({ orientation: ['portrait'] }), {
    orientation: ['portrait'],
  });
  assert.deepEqual(TemplateSlotConstraint.parse({ quality: ['hero'] }), {
    quality: ['hero'],
  });
  assert.deepEqual(TemplateTextSlotConstraint.parse({ type: 'caption' }), {
    type: 'caption',
  });
  assert.deepEqual(
    TemplateTextSlotConstraint.parse({ type: 'caption', recommendedMaxChars: 80 }),
    { type: 'caption', recommendedMaxChars: 80 },
  );
});

test('every template parses, mirrors its id, and exposes soft slot constraints', () => {
  for (const id of EXPECTED_TEMPLATE_IDS) {
    const template = TEMPLATES[id];

    assert.ok(template, `${id} should be registered`);
    assert.deepEqual(TemplateDef.parse(template), template);
    assert.equal(template.id, id);

    for (const [slotName, constraint] of Object.entries(template.imageSlots)) {
      if (constraint.orientation) {
        assert.ok(
          constraint.orientation.length > 0,
          `${id}.${slotName} orientation hint should not be empty`,
        );
      }
      if (constraint.quality) {
        assert.ok(
          constraint.quality.length > 0,
          `${id}.${slotName} quality hint should not be empty`,
        );
      }
    }

    for (const [slotName, constraint] of Object.entries(template.textSlots)) {
      assert.equal(
        'minChars' in constraint,
        false,
        `${id}.${slotName} should not expose migrated minChars`,
      );
      assert.equal(
        'maxChars' in constraint,
        false,
        `${id}.${slotName} should not expose migrated maxChars`,
      );
      if (constraint.recommendedMaxChars !== undefined) {
        assert.ok(
          constraint.recommendedMaxChars > 0,
          `${id}.${slotName} recommendedMaxChars should be positive`,
        );
      }
    }
  }
});

test('selected template metadata matches the source schema semantics', () => {
  assert.deepEqual(getTemplate('mag-04')?.imageSlots, {
    image1: { orientation: ['landscape'], quality: ['hero', 'detail'] },
    image2: { orientation: ['portrait'], quality: ['detail', 'fill'] },
    image3: { orientation: ['square'], quality: ['detail', 'fill'] },
  });
  assert.deepEqual(getTemplate('mag-05')?.textSlots.caption, {
    type: 'paragraph',
    recommendedMaxChars: 120,
  });
  assert.deepEqual(getTemplate('mag-03')?.textSlots.caption, {
    type: 'caption',
    recommendedMaxChars: 60,
  });
  assert.deepEqual(getTemplate('p01')?.textSlots.vol, {
    type: 'meta',
    recommendedMaxChars: 4,
  });
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
