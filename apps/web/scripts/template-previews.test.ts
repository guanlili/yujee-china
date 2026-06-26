import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { TEMPLATE_IDS, TEMPLATES, type TemplateDef } from '@yujee/contracts/templates';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../../..');
const PREVIEW_DIR = path.join(REPO_ROOT, 'packages/contracts/template-previews');
const MANIFEST_PATH = path.join(PREVIEW_DIR, 'manifest.json');
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ITEMS_GRID_CAPACITY = 4;

type PreviewMetadata = {
  templateId: string;
  category: string;
  imageSlotCount: number;
  imageSlotIds: string[];
  textSlotCount: number;
  textSlotIds: string[];
  structureDescription: string;
};

type PreviewManifest = {
  schemaVersion: number;
  generatedFrom: string;
  templates: PreviewMetadata[];
  capacityBuckets: {
    category: string;
    imageSlotCount: number;
    templateIds: string[];
  }[];
};

function imageSlotIds(template: TemplateDef): string[] {
  const itemImages = template.items?.images ?? [];
  if (template.images.length === 0 && itemImages.length === 1) {
    const base = itemImages[0].id;
    return Array.from({ length: ITEMS_GRID_CAPACITY }, (_, index) => `${base}[${index}]`);
  }
  return template.images.map((slot) => slot.id);
}

function textSlotIds(template: TemplateDef): string[] {
  return [
    ...template.texts.map((slot) => slot.id),
    ...(template.items?.texts ?? []).map((slot) => `items.${slot.id}`),
  ];
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

test('every active template has a preview PNG and matching metadata', () => {
  for (const templateId of TEMPLATE_IDS) {
    const template = TEMPLATES[templateId];
    const pngPath = path.join(PREVIEW_DIR, `${templateId}.png`);
    const metadataPath = path.join(PREVIEW_DIR, `${templateId}.json`);

    assert.equal(existsSync(pngPath), true, `${templateId} preview PNG should exist`);
    assert.deepEqual(readFileSync(pngPath).subarray(0, 8), PNG_SIGNATURE);

    const metadata = readJson<PreviewMetadata>(metadataPath);
    assert.equal(metadata.templateId, templateId);
    assert.equal(metadata.category, template.category);
    assert.deepEqual(metadata.imageSlotIds, imageSlotIds(template));
    assert.equal(metadata.imageSlotCount, metadata.imageSlotIds.length);
    assert.deepEqual(metadata.textSlotIds, textSlotIds(template));
    assert.equal(metadata.textSlotCount, metadata.textSlotIds.length);
    assert.match(metadata.structureDescription, new RegExp(`^${templateId} `));
  }
});

test('preview metadata has no orphan files for inactive templates', () => {
  const active = new Set<string>(TEMPLATE_IDS);
  const metadataIds = readdirSync(PREVIEW_DIR)
    .filter((entry) => entry.endsWith('.json') && entry !== 'manifest.json')
    .map((entry) => path.basename(entry, '.json'))
    .sort();

  assert.deepEqual(metadataIds, [...active].sort());
});

test('manifest capacity buckets match template JSON categories and image slot counts', () => {
  const manifest = readJson<PreviewManifest>(MANIFEST_PATH);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.generatedFrom, 'packages/contracts/templates/*.json');

  const manifestById = new Map(manifest.templates.map((entry) => [entry.templateId, entry]));
  assert.deepEqual([...manifestById.keys()].sort(), [...TEMPLATE_IDS].sort());

  const expectedBuckets = new Map<string, string[]>();
  for (const templateId of TEMPLATE_IDS) {
    const template = TEMPLATES[templateId];
    const expectedSlotIds = imageSlotIds(template);
    const manifestEntry = manifestById.get(templateId);

    assert.ok(manifestEntry, `${templateId} should be in manifest`);
    assert.equal(manifestEntry.category, template.category);
    assert.equal(manifestEntry.imageSlotCount, expectedSlotIds.length);
    assert.deepEqual(manifestEntry.imageSlotIds, expectedSlotIds);

    const bucketKey = `${template.category}:${expectedSlotIds.length}`;
    expectedBuckets.set(bucketKey, [...(expectedBuckets.get(bucketKey) ?? []), templateId]);
  }

  const actualBuckets = new Map(
    manifest.capacityBuckets.map((bucket) => [
      `${bucket.category}:${bucket.imageSlotCount}`,
      bucket.templateIds,
    ]),
  );

  assert.deepEqual(
    Object.fromEntries([...actualBuckets].sort()),
    Object.fromEntries(
      [...expectedBuckets]
        .map(([key, ids]) => [key, ids.sort()] as const)
        .sort(),
    ),
  );
});

test('template preview check command exits cleanly for generated assets', () => {
  execFileSync('pnpm', ['--filter', '@yujee/web', 'template-previews:check'], {
    cwd: REPO_ROOT,
    stdio: 'pipe',
  });
});
