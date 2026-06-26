import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

import { TEMPLATE_IDS, TEMPLATES, type TemplateDef } from '@yujee/contracts/templates';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../../..');
const PREVIEW_DIR = path.join(REPO_ROOT, 'packages/contracts/template-previews');
const BUCKET_DIR = path.join(PREVIEW_DIR, 'capacity-buckets');
const GENERATED_FROM = 'packages/contracts/templates/*.json';
const SCHEMA_VERSION = 1;
const ITEMS_GRID_CAPACITY = 4;
const PREVIEW_WIDTH = 200;
const PREVIEW_HEIGHT = 283;
const BUCKET_CARD_WIDTH = 96;
const BUCKET_CARD_HEIGHT = 136;
const BUCKET_COLUMNS = 4;
const CATEGORY_ORDER = ['cover', 'toc', 'interior', 'ending'];

type Rgba = [number, number, number, number];

type PreviewMetadata = {
  schemaVersion: number;
  templateId: string;
  category: string;
  imageSlotCount: number;
  imageSlotIds: string[];
  textSlotCount: number;
  textSlotIds: string[];
  structureDescription: string;
};

type CapacityBucket = {
  category: string;
  imageSlotCount: number;
  templateIds: string[];
  contactSheet: string;
};

type PreviewManifest = {
  schemaVersion: number;
  generatedFrom: string;
  previewImageType: 'image/png';
  itemGridCapacity: number;
  templates: PreviewMetadata[];
  capacityBuckets: CapacityBucket[];
};

type OutputFile = {
  relativePath: string;
  data: Buffer | string;
};

class Canvas {
  readonly pixels: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
    fill: Rgba,
  ) {
    this.pixels = new Uint8Array(width * height * 4);
    this.fill(fill);
  }

  fill(color: Rgba): void {
    for (let i = 0; i < this.pixels.length; i += 4) {
      this.pixels[i] = color[0];
      this.pixels[i + 1] = color[1];
      this.pixels[i + 2] = color[2];
      this.pixels[i + 3] = color[3];
    }
  }

  setPixel(x: number, y: number, color: Rgba): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const offset = (Math.floor(y) * this.width + Math.floor(x)) * 4;
    this.pixels[offset] = color[0];
    this.pixels[offset + 1] = color[1];
    this.pixels[offset + 2] = color[2];
    this.pixels[offset + 3] = color[3];
  }

  rect(x: number, y: number, width: number, height: number, color: Rgba): void {
    const left = Math.max(0, Math.floor(x));
    const top = Math.max(0, Math.floor(y));
    const right = Math.min(this.width, Math.ceil(x + width));
    const bottom = Math.min(this.height, Math.ceil(y + height));
    for (let py = top; py < bottom; py += 1) {
      for (let px = left; px < right; px += 1) {
        this.setPixel(px, py, color);
      }
    }
  }

  strokeRect(x: number, y: number, width: number, height: number, color: Rgba): void {
    this.rect(x, y, width, 1, color);
    this.rect(x, y + height - 1, width, 1, color);
    this.rect(x, y, 1, height, color);
    this.rect(x + width - 1, y, 1, height, color);
  }
}

const COLORS = {
  background: [242, 240, 234, 255] as Rgba,
  page: [252, 251, 247, 255] as Rgba,
  border: [45, 45, 45, 255] as Rgba,
  hairline: [176, 171, 160, 255] as Rgba,
  image: [166, 170, 174, 255] as Rgba,
  imageAlt: [190, 193, 196, 255] as Rgba,
  imageStroke: [104, 108, 113, 255] as Rgba,
  text: [80, 83, 86, 255] as Rgba,
  textSlot: [210, 171, 96, 255] as Rgba,
  title: [36, 38, 40, 255] as Rgba,
  bucket: [230, 226, 216, 255] as Rgba,
};

