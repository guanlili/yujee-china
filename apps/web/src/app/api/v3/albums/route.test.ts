import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BodySchema } from './schema';

const BODY = {
  requestId: '4e87b9c4-1c25-49d4-8d73-9e1dd1d45721',
  language: 'en' as const,
  promptHint: 'spring trip',
  photos: [
    {
      photoId: 'p1',
      base64: 'data:image/jpeg;base64,AA==',
      width: 800,
      height: 600,
    },
  ],
};

test('/api/v3/albums accepts browser EXIF local takenAt datetimes', () => {
  const result = BodySchema.safeParse({
    ...BODY,
    photos: [{ ...BODY.photos[0], takenAt: '2024-03-15T08:30:00' }],
  });

  assert.equal(result.success, true);
});

test('/api/v3/albums rejects extra GPS fields in browser photo input', () => {
  const result = BodySchema.safeParse({
    ...BODY,
    photos: [{ ...BODY.photos[0], takenAt: '2024-03-15T08:30:00Z', lat: 35, lng: 139 }],
  });

  assert.equal(result.success, false);
});

test('/api/v3/albums accepts an opaque clusterId label (#232)', () => {
  const result = BodySchema.safeParse({
    ...BODY,
    photos: [{ ...BODY.photos[0], takenAt: '2024-03-15T08:30:00', clusterId: 'c2' }],
  });

  assert.equal(result.success, true);
});

test('/api/v3/albums still rejects coordinates even when clusterId is present', () => {
  const result = BodySchema.safeParse({
    ...BODY,
    photos: [{ ...BODY.photos[0], clusterId: 'c1', lat: 35, lng: 139 }],
  });

  assert.equal(result.success, false);
});

test('/api/v3/albums rejects non-data-url photo payloads before creating work', () => {
  const result = BodySchema.safeParse({
    ...BODY,
    photos: [{ ...BODY.photos[0], base64: 'AA==' }],
  });

  assert.equal(result.success, false);
});

test('/api/v3/albums rejects image payloads over 800KB before creating work', () => {
  const oversized = Buffer.from(new Uint8Array(800 * 1024 + 1)).toString('base64');
  const result = BodySchema.safeParse({
    ...BODY,
    photos: [{ ...BODY.photos[0], base64: `data:image/png;base64,${oversized}` }],
  });

  assert.equal(result.success, false);
});
