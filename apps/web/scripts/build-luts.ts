import { createHash } from 'node:crypto';
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

import { LUT_DEFINITIONS, type LutId } from '../src/lib/photo/filter-state.ts';

const FULL_SIZE = 33;
const THUMB_SIZE = 17;
const CHANNELS = 3;
const FULL_BYTES = FULL_SIZE ** 3 * CHANNELS;
const THUMB_BYTES = THUMB_SIZE ** 3 * CHANNELS;
const OUTPUT_DIRECTORY = resolve(dirname(fileURLToPath(import.meta.url)), '../public/luts');
const SOURCE_DIRECTORY_LABEL = '精选26色LUT';

type Provenance = {
  version: 'pf-v1';
  sourceDirectoryLabel: typeof SOURCE_DIRECTORY_LABEL;
  entries: Array<{
    lutId: LutId;
    source: string;
    sourceSha256: string;
    fullSha256: string;
  }>;
};

function error(message: string): never {
  throw new Error(`LUT build: ${message}`);
}

function parseFiniteNumber(value: string, description: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) error(`${description} must be finite`);
  return parsed;
}

function validateDomainMetadata(parts: string[], lineNumber: number): void {
  if (parts.length !== 4) error(`line ${lineNumber}: ${parts[0]} must contain three numbers`);
  for (const value of parts.slice(1)) parseFiniteNumber(value, `line ${lineNumber}: ${parts[0]}`);
}

/** Parses a 33³ .cube file into RGB bytes in the file's native cube order. */
export function parseCube33(text: string): Uint8Array {
  const bytes = new Uint8Array(FULL_BYTES);
  let sampleCount = 0;
  let lutSize: number | undefined;

  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const lineNumber = index + 1;
    const line = rawLine.replace(/^\uFEFF/, '').replace(/\s*#.*$/, '').trim();
    if (!line) continue;

    const parts = line.split(/\s+/);
    const directive = parts[0];

    if (directive === 'LUT_3D_SIZE') {
      if (lutSize !== undefined || parts.length !== 2) error(`line ${lineNumber}: malformed LUT_3D_SIZE`);
      const parsedSize = parseFiniteNumber(parts[1], `line ${lineNumber}: LUT_3D_SIZE`);
      if (!Number.isInteger(parsedSize) || parsedSize !== FULL_SIZE) {
        error(`line ${lineNumber}: LUT_3D_SIZE 33 is required`);
      }
      lutSize = parsedSize;
      continue;
    }

    if (directive === 'TITLE') {
      if (parts.length < 2) error(`line ${lineNumber}: TITLE must have a value`);
      continue;
    }

    if (directive === 'DOMAIN_MIN' || directive === 'DOMAIN_MAX') {
      validateDomainMetadata(parts, lineNumber);
      continue;
    }

    const values = parts.map((part) => parseFiniteNumber(part, `line ${lineNumber}: sample`));
    if (values.length !== CHANNELS) error(`line ${lineNumber}: samples must contain exactly three values`);
    if (lutSize === undefined) error(`line ${lineNumber}: LUT_3D_SIZE must precede samples`);
    if (sampleCount >= FULL_SIZE ** 3) error(`line ${lineNumber}: too many 33³ samples`);

    for (const [channel, value] of values.entries()) {
      if (value < 0 || value > 1) error(`line ${lineNumber}: sample values must be within [0, 1]`);
      bytes[sampleCount * CHANNELS + channel] = Math.round(value * 255);
    }
    sampleCount++;
  }

  if (lutSize !== FULL_SIZE) error('LUT_3D_SIZE 33 is required');
  if (sampleCount !== FULL_SIZE ** 3) {
    error(`expected ${FULL_SIZE ** 3} samples, received ${sampleCount}`);
  }

  return bytes;
}

