import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import test, { after } from 'node:test';
import { tmpdir } from 'node:os';
import { gunzipSync } from 'node:zlib';

import { LUT_DEFINITIONS } from '../src/lib/photo/filter-state.ts';
import { buildLuts, downsample33To17, parseCube33, parseSourceArgument } from './build-luts.ts';

const CUBE_SIZE = 33;
const CUBE_BYTES = CUBE_SIZE ** 3 * 3;

function identityCube(size = CUBE_SIZE): string {
  const rows = ['# identity LUT', 'TITLE "identity"', `LUT_3D_SIZE ${size}`, 'DOMAIN_MIN 0.0 0.0 0.0', 'DOMAIN_MAX 1.0 1.0 1.0'];

  for (let red = 0; red < size; red++) {
    for (let green = 0; green < size; green++) {
      for (let blue = 0; blue < size; blue++) {
        rows.push(`${red / (size - 1)} ${green / (size - 1)} ${blue / (size - 1)} # RGB`);
      }
    }
  }

  return rows.join('\n');
}

function rgbAt(data: Uint8Array, size: number, red: number, green: number, blue: number): number[] {
  const offset = ((red * size + green) * size + blue) * 3;
  return [...data.slice(offset, offset + 3)];
}

const approvedSourceDirectory = '/Users/smalldog/Desktop/精选26色LUT';
const temporaryDirectories: string[] = [];

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(resolve(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

after(() => {
  for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true });
});

function approvedSourceCopy({ includeLogs = false, unexpectedCube = false } = {}): string {
  const target = temporaryDirectory('yujee-lut-source-');
  for (const definition of LUT_DEFINITIONS) {
    copyFileSync(resolve(approvedSourceDirectory, definition.source), resolve(target, definition.source));
  }
  if (includeLogs) {
    for (const definition of LUT_DEFINITIONS) {
      const logName = definition.source.replace(/(?:-709)?\.cube$/, '-LOG.cube');
      const logPath = resolve(approvedSourceDirectory, logName);
      if (existsSync(logPath)) writeFileSync(resolve(target, logName), 'permitted LOG companion');
    }
  }
  if (unexpectedCube) writeFileSync(resolve(target, 'unregistered-look-709.cube'), 'unexpected');
  return target;
}

function outputHashManifest(outputDirectory: string): string {
  const files = [
    'README.md',
    'provenance.json',
    'thumbs.bin.gz',
    ...readdirSync(resolve(outputDirectory, 'full')).sort().map((name) => `full/${name}`),
  ];
  return files.map((file) => `${createHash('sha256').update(fileBytes(resolve(outputDirectory, file))).digest('hex')} ${file}`).join('\n');
}

function fileBytes(path: string): Uint8Array {
  return Uint8Array.from(readFileSync(path));
}

test('parses a commented 33³ identity cube into quantized RGB bytes', () => {
  const data = parseCube33(identityCube());

  assert.equal(data.byteLength, CUBE_BYTES);
  assert.deepEqual(rgbAt(data, CUBE_SIZE, 0, 0, 0), [0, 0, 0]);
  assert.deepEqual(rgbAt(data, CUBE_SIZE, 32, 32, 32), [255, 255, 255]);
  assert.deepEqual(rgbAt(data, CUBE_SIZE, 13, 17, 29), [104, 135, 231]);
});

test('downsamples 33³ data to 17³ without changing cube coordinate order', () => {
  const result = downsample33To17(parseCube33(identityCube()));

  assert.equal(result.byteLength, 17 ** 3 * 3);
  assert.deepEqual(rgbAt(result, 17, 0, 0, 0), [0, 0, 0]);
  assert.deepEqual(rgbAt(result, 17, 16, 16, 16), [255, 255, 255]);
  assert.deepEqual(rgbAt(result, 17, 5, 9, 14), [80, 143, 223]);
});

test('rejects cubes whose LUT_3D_SIZE is not 33', () => {
  assert.throws(() => parseCube33(identityCube(32)), /LUT_3D_SIZE 33/);
});

test('rejects non-decimal cube number tokens and malformed sample cardinality', () => {
  assert.throws(() => parseCube33(identityCube().replace('LUT_3D_SIZE 33', 'LUT_3D_SIZE 0x21')), /decimal/);
  assert.throws(() => parseCube33(identityCube().replace('0 0 0 # RGB', '0x0 0 0 # RGB')), /decimal/);
  assert.throws(() => parseCube33(identityCube().replace('LUT_3D_SIZE 33\n', '')), /LUT_3D_SIZE/);
  assert.throws(() => parseCube33(identityCube().replace('LUT_3D_SIZE 33', 'LUT_3D_SIZE 33\nLUT_3D_SIZE 33')), /malformed/);
  assert.throws(() => parseCube33(identityCube().split('\n').slice(0, -1).join('\n')), /expected 35937 samples/);
  assert.throws(() => parseCube33(`${identityCube()}\n0 0 0`), /too many/);
  assert.throws(() => parseCube33(identityCube().replace('0 0 0 # RGB', 'Infinity 0 0 # RGB')), /decimal/);
  assert.throws(() => parseCube33(identityCube().replace('0 0 0 # RGB', '1.1 0 0 # RGB')), /within \[0, 1\]/);
});

