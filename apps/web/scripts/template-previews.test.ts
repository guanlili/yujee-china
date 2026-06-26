import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ITEMS_GRID_CAPACITY,
  TEMPLATE_IDS,
  TEMPLATES,
  type TemplateDef,
  validateSlotsForTemplate,
} from '@yujee/contracts/templates';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../../..');
const PREVIEW_DIR = path.join(REPO_ROOT, 'packages/contracts/template-previews');
const MANIFEST_PATH = path.join(PREVIEW_DIR, 'manifest.json');
const ROOT_PACKAGE_PATH = path.join(REPO_ROOT, 'package.json');
const WEB_PACKAGE_PATH = path.join(REPO_ROOT, 'apps/web/package.json');
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type PreviewMetadata = {
  templateId: string;
  category: string;
  imageSlotCount: number;
  imageSlotIds: string[];
  textSlotCount: number;
  textSlotIds: string[];
  repeatTextSlots?: {
    id: string;
    addressPattern: string;
    repeat: 'fixed' | 'variable';
    count?: number;
  }[];
  structureDescription: string;
};

type PreviewManifest = {
  schemaVersion: number;
  generatedFrom: string;
  itemGridCapacity: number;
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

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

function runPreviewScript(args: string[]) {
  return spawnSync(
    'pnpm',
    ['--filter', '@yujee/web', 'exec', 'tsx', 'scripts/bake-template-previews.ts', ...args],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    },
  );
}

function generateTempAssets(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'template-previews-'));
  execFileSync(
    'pnpm',
    ['--filter', '@yujee/web', 'exec', 'tsx', 'scripts/bake-template-previews.ts', '--output-dir', dir],
    {
      cwd: REPO_ROOT,
      stdio: 'pipe',
    },
  );
  return dir;
}

function checkTempAssets(dir: string) {
  return runPreviewScript(['--check', '--output-dir', dir]);
}

test('template preview checks are wired into aggregate package gates', () => {
  const rootPackage = readJson<{ scripts: Record<string, string> }>(ROOT_PACKAGE_PATH);
  const webPackage = readJson<{ scripts: Record<string, string> }>(WEB_PACKAGE_PATH);

  assert.match(
    webPackage.scripts.test,
    /scripts\/\*\*\/\*\.test\.ts/,
    'web test must include script tests so pnpm -r test runs template preview guards',
  );
  assert.match(
    rootPackage.scripts.typecheck,
    /template-previews:check/,
    'root typecheck must run template-previews:check to block stale preview assets',
  );
});

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
    assert.equal(metadata.textSlotCount, metadata.textSlotIds.length);
    assert.match(metadata.structureDescription, new RegExp(`^${templateId} `));

    const slotValidation = validateSlotsForTemplate(
      templateId,
      metadata.imageSlotIds,
      metadata.textSlotIds,
    );
    assert.deepEqual(slotValidation, { ok: true }, `${templateId} metadata slot ids must be render-addressable`);
  }
});

test('fixed repeat text metadata uses concrete render-time bracket slot ids', () => {
  const metadata = readJson<PreviewMetadata>(path.join(PREVIEW_DIR, 'mag-10.json'));

  assert.deepEqual(metadata.textSlotIds, [
    'folio',
    'explain[0]',
    'explain[1]',
    'explain[2]',
    'explain[3]',
  ]);
  assert.equal(metadata.textSlotCount, 5);
  assert.deepEqual(metadata.repeatTextSlots, [
    {
      id: 'explain',
      addressPattern: 'explain[n]',
      repeat: 'fixed',
      count: 4,
    },
  ]);
});

test('variable repeat text metadata declares address pattern without fake concrete slots', () => {
  const metadata = readJson<PreviewMetadata>(path.join(PREVIEW_DIR, 'mag-02.json'));

  assert.deepEqual(metadata.textSlotIds, ['title', 'folio']);
  assert.equal(metadata.textSlotCount, 2);
  assert.deepEqual(metadata.repeatTextSlots, [
    { id: 'number', addressPattern: 'number[n]', repeat: 'variable' },
    { id: 'title', addressPattern: 'title[n]', repeat: 'variable' },
    { id: 'description', addressPattern: 'description[n]', repeat: 'variable' },
  ]);
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
  assert.equal(manifest.itemGridCapacity, ITEMS_GRID_CAPACITY);

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

test('template preview check reports missing files in a temp output directory', () => {
  const dir = generateTempAssets();
  try {
    rmSync(path.join(dir, 'mag-01.png'));

    const result = checkTempAssets(dir);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /missing mag-01\.png/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('template preview check reports stale PNG bytes in a temp output directory', () => {
  const dir = generateTempAssets();
  try {
    writeFileSync(path.join(dir, 'mag-01.png'), Buffer.from('not-a-preview-png'));

    const result = checkTempAssets(dir);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /stale mag-01\.png/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('template preview check reports stale JSON bytes in a temp output directory', () => {
  const dir = generateTempAssets();
  try {
    writeFileSync(path.join(dir, 'mag-01.json'), '{"templateId":"mag-01","stale":true}\n');

    const result = checkTempAssets(dir);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /stale mag-01\.json/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('template preview check reports root and capacity-bucket orphan assets', () => {
  const dir = generateTempAssets();
  try {
    writeFileSync(path.join(dir, 'orphan.json'), '{}\n');
    writeFileSync(path.join(dir, 'capacity-buckets', 'orphan.png'), Buffer.from('orphan'));

    const result = checkTempAssets(dir);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /orphan orphan\.json/);
    assert.match(`${result.stdout}\n${result.stderr}`, /orphan capacity-buckets\/orphan\.png/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