const FONT: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '010', '010', '111'],
  '2': ['111', '001', '001', '111', '100', '100', '111'],
  '3': ['111', '001', '001', '111', '001', '001', '111'],
  '4': ['101', '101', '101', '111', '001', '001', '001'],
  '5': ['111', '100', '100', '111', '001', '001', '111'],
  '6': ['111', '100', '100', '111', '101', '101', '111'],
  '7': ['111', '001', '001', '010', '010', '010', '010'],
  '8': ['111', '101', '101', '111', '101', '101', '111'],
  '9': ['111', '101', '101', '111', '001', '001', '111'],
  A: ['010', '101', '101', '111', '101', '101', '101'],
  C: ['111', '100', '100', '100', '100', '100', '111'],
  E: ['111', '100', '100', '111', '100', '100', '111'],
  G: ['111', '100', '100', '101', '101', '101', '111'],
  I: ['111', '010', '010', '010', '010', '010', '111'],
  M: ['101', '111', '111', '101', '101', '101', '101'],
  P: ['111', '101', '101', '111', '100', '100', '100'],
  T: ['111', '010', '010', '010', '010', '010', '010'],
  '-': ['000', '000', '000', '111', '000', '000', '000'],
  ' ': ['000', '000', '000', '000', '000', '000', '000'],
};

function drawText(canvas: Canvas, text: string, x: number, y: number, color: Rgba, scale = 2): void {
  let cursor = x;
  for (const char of text.toUpperCase()) {
    const glyph = FONT[char] ?? FONT[' '];
    for (let row = 0; row < glyph.length; row += 1) {
      for (let col = 0; col < glyph[row].length; col += 1) {
        if (glyph[row][col] === '1') {
          canvas.rect(cursor + col * scale, y + row * scale, scale, scale, color);
        }
      }
    }
    cursor += 4 * scale;
  }
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, payload: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, payload])), 0);
  return Buffer.concat([length, typeBuffer, payload, crc]);
}

