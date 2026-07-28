import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
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
const DECIMAL_TOKEN = /^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?$/;
const LOG_COMPANION_IDS = new Set<string>([
  'cloudy-cool', 'airy-japanese', 'travel-cinematic', 'daily-soft', 'teal-orange-outdoor',
  'cool-cyan', 'rich-teal-orange', 'night-film', 'forest-green', 'retro-film', 'fuji-clear',
  'dark-cool-cinema', 'kodak-daylight', 'sunny-soft', 'autumn-warm', 'altay-wilderness',
  'warm-cinema-film', 'muted-cinema', 'kodak-2383', 'fresh-clear', 'green-book',
]);

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

type CompiledLuts = {
  provenance: Provenance;
  fullResources: Array<{ name: string; bytes: Uint8Array }>;
  thumbs: Uint8Array;
};

export type BuildLutsTestHooks = {
  renameSync?: typeof renameSync;
};

function error(message: string): never {
  throw new Error(`LUT build: ${message}`);
}

function parseFiniteNumber(value: string, description: string): number {
  if (!DECIMAL_TOKEN.test(value)) error(`${description} must be a decimal or scientific number`);
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

function logCompanionName(sourceName: string): string {
  return sourceName.replace(/(?:-709)?\.cube$/, '-LOG.cube');
}

function expectedSourceCubeNames(): Set<string> {
  const names: Set<string> = new Set(LUT_DEFINITIONS.map(({ source }) => source));
  for (const definition of LUT_DEFINITIONS) {
    if (LOG_COMPANION_IDS.has(definition.id)) names.add(logCompanionName(definition.source));
  }
  return names;
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

export function parseSourceArgument(argv: string[]): string {
  if (argv.length !== 4 || argv[2] !== '--source' || !isAbsolute(argv[3])) {
    error('usage: tsx scripts/build-luts.ts --source <absolute-dir>');
  }
  const sourceDirectory = realpathSync(argv[3]);
  if (!statSync(sourceDirectory).isDirectory()) error('--source must name a directory');
  return sourceDirectory;
}

function assertExpectedRegularFile(path: string, description: string): void {
  if (!statSync(path).isFile()) error(`${description} is not a regular file`);
}

function validateSourceDirectory(sourceDirectory: string): Map<string, string> {
  validateManifest();
  const expectedCubeNames = expectedSourceCubeNames();
  for (const entry of readdirSync(sourceDirectory, { withFileTypes: true })) {
    if (entry.name.endsWith('.cube') && !expectedCubeNames.has(entry.name)) {
      error(`unexpected source cube: ${entry.name}`);
    }
  }

  const selectedSources = new Map<string, string>();
  for (const definition of LUT_DEFINITIONS) {
    selectedSources.set(definition.source, resolveManifestSource(sourceDirectory, definition.source));
  }
  return selectedSources;
}

function assertOutputDirectoryIsUnambiguous(outputDirectory: string, expectedFullNames: Set<string>): void {
  if (!existsSync(outputDirectory)) return;
  if (!statSync(outputDirectory).isDirectory()) error('output target must be a directory');

  const expectedRootNames = new Set(['README.md', 'provenance.json', 'thumbs.bin.gz', 'full']);
  const rootNames = readdirSync(outputDirectory);
  for (const name of rootNames) {
    if (!expectedRootNames.has(name)) error(`unexpected output artifact: ${name}`);
  }
  for (const name of expectedRootNames) {
    if (!rootNames.includes(name)) error(`missing output artifact: ${name}`);
  }
  assertExpectedRegularFile(resolve(outputDirectory, 'README.md'), 'README.md');
  assertExpectedRegularFile(resolve(outputDirectory, 'provenance.json'), 'provenance.json');
  assertExpectedRegularFile(resolve(outputDirectory, 'thumbs.bin.gz'), 'thumbs.bin.gz');

  const fullDirectory = resolve(outputDirectory, 'full');
  if (!statSync(fullDirectory).isDirectory()) error('full output directory is not a directory');
  for (const name of readdirSync(fullDirectory)) {
    if (!expectedFullNames.has(name)) error(`unexpected output artifact: full/${name}`);
    assertExpectedRegularFile(resolve(fullDirectory, name), `full/${name}`);
  }
  for (const name of expectedFullNames) {
    if (!existsSync(resolve(fullDirectory, name))) error(`missing output artifact: full/${name}`);
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
    '## Green Book 709 provenance',
    '',
    'The original LUT tool’s embedded `LUT_MANIFEST` identifies `绿皮书质感:复古:雪山:人像:风光` with distinct `o709`/`l709` and `oLOG`/`lLOG` slots. The unsuffixed source selected here is the original tool’s 709 slot; its `-LOG.cube` companion is deliberately excluded.',
    '',
    '## Licensing provenance',
    '',
    'The supplied source directory included LUT files and a scene-name mapping, but no license or copyright statement. This repository asserts no license for the LUT data. Before redistributing or using these generated resources beyond the authorized project, verify permission with the original LUT rights holder.',
    '',
  ].join('\n');
}

function compileLuts(sourceDirectory: string): CompiledLuts {
  const sourceRoot = realpathSync(sourceDirectory);
  if (!statSync(sourceRoot).isDirectory()) error('--source must name a directory');
  const selectedSources = validateSourceDirectory(sourceRoot);

  const thumbs = new Uint8Array(LUT_DEFINITIONS.length * THUMB_BYTES);
  const entries: Provenance['entries'] = [];
  const fullResources: CompiledLuts['fullResources'] = [];

  for (const [index, definition] of LUT_DEFINITIONS.entries()) {
    const sourcePath = selectedSources.get(definition.source);
    if (!sourcePath) error(`missing manifest source: ${definition.source}`);
    const sourceBytes = Uint8Array.from(readFileSync(sourcePath));
    const fullData = parseCube33(new TextDecoder().decode(sourceBytes));
    const fullGzip = gzip(fullData);
    const thumbData = downsample33To17(fullData);

    thumbs.set(thumbData, index * THUMB_BYTES);
    fullResources.push({ name: `${definition.id}.bin.gz`, bytes: fullGzip });
    entries.push({
      lutId: definition.id,
      source: definition.source,
      sourceSha256: sha256(sourceBytes),
      fullSha256: sha256(fullGzip),
    });
  }

  const provenance: Provenance = {
    version: 'pf-v1',
    sourceDirectoryLabel: SOURCE_DIRECTORY_LABEL,
    entries,
  };
  return { provenance, fullResources, thumbs: gzip(thumbs) };
}

function errorMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

function replaceOutputTree(
  outputDirectory: string,
  compiled: CompiledLuts,
  hooks: BuildLutsTestHooks = {},
): void {
  const target = resolve(outputDirectory);
  if (basename(target) !== 'luts') error('output target must be a luts directory');
  const parent = dirname(target);
  mkdirSync(parent, { recursive: true });
  const stage = mkdtempSync(resolve(parent, '.luts-stage-'));
  const rename = hooks.renameSync ?? renameSync;
  let backupReservation: string | undefined;
  let backup: string | undefined;
  let movedExisting = false;
  let published = false;
  let restored = false;

  try {
    const stagedFullDirectory = resolve(stage, 'full');
    mkdirSync(stagedFullDirectory);
    for (const resource of compiled.fullResources) writeFileSync(resolve(stagedFullDirectory, resource.name), resource.bytes);
    writeFileSync(resolve(stage, 'thumbs.bin.gz'), compiled.thumbs);
    writeFileSync(resolve(stage, 'provenance.json'), `${JSON.stringify(compiled.provenance, null, 2)}\n`);
    writeFileSync(resolve(stage, 'README.md'), readme());

    if (existsSync(target)) {
      backupReservation = mkdtempSync(resolve(parent, '.luts-backup-'));
      backup = resolve(backupReservation, 'previous-output');
      rename(target, backup);
      movedExisting = true;
    }
    rename(stage, target);
    published = true;
  } catch (caught) {
    if (movedExisting && backup && !existsSync(target) && existsSync(backup)) {
      try {
        rename(backup, target);
        restored = true;
      } catch (restoreCaught) {
        throw new Error(
          `LUT build: publication failed (${errorMessage(caught)}); restoration failed (${errorMessage(restoreCaught)}); previous output preserved at ${backup}`,
        );
      }
    }
    throw caught;
  } finally {
    if (existsSync(stage)) rmSync(stage, { recursive: true, force: true });
    if (backupReservation && (!movedExisting || published || restored) && existsSync(backupReservation)) {
      rmSync(backupReservation, { recursive: true, force: true });
    }
  }
}

function buildLutsWithHooks(
  sourceDirectory: string,
  outputDirectory: string,
  hooks: BuildLutsTestHooks = {},
): Provenance {
  const target = resolve(outputDirectory);
  const expectedFullNames = new Set(LUT_DEFINITIONS.map(({ id }) => `${id}.bin.gz`));
  assertOutputDirectoryIsUnambiguous(target, expectedFullNames);
  const compiled = compileLuts(sourceDirectory);
  replaceOutputTree(target, compiled, hooks);
  return compiled.provenance;
}

export function buildLuts(sourceDirectory: string, outputDirectory = OUTPUT_DIRECTORY): Provenance {
  return buildLutsWithHooks(sourceDirectory, outputDirectory);
}

/** Narrow test-only entry point for deterministic publication-failure coverage. */
export function buildLutsForTest(
  sourceDirectory: string,
  outputDirectory: string,
  hooks: BuildLutsTestHooks,
): Provenance {
  return buildLutsWithHooks(sourceDirectory, outputDirectory, hooks);
}

function main(): void {
  const sourceDirectory = parseSourceArgument(process.argv);
  const provenance = buildLuts(sourceDirectory);
  process.stdout.write(`Built ${provenance.entries.length} LUTs in ${OUTPUT_DIRECTORY}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