test('every manifest source resolves in the approved LUT source directory', () => {
  assert.equal(LUT_DEFINITIONS.length, 26);
  for (const definition of LUT_DEFINITIONS) {
    assert.equal(existsSync(resolve(approvedSourceDirectory, definition.source)), true, definition.source);
  }
});

test('CLI accepts only --source followed by an existing absolute directory', () => {
  const argv = ['node', 'build-luts.ts', '--source', approvedSourceDirectory];
  assert.equal(parseSourceArgument(argv), approvedSourceDirectory);
  assert.throws(() => parseSourceArgument(['node', 'build-luts.ts']), /usage/);
  assert.throws(() => parseSourceArgument(['node', 'build-luts.ts', '--source', 'relative']), /usage/);
  assert.throws(() => parseSourceArgument([...argv, 'extra']), /usage/);
  assert.throws(() => parseSourceArgument(['node', 'build-luts.ts', '--other', approvedSourceDirectory]), /usage/);
});

test('accepts known LOG companions but rejects an unregistered cube source', () => {
  const outputDirectory = resolve(temporaryDirectory('yujee-lut-output-parent-'), 'luts');
  assert.doesNotThrow(() => buildLuts(approvedSourceCopy({ includeLogs: true }), outputDirectory));
  assert.throws(
    () => buildLuts(approvedSourceCopy({ includeLogs: true, unexpectedCube: true }), resolve(temporaryDirectory('yujee-lut-output-parent-'), 'luts')),
    /unexpected source cube/,
  );
});

test('rejects stale root and full output artifacts before modifying the output tree', () => {
  const sourceDirectory = approvedSourceCopy();
  const rootStaleOutput = resolve(temporaryDirectory('yujee-lut-output-parent-'), 'luts');
  buildLuts(sourceDirectory, rootStaleOutput);
  writeFileSync(resolve(rootStaleOutput, 'unexpected.bin'), 'stale root artifact');
  assert.throws(() => buildLuts(sourceDirectory, rootStaleOutput), /unexpected output artifact/);

  const fullStaleOutput = resolve(temporaryDirectory('yujee-lut-output-parent-'), 'luts');
  buildLuts(sourceDirectory, fullStaleOutput);
  writeFileSync(resolve(fullStaleOutput, 'full', 'unexpected.bin.gz'), 'stale full artifact');
  assert.throws(() => buildLuts(sourceDirectory, fullStaleOutput), /unexpected output artifact/);
});

test('a failed compile leaves prior output bytes unchanged', () => {
  const sourceDirectory = approvedSourceCopy();
  const outputDirectory = resolve(temporaryDirectory('yujee-lut-output-parent-'), 'luts');
  buildLuts(sourceDirectory, outputDirectory);
  const before = outputHashManifest(outputDirectory);
  writeFileSync(resolve(sourceDirectory, LUT_DEFINITIONS[0].source), 'LUT_3D_SIZE 33\n0 0 0');

  assert.throws(() => buildLuts(sourceDirectory, outputDirectory), /expected 35937 samples/);
  assert.equal(outputHashManifest(outputDirectory), before);
});

test('builds deterministic, ordered payloads and hash-verified provenance', () => {
  const outputDirectory = resolve(temporaryDirectory('yujee-lut-output-parent-'), 'luts');
  const provenance = buildLuts(approvedSourceDirectory, outputDirectory);

  assert.equal(provenance.version, 'pf-v1');
  assert.equal(provenance.entries.length, LUT_DEFINITIONS.length);
  assert.deepEqual(provenance.entries.map((entry) => entry.lutId), LUT_DEFINITIONS.map((entry) => entry.id));
  assert.equal(gunzipSync(fileBytes(resolve(outputDirectory, 'thumbs.bin.gz'))).byteLength, LUT_DEFINITIONS.length * 17 ** 3 * 3);

  const thumbs = gunzipSync(fileBytes(resolve(outputDirectory, 'thumbs.bin.gz')));
  for (const [index, definition] of LUT_DEFINITIONS.entries()) {
    const source = fileBytes(resolve(approvedSourceDirectory, definition.source));
    const expectedFull = parseCube33(new TextDecoder().decode(source));
    const emittedFull = fileBytes(resolve(outputDirectory, 'full', `${definition.id}.bin.gz`));
    assert.equal(gunzipSync(emittedFull).byteLength, CUBE_BYTES);
    assert.deepEqual(Uint8Array.from(gunzipSync(emittedFull)), expectedFull);
    assert.deepEqual(Uint8Array.from(thumbs.subarray(index * 17 ** 3 * 3, (index + 1) * 17 ** 3 * 3)), downsample33To17(expectedFull));
    assert.equal(provenance.entries[index].sourceSha256, createHash('sha256').update(source).digest('hex'));
    assert.equal(provenance.entries[index].fullSha256, createHash('sha256').update(emittedFull).digest('hex'));
  }

  const before = outputHashManifest(outputDirectory);
  buildLuts(approvedSourceDirectory, outputDirectory);
  assert.equal(outputHashManifest(outputDirectory), before);
});