function encodePng(canvas: Canvas): Buffer {
  const raw = Buffer.alloc((canvas.width * 4 + 1) * canvas.height);
  for (let y = 0; y < canvas.height; y += 1) {
    const rowStart = y * (canvas.width * 4 + 1);
    raw[rowStart] = 0;
    const sourceStart = y * canvas.width * 4;
    Buffer.from(canvas.pixels.buffer, sourceStart, canvas.width * 4).copy(raw, rowStart + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(canvas.width, 0);
  ihdr.writeUInt32BE(canvas.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function isItemsGridTemplate(template: TemplateDef): boolean {
  return template.images.length === 0 && (template.items?.images ?? []).length === 1;
}

function imageSlotIds(template: TemplateDef): string[] {
  if (isItemsGridTemplate(template)) {
    const base = template.items?.images?.[0].id ?? 'image';
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

function layoutPhrase(imageCount: number, textCount: number): string {
  const imagePhrase =
    imageCount === 0
      ? 'no image blocks'
      : imageCount === 1
        ? 'one dominant image block'
        : imageCount === 2
          ? 'two balanced image blocks'
          : imageCount === 3
            ? 'one lead block plus two supporting blocks'
            : `${imageCount} image blocks in a grid`;
  const textPhrase =
    textCount === 0
      ? 'no text slots'
      : textCount === 1
        ? 'one text slot'
        : `${textCount} text slots`;
  return `${imagePhrase}; ${textPhrase}.`;
}

function buildMetadata(templateId: string, template: TemplateDef): PreviewMetadata {
  const images = imageSlotIds(template);
  const texts = textSlotIds(template);
  return {
    schemaVersion: SCHEMA_VERSION,
    templateId,
    category: template.category,
    imageSlotCount: images.length,
    imageSlotIds: images,
    textSlotCount: texts.length,
    textSlotIds: texts,
    structureDescription: `${templateId} ${template.category} template with ${images.length} image slot(s) (${images.join(', ') || 'none'}) and ${texts.length} text slot(s) (${texts.join(', ') || 'none'}). ${layoutPhrase(images.length, texts.length)}`,
  };
}

function imageRects(count: number, x: number, y: number, width: number, height: number): Array<[number, number, number, number]> {
  if (count <= 0) return [];
  if (count === 1) return [[x, y, width, height]];
  if (count === 2) {
    const gap = 8;
    const cellWidth = Math.floor((width - gap) / 2);
    return [
      [x, y, cellWidth, height],
      [x + cellWidth + gap, y, width - cellWidth - gap, height],
    ];
  }
  if (count === 3) {
    const gap = 8;
    const leadHeight = Math.floor(height * 0.58);
    const smallHeight = height - leadHeight - gap;
    const smallWidth = Math.floor((width - gap) / 2);
    return [
      [x, y, width, leadHeight],
      [x, y + leadHeight + gap, smallWidth, smallHeight],
      [x + smallWidth + gap, y + leadHeight + gap, width - smallWidth - gap, smallHeight],
    ];
  }

  const columns = count <= 4 ? 2 : Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  const gap = 6;
  const cellWidth = Math.floor((width - gap * (columns - 1)) / columns);
  const cellHeight = Math.floor((height - gap * (rows - 1)) / rows);
  return Array.from({ length: count }, (_, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    return [
      x + col * (cellWidth + gap),
      y + row * (cellHeight + gap),
      col === columns - 1 ? width - col * (cellWidth + gap) : cellWidth,
      row === rows - 1 ? height - row * (cellHeight + gap) : cellHeight,
    ];
  });
}

function drawTemplateCard(canvas: Canvas, metadata: PreviewMetadata, x: number, y: number, width: number, height: number): void {
  canvas.rect(x, y, width, height, COLORS.page);
  canvas.strokeRect(x, y, width, height, COLORS.border);
  canvas.rect(x + 1, y + 1, width - 2, 18, COLORS.bucket);
  drawText(canvas, metadata.templateId, x + 7, y + 5, COLORS.title, 1);

  const categoryLetter = metadata.category.slice(0, 1).toUpperCase();
  drawText(canvas, categoryLetter, x + width - 14, y + 5, COLORS.text, 1);

  const imageTop = y + 28;
  const imageHeight = Math.max(36, Math.floor(height * 0.55));
  const rects = imageRects(
    metadata.imageSlotCount,
    x + 12,
    imageTop,
    width - 24,
    imageHeight,
  );
  rects.forEach(([rx, ry, rw, rh], index) => {
    canvas.rect(rx, ry, rw, rh, index % 2 === 0 ? COLORS.image : COLORS.imageAlt);
    canvas.strokeRect(rx, ry, rw, rh, COLORS.imageStroke);
  });

  if (rects.length === 0) {
    canvas.strokeRect(x + 26, imageTop + 8, width - 52, Math.max(20, imageHeight - 16), COLORS.hairline);
  }

  const textTop = imageTop + imageHeight + 10;
  const maxLines = Math.max(1, Math.min(metadata.textSlotCount, 8));
  for (let index = 0; index < maxLines; index += 1) {
    const lineY = textTop + index * 6;
    const lineWidth = Math.max(18, width - 36 - (index % 3) * 10);
    canvas.rect(x + 18, lineY, lineWidth, 2, COLORS.textSlot);
  }
}

function renderTemplatePreview(metadata: PreviewMetadata): Buffer {
  const canvas = new Canvas(PREVIEW_WIDTH, PREVIEW_HEIGHT, COLORS.background);
  drawTemplateCard(canvas, metadata, 10, 10, PREVIEW_WIDTH - 20, PREVIEW_HEIGHT - 20);
  return encodePng(canvas);
}

function renderBucketSheet(bucket: CapacityBucket, metadataById: Map<string, PreviewMetadata>): Buffer {
  const rows = Math.ceil(bucket.templateIds.length / BUCKET_COLUMNS);
  const width = BUCKET_COLUMNS * BUCKET_CARD_WIDTH + (BUCKET_COLUMNS + 1) * 12;
  const height = rows * BUCKET_CARD_HEIGHT + (rows + 1) * 14 + 20;
  const canvas = new Canvas(width, height, COLORS.background);
  drawText(canvas, `${bucket.category.slice(0, 1)}-${bucket.imageSlotCount}`, 12, 8, COLORS.title, 2);

  bucket.templateIds.forEach((templateId, index) => {
    const col = index % BUCKET_COLUMNS;
    const row = Math.floor(index / BUCKET_COLUMNS);
    const x = 12 + col * (BUCKET_CARD_WIDTH + 12);
    const y = 34 + row * (BUCKET_CARD_HEIGHT + 14);
    const metadata = metadataById.get(templateId);
    if (metadata) drawTemplateCard(canvas, metadata, x, y, BUCKET_CARD_WIDTH, BUCKET_CARD_HEIGHT);
  });

  return encodePng(canvas);
}

function compareCategoryThenCapacity(a: CapacityBucket, b: CapacityBucket): number {
  const categoryDiff = CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category);
  return (
    categoryDiff ||
    a.imageSlotCount - b.imageSlotCount ||
    a.category.localeCompare(b.category)
  );
}

function buildManifest(metadata: PreviewMetadata[]): PreviewManifest {
  const buckets = new Map<string, CapacityBucket>();
  for (const entry of metadata) {
    const key = `${entry.category}:${entry.imageSlotCount}`;
    const existing =
      buckets.get(key) ??
      {
        category: entry.category,
        imageSlotCount: entry.imageSlotCount,
        templateIds: [],
        contactSheet: `capacity-buckets/${entry.category}-${entry.imageSlotCount}.png`,
      };
    existing.templateIds.push(entry.templateId);
    buckets.set(key, existing);
  }

  const capacityBuckets = [...buckets.values()]
    .map((bucket) => ({
      ...bucket,
      templateIds: bucket.templateIds.sort(),
    }))
    .sort(compareCategoryThenCapacity);

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedFrom: GENERATED_FROM,
    previewImageType: 'image/png',
    itemGridCapacity: ITEMS_GRID_CAPACITY,
    templates: metadata,
    capacityBuckets,
  };
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function buildOutputs(): OutputFile[] {
  const metadata = TEMPLATE_IDS.map((templateId) => buildMetadata(templateId, TEMPLATES[templateId]));
  const metadataById = new Map(metadata.map((entry) => [entry.templateId, entry]));
  const manifest = buildManifest(metadata);
  const outputs: OutputFile[] = [];

  for (const entry of metadata) {
    outputs.push({ relativePath: `${entry.templateId}.png`, data: renderTemplatePreview(entry) });
    outputs.push({ relativePath: `${entry.templateId}.json`, data: stableJson(entry) });
  }

  outputs.push({ relativePath: 'manifest.json', data: stableJson(manifest) });

  for (const bucket of manifest.capacityBuckets) {
    outputs.push({
      relativePath: bucket.contactSheet,
      data: renderBucketSheet(bucket, metadataById),
    });
  }

  return outputs.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

async function listFilesRecursive(root: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(path.join(root, prefix), { withFileTypes: true }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  });
  const files: string[] = [];
  for (const entry of entries) {
    const relativePath = path.join(prefix, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(root, relativePath)));
    } else if (entry.isFile()) {
      files.push(relativePath.split(path.sep).join('/'));
    }
  }
  return files.sort();
}

async function writeOutputs(outputs: OutputFile[]): Promise<void> {
  await rm(PREVIEW_DIR, { recursive: true, force: true });
  await mkdir(BUCKET_DIR, { recursive: true });
  for (const output of outputs) {
    const destination = path.join(PREVIEW_DIR, output.relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, output.data);
  }
}

async function checkOutputs(outputs: OutputFile[]): Promise<void> {
  const expected = new Map(outputs.map((output) => [output.relativePath, output.data]));
  const actualFiles = await listFilesRecursive(PREVIEW_DIR);
  const expectedFiles = [...expected.keys()].sort();
  const errors: string[] = [];

  for (const relativePath of expectedFiles) {
    const fullPath = path.join(PREVIEW_DIR, relativePath);
    if (!(await stat(fullPath).catch(() => null))) {
      errors.push(`missing ${relativePath}`);
      continue;
    }

    const actual = await readFile(fullPath);
    const expectedData = expected.get(relativePath);
    const expectedBuffer = Buffer.isBuffer(expectedData)
      ? expectedData
      : Buffer.from(expectedData ?? '', 'utf8');
    if (!actual.equals(expectedBuffer)) {
      errors.push(`stale ${relativePath}`);
    }
  }

  for (const relativePath of actualFiles) {
    if (!expected.has(relativePath)) {
      errors.push(`orphan ${relativePath}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `template preview assets are out of sync; run pnpm --filter @yujee/web template-previews:generate\n${errors.join('\n')}`,
    );
  }
}

async function main(): Promise<void> {
  const checkMode = process.argv.includes('--check');
  const outputs = buildOutputs();

  if (checkMode) {
    await checkOutputs(outputs);
    return;
  }

  await writeOutputs(outputs);
  console.log(`baked ${TEMPLATE_IDS.length} template previews into ${path.relative(REPO_ROOT, PREVIEW_DIR)}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
