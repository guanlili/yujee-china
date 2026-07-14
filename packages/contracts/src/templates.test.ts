import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
  'mag-26',
  'mag-27',
  'mag-28',
  'mag-29',
  'mag-30',
  'mag-31',
  'mag-32',
  'mag-33',
  'mag-34',
  'mag-36',
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
  variableDecor?: boolean;
};

function checkTextSlot(id: string, slot: AnySlot): void {
  assert.ok(slot.id, `${id} text slot needs an id`);
  assert.ok(VALID_ROLES.has(slot.role ?? ''), `${id}.${slot.id} role should be valid`);
  assert.ok(slot.lang === 'user' || slot.lang === 'en', `${id}.${slot.id} lang should be valid`);
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
      lang: 'user',
      variableDecor: true,
    }),
    { id: 'title', role: 'title', lang: 'user', variableDecor: true },
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

// 不写死「哪个 id 属于哪一类」—— 模板会被重新归类(模板台的页面类型下拉框直接改
// 模板 JSON 的 category),写死的 id 断言只会烂成假前提。守真正的不变式:每个模板
// 都有合法类目,且四个类目都有模板兜底(缺了任何一类,排版/装书就没得挑)。
test('every template has a valid category, and every category is populated', () => {
  const byCategory = new Map<string, string[]>();
  for (const id of TEMPLATE_IDS) {
    const category = getTemplate(id)?.category;
    assert.ok(
      category && VALID_CATEGORIES.has(category),
      `${id} has an invalid category: ${category}`,
    );
    byCategory.set(category, [...(byCategory.get(category) ?? []), id]);
  }
  for (const category of VALID_CATEGORIES) {
    assert.ok((byCategory.get(category) ?? []).length > 0, `没有任何 ${category} 模板`);
  }
});

test('image-slot matching hints survive the loader (no field is dropped)', () => {
  // 图槽的 orientation/quality/composition 是确定性照片打分的输入 —— loader 一个都不能丢。
  // 【不写死某个模板的字段值】:那样每加一个匹配维度(composition 就是这么加的)测试就烂。
  // 守的是不变式:注册表里的图槽 === 模板 JSON 里的图槽,逐字节一致。
  const templateDir = fileURLToPath(new URL('../templates', import.meta.url));
  for (const id of TEMPLATE_IDS) {
    const raw = JSON.parse(readFileSync(path.join(templateDir, `${id}.json`), 'utf8')) as {
      images: unknown[];
    };
    assert.deepEqual(getTemplate(id)?.images, raw.images, `${id} 的图槽在 loader 里被改动了`);
  }
});

test('text slot ids follow the role-derived naming rule', () => {
  // 槽 id 是【技术标识符】,按 role 派号,不承载语义(语义由 role + sample 承载):
  //   title → title / title2 …   body → body / body2 …
  //   explain → explain / explain2 …   decoration → label / label2 …
  // 顶层 texts 与 items.texts 共用一个命名空间 —— bracket 寻址(title[0])会和顶层
  // 同名槽撞 base key(adapt-layout 会把顶层字符串顶成数组),所以不能重名。
  const BASE_BY_ROLE: Record<string, string> = {
    title: 'title',
    body: 'body',
    explain: 'explain',
    decoration: 'label',
  };

  for (const id of TEMPLATE_IDS) {
    const tpl = getTemplate(id);
    assert.ok(tpl, `${id} 不在注册表里`);
    const taken = new Set<string>();
    const expect = (role: string): string => {
      const base = BASE_BY_ROLE[role]!;
      if (!taken.has(base)) {
        taken.add(base);
        return base;
      }
      for (let i = 2; i <= 99; i += 1) {
        if (!taken.has(`${base}${i}`)) {
          taken.add(`${base}${i}`);
          return `${base}${i}`;
        }
      }
      throw new Error('号用尽');
    };
    for (const slot of [...tpl.texts, ...(tpl.items?.texts ?? [])]) {
      assert.equal(
        slot.id,
        expect(slot.role),
        `${id} 的槽 "${slot.id}"(${slot.role}) 不符合按 role 派号的命名规则`,
      );
    }
  }
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
    validateSlotsForTemplate('mag-10', ['image[0]', 'image[1]'], ['explain[0]']),
    { ok: true },
  );
  // mag-02 toc:items 槽按 base[i] 寻址(label/title2/explain);顶层 title 是【另一个槽】。
  // 槽 id 按 role 派号后,顶层 title 与条目标题 title2 彻底分开 —— 历史上它们共用
  // base key `title`,adapt-layout 会把顶层字符串顶成数组,顶层标题直接丢失。
  assert.deepEqual(
    validateSlotsForTemplate(
      'mag-02',
      [],
      ['title', 'label[0]', 'title2[0]', 'explain[0]'],
    ),
    { ok: true },
  );

  assert.deepEqual(validateSlotsForTemplate('mag-02', ['image'], ['title2[0]']), {
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
