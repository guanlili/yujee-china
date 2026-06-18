import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = path.resolve(SCRIPT_DIR, '..');
const TEMPLATE_DIR = path.join(PACKAGE_DIR, 'templates');
const GENERATED_PATH = path.join(PACKAGE_DIR, 'src', 'templates.generated.ts');

// NOTE: this schema mirrors `src/templates.ts` (kept inline so the gen script
//   has no dep on tsx path-resolving the source tree). They MUST stay in sync —
//   `templates:check` fails the typecheck if generated output drifts.
const PhotoOrientation = z.enum(['portrait', 'landscape', 'square']);
const PhotoQuality = z.enum(['hero', 'detail', 'fill']);

const TemplateImageSlot = z
  .object({
    id: z.string().min(1),
    // @deprecated orientation/quality — V3 作废,WP0.2 删(见 src/templates.ts)。
    orientation: z.array(PhotoOrientation).nonempty().optional(),
    quality: z.array(PhotoQuality).nonempty().optional(),
  })
  .strict();

const TemplateTextRole = z.enum(['title', 'body', 'explain', 'decoration']);
const TemplateTextLang = z.enum(['user', 'en']);

const TemplateTextSlot = z
  .object({
    id: z.string().min(1),
    role: TemplateTextRole,
    maxChars: z.number().int().positive().optional(),
    lang: TemplateTextLang,
    hint: z.string().min(1).max(200).optional(),
    variableDecor: z.boolean().optional(),
    // @deprecated repeat — V3 用 items 组,WP0.2 删。
    repeat: z.boolean().optional(),
  })
  .strict();

const TemplateSvgSlot = z
  .object({
    id: z.string().min(1),
    variableDecor: z.boolean().optional(),
  })
  .strict();

const TemplateItems = z
  .object({
    images: z.array(TemplateImageSlot).optional(),
    texts: z.array(TemplateTextSlot).optional(),
  })
  .strict();

const TemplateCategory = z.enum(['cover', 'interior', 'toc', 'ending']);
// @deprecated slot/scene — V3 用 category 替代,WP0.2 删。
const TemplateSlotKind = z.enum(['cover', 'interior', 'ending']);
const TemplateScene = z.enum([
  'opening',
  'portrait',
  'scenery',
  'record',
  'interlude',
  'textOnly',
  'ending',
]);

const TemplatePairing = z
  .object({
    forced: z.boolean(),
    with: z.string().min(1),
    side: z.enum(['left', 'right']),
  })
  .strict();

const TemplateDef = z
  .object({
    id: z.string().min(1),
    category: TemplateCategory.optional(),
    slot: TemplateSlotKind.optional(),
    scene: TemplateScene.optional(),
    pairing: TemplatePairing.nullable().optional(),
    styles: z.array(z.string().min(1)).optional(),
    images: z.array(TemplateImageSlot),
    svgs: z.array(TemplateSvgSlot).optional(),
    texts: z.array(TemplateTextSlot),
    items: TemplateItems.optional(),
  })
  .strict()
  .superRefine((template, ctx) => {
    const hasV3Category = Boolean(template.category);
    const hasLegacyClassification = Boolean(template.slot && template.scene);

    if (!hasV3Category && !hasLegacyClassification) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'template must declare category or legacy slot+scene',
        path: ['category'],
      });
    }
  });

type TemplateDef = z.infer<typeof TemplateDef>;

function templateSortKey(id: string): [number, number, string] {
  const match = /^mag-(\d+)$/.exec(id);
  if (match) return [0, Number(match[1]), id];
  return [1, Number.MAX_SAFE_INTEGER, id];
}

function compareTemplateIds(a: string, b: string): number {
  const left = templateSortKey(a);
  const right = templateSortKey(b);

  return (
    left[0] - right[0] ||
    left[1] - right[1] ||
    left[2].localeCompare(right[2])
  );
}

async function loadTemplates(): Promise<TemplateDef[]> {
  const entries = await readdir(TEMPLATE_DIR);
  const jsonFiles = entries.filter((entry) => entry.endsWith('.json')).sort();

  if (jsonFiles.length === 0) {
    throw new Error(`no template JSON files found in ${TEMPLATE_DIR}`);
  }

  const templates = await Promise.all(
    jsonFiles.map(async (fileName) => {
      const idFromFile = path.basename(fileName, '.json');
      const filePath = path.join(TEMPLATE_DIR, fileName);
      const raw = await readFile(filePath, 'utf8');
      const parsed = TemplateDef.parse(JSON.parse(raw));

      if (parsed.id !== idFromFile) {
        throw new Error(
          `${fileName} id mismatch: expected "${idFromFile}", got "${parsed.id}"`,
        );
      }

      return parsed;
    }),
  );

  const ids = new Set<string>();
  for (const template of templates) {
    if (ids.has(template.id)) {
      throw new Error(`duplicate template id: ${template.id}`);
    }
    ids.add(template.id);
  }

  return templates.sort((a, b) => compareTemplateIds(a.id, b.id));
}

function renderGeneratedFile(templates: TemplateDef[]): string {
  const ids = templates.map((template) => template.id);
  const registry = Object.fromEntries(
    templates.map((template) => [template.id, template]),
  );

  return `// This file is generated by packages/contracts/scripts/gen-templates.ts.
// Do not edit it directly. Run pnpm --filter @yujee/contracts templates:generate.

import type { TemplateDef } from './templates';

export const TEMPLATE_IDS = ${JSON.stringify(ids, null, 2)} as const;

export const TEMPLATES: Record<string, TemplateDef> = ${JSON.stringify(
    registry,
    null,
    2,
  )};
`;
}

async function main(): Promise<void> {
  const checkMode = process.argv.includes('--check');
  const generated = renderGeneratedFile(await loadTemplates());

  if (checkMode) {
    const current = await readFile(GENERATED_PATH, 'utf8').catch(() => null);
    if (current !== generated) {
      throw new Error(
        'templates.generated.ts is out of sync; run pnpm --filter @yujee/contracts templates:generate',
      );
    }
    return;
  }

  await writeFile(GENERATED_PATH, generated, 'utf8');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