/** Takes every other grid coordinate, retaining both 0 and 32 cube corners. */
export function downsample33To17(data: Uint8Array): Uint8Array {
  if (data.byteLength !== FULL_BYTES) error(`33³ input must contain ${FULL_BYTES} bytes`);

  const result = new Uint8Array(THUMB_BYTES);
  for (let red = 0; red < THUMB_SIZE; red++) {
    for (let green = 0; green < THUMB_SIZE; green++) {
      for (let blue = 0; blue < THUMB_SIZE; blue++) {
        const sourceOffset = (((red * 2 * FULL_SIZE) + (green * 2)) * FULL_SIZE + blue * 2) * CHANNELS;
        const destinationOffset = ((red * THUMB_SIZE + green) * THUMB_SIZE + blue) * CHANNELS;
        result.set(data.subarray(sourceOffset, sourceOffset + CHANNELS), destinationOffset);
      }
    }
  }
  return result;
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function gzip(data: Uint8Array): Uint8Array {
  return Uint8Array.from(gzipSync(data, { level: 9 }));
}

function validateManifest(): void {
  if (LUT_DEFINITIONS.length !== 26) error('manifest must contain exactly 26 LUT definitions');
  const ids = new Set<string>();
  const sources = new Set<string>();

  for (const definition of LUT_DEFINITIONS) {
    if (ids.has(definition.id)) error(`duplicate LUT id in manifest: ${definition.id}`);
    if (sources.has(definition.source)) error(`ambiguous source mapping in manifest: ${definition.source}`);
    if (basename(definition.source) !== definition.source || !definition.source.endsWith('.cube')) {
      error(`unsafe manifest source mapping: ${definition.source}`);
    }
    ids.add(definition.id);
    sources.add(definition.source);
  }
}

function resolveManifestSource(sourceDirectory: string, sourceName: string): string {
  const candidate = resolve(sourceDirectory, sourceName);
  if (relative(sourceDirectory, candidate).startsWith('..')) error(`unsafe source resolution: ${sourceName}`);

  let sourcePath: string;
  try {
    sourcePath = realpathSync(candidate);
  } catch {
    error(`missing manifest source: ${sourceName}`);
  }

  if (relative(sourceDirectory, sourcePath).startsWith('..') || relative(sourceDirectory, sourcePath) === '') {
    error(`unsafe source resolution: ${sourceName}`);
  }
  if (!statSync(sourcePath).isFile()) error(`manifest source is not a file: ${sourceName}`);
  return sourcePath;
}

function parseSourceArgument(argv: string[]): string {
  if (argv.length !== 4 || argv[2] !== '--source' || !isAbsolute(argv[3])) {
    error('usage: tsx scripts/build-luts.ts --source <absolute-dir>');
  }
  const sourceDirectory = realpathSync(argv[3]);
  if (!statSync(sourceDirectory).isDirectory()) error('--source must name a directory');
  return sourceDirectory;
}

function assertOutputDirectoryIsUnambiguous(expectedFullNames: Set<string>): void {
  const fullDirectory = resolve(OUTPUT_DIRECTORY, 'full');
  try {
    const existingNames = readdirSync(fullDirectory);
    for (const name of existingNames) {
      if (!expectedFullNames.has(name)) error(`unexpected existing full resource: ${name}`);
    }
  } catch (caught) {
    if (caught instanceof Error && 'code' in caught && caught.code === 'ENOENT') return;
    throw caught;
  }
}

function readme(): string {
  return [
    '# Packaged LUT resources',
    '',
    `These binary resources are generated from the 26 selected Rec.709 \`.cube\` files supplied in an external directory labelled \`${SOURCE_DIRECTORY_LABEL}\`. The original \`.cube\` files are intentionally not committed.`,
    '',
    'Rebuild from the approved source directory:',
    '',
    `\`pnpm --filter @yujee/web exec tsx scripts/build-luts.ts --source /absolute/path/to/${SOURCE_DIRECTORY_LABEL}\``,
    '',
    '- `thumbs.bin.gz` contains 26 consecutive 17³ RGB LUTs in `LUT_DEFINITIONS` order.',
    '- `full/<lut-id>.bin.gz` contains one 33³ RGB LUT per manifest ID.',
    '- `provenance.json` records the original source-byte SHA-256 and emitted full-resource SHA-256 for each manifest entry.',
    '',
    '## Licensing provenance',
    '',
    'The supplied source directory included LUT files and a scene-name mapping, but no license or copyright statement. This repository asserts no license for the LUT data. Before redistributing or using these generated resources beyond the authorized project, verify permission with the original LUT rights holder.',
    '',
  ].join('\n');
}

export function buildLuts(sourceDirectory: string): Provenance {
  validateManifest();
  const sourceRoot = realpathSync(sourceDirectory);
  if (!statSync(sourceRoot).isDirectory()) error('--source must name a directory');

  const expectedFullNames = new Set(LUT_DEFINITIONS.map(({ id }) => `${id}.bin.gz`));
  assertOutputDirectoryIsUnambiguous(expectedFullNames);
  const fullDirectory = resolve(OUTPUT_DIRECTORY, 'full');
  mkdirSync(fullDirectory, { recursive: true });

  const thumbs = new Uint8Array(LUT_DEFINITIONS.length * THUMB_BYTES);
  const entries: Provenance['entries'] = [];

  for (const [index, definition] of LUT_DEFINITIONS.entries()) {
    const sourcePath = resolveManifestSource(sourceRoot, definition.source);
    const sourceBytes = Uint8Array.from(readFileSync(sourcePath));
    const fullData = parseCube33(new TextDecoder().decode(sourceBytes));
    const fullGzip = gzip(fullData);
    const thumbData = downsample33To17(fullData);

    thumbs.set(thumbData, index * THUMB_BYTES);
    writeFileSync(resolve(fullDirectory, `${definition.id}.bin.gz`), fullGzip);
    entries.push({
      lutId: definition.id,
      source: definition.source,
      sourceSha256: sha256(sourceBytes),
      fullSha256: sha256(fullGzip),
    });
  }

  writeFileSync(resolve(OUTPUT_DIRECTORY, 'thumbs.bin.gz'), gzip(thumbs));
  const provenance: Provenance = {
    version: 'pf-v1',
    sourceDirectoryLabel: SOURCE_DIRECTORY_LABEL,
    entries,
  };
  writeFileSync(resolve(OUTPUT_DIRECTORY, 'provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`);
  writeFileSync(resolve(OUTPUT_DIRECTORY, 'README.md'), readme());
  return provenance;
}

function main(): void {
  const sourceDirectory = parseSourceArgument(process.argv);
  const provenance = buildLuts(sourceDirectory);
  process.stdout.write(`Built ${provenance.entries.length} LUTs in ${OUTPUT_DIRECTORY}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
