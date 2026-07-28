export type LutRgb = readonly [number, number, number];

/**
 * CPU reference for the WebGL sampler3D path. LUT bytes are ordered with
 * red changing fastest, then green, then blue.
 */
export function sampleLutTrilinear(
  lut: Uint8Array,
  size: number,
  input: LutRgb,
  strength: number,
): [number, number, number] {
  if (!Number.isInteger(size) || size < 2) {
    throw new RangeError('LUT size must be an integer of at least 2');
  }
  const expectedLength = size ** 3 * 3;
  if (lut.byteLength !== expectedLength) {
    throw new RangeError(`LUT decoded length ${lut.byteLength} does not match ${expectedLength}`);
  }

  const original = input.map(clampUnit) as [number, number, number];
  const amount = clampUnit(strength);
  if (amount === 0) return original;

  const position = original.map((value) => value * (size - 1));
  const lower = position.map(Math.floor);
  const upper = lower.map((value) => Math.min(value + 1, size - 1));
  const fraction = position.map((value, channel) => value - lower[channel]);
  const sampled: [number, number, number] = [0, 0, 0];

  for (let bz = 0; bz < 2; bz += 1) {
    const b = bz === 0 ? lower[2] : upper[2];
    const wb = bz === 0 ? 1 - fraction[2] : fraction[2];
    for (let gy = 0; gy < 2; gy += 1) {
      const g = gy === 0 ? lower[1] : upper[1];
      const wg = gy === 0 ? 1 - fraction[1] : fraction[1];
      for (let rx = 0; rx < 2; rx += 1) {
        const r = rx === 0 ? lower[0] : upper[0];
        const wr = rx === 0 ? 1 - fraction[0] : fraction[0];
        const weight = wr * wg * wb;
        const offset = ((b * size + g) * size + r) * 3;
        sampled[0] += (lut[offset] / 255) * weight;
        sampled[1] += (lut[offset + 1] / 255) * weight;
        sampled[2] += (lut[offset + 2] / 255) * weight;
      }
    }
  }

  return [
    mix(original[0], sampled[0], amount),
    mix(original[1], sampled[1], amount),
    mix(original[2], sampled[2], amount),
  ];
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function mix(from: number, to: number, amount: number): number {
  return from * (1 - amount) + to * amount;
}
