import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { LUT_DEFINITIONS } from '../src/lib/photo/filter-state.ts';
import { buildLuts, downsample33To17, parseCube33 } from './build-luts.ts';

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

test('every manifest source resolves in the approved LUT source directory', () => {
  const sourceDirectory = '/Users/smalldog/Desktop/精选26色LUT';

  assert.equal(LUT_DEFINITIONS.length, 26);
  for (const definition of LUT_DEFINITIONS) {
    assert.equal(existsSync(resolve(sourceDirectory, definition.source)), true, definition.source);
  }
});

test('builds provenance for all manifest entries from the approved source directory', () => {
  const provenance = buildLuts('/Users/smalldog/Desktop/精选26色LUT');

  assert.equal(provenance.version, 'pf-v1');
  assert.equal(provenance.entries.length, LUT_DEFINITIONS.length);
  assert.deepEqual(provenance.entries.map((entry) => entry.lutId), LUT_DEFINITIONS.map((entry) => entry.id));
});
