import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assignClusterIds,
  CLUSTER_GEO_GAP_DEGREES,
  CLUSTER_GEO_GAP_KM,
  CLUSTER_TIME_GAP_HOURS,
  haversineKm,
  type ClusterInput,
} from './cluster';

const photo = (
  photoId: string,
  takenAt: string | null,
  geo: { lat: number; lng: number } | null = null,
): ClusterInput => ({ photoId, takenAt, geo });

// Returns the cluster label for each photoId in INPUT order.
function labels(inputs: ClusterInput[]): string[] {
  const map = assignClusterIds(inputs);
  return inputs.map((p) => map.get(p.photoId)!);
}

// Counts distinct clusters.
function clusterCount(inputs: ClusterInput[]): number {
  return new Set(assignClusterIds(inputs).values()).size;
}

// ── thresholds are exported & sane ────────────────────────────────────────────

test('thresholds are tunable named constants', () => {
  assert.equal(CLUSTER_TIME_GAP_HOURS, 6);
  assert.equal(CLUSTER_GEO_GAP_DEGREES, 1);
  assert.ok(Math.abs(CLUSTER_GEO_GAP_KM - 111.195) < 1e-6);
});

// ── haversine correctness ─────────────────────────────────────────────────────

test('haversineKm: identical points = 0', () => {
  assert.equal(haversineKm({ lat: 40, lng: -74 }, { lat: 40, lng: -74 }), 0);
});

test('haversineKm: NYC → LA ≈ 3936 km', () => {
  const d = haversineKm({ lat: 40.7128, lng: -74.006 }, { lat: 34.0522, lng: -118.2437 });
  assert.ok(Math.abs(d - 3936) < 20, `expected ~3936km, got ${d}`);
});

test('haversineKm: 1° of latitude ≈ 111 km', () => {
  const d = haversineKm({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
  assert.ok(Math.abs(d - 111.195) < 0.5, `expected ~111km, got ${d}`);
});

// ── ① sparse (cross-day / big gap) → multiple clusters ───────────────────────

test('sparse: photos on three different days → three clusters', () => {
  const inputs = [
    photo('a', '2024-03-15T09:00:00'),
    photo('b', '2024-03-16T09:00:00'),
    photo('c', '2024-03-17T09:00:00'),
  ];
  assert.equal(clusterCount(inputs), 3);
  assert.deepEqual(labels(inputs), ['c1', 'c2', 'c3']);
});

test('sparse: same day but a >6h gap opens a new cluster', () => {
  const inputs = [
    photo('a', '2024-03-15T08:00:00'),
    photo('b', '2024-03-15T09:00:00'),
    // 7h gap → new cluster (morning vs evening)
    photo('c', '2024-03-15T16:30:00'),
  ];
  assert.deepEqual(labels(inputs), ['c1', 'c1', 'c2']);
});

// ── ② dense same place, one day, 30 photos → SINGLE cluster (never count-split) ─

test('dense: 30 photos same place within one afternoon → ONE cluster', () => {
  const start = Date.parse('2024-03-15T13:00:00');
  const inputs: ClusterInput[] = [];
  for (let i = 0; i < 30; i++) {
    // ~2 minutes apart, all near the same coordinate.
    const t = new Date(start + i * 2 * 60_000).toISOString().slice(0, 19);
    inputs.push(photo(`p${i}`, t, { lat: 40.5 + i * 0.0001, lng: -74 + i * 0.0001 }));
  }
  assert.equal(clusterCount(inputs), 1, 'dense same-day set must never be split on count');
  assert.ok(labels(inputs).every((l) => l === 'c1'));
});

// ── ③ driving: same day, two places >1° apart → split; <1° → not split ────────

test('driving: same day, two cities >1° apart → 2 clusters', () => {
  const inputs = [
    photo('a', '2024-03-15T09:00:00', { lat: 40.0, lng: -74.0 }),
    photo('b', '2024-03-15T10:00:00', { lat: 40.0, lng: -74.0 }),
    // ~2° east, same day, within the 6h time window → geo cut, not time cut
    photo('c', '2024-03-15T12:00:00', { lat: 40.0, lng: -72.0 }),
    photo('d', '2024-03-15T13:00:00', { lat: 40.0, lng: -72.0 }),
  ];
  assert.deepEqual(labels(inputs), ['c1', 'c1', 'c2', 'c2']);
});

test('driving: same day, places <1° apart → still 1 cluster', () => {
  const inputs = [
    photo('a', '2024-03-15T09:00:00', { lat: 40.0, lng: -74.0 }),
    photo('b', '2024-03-15T10:00:00', { lat: 40.3, lng: -74.2 }), // ~0.36° away
    photo('c', '2024-03-15T11:00:00', { lat: 40.5, lng: -74.0 }),
  ];
  assert.equal(clusterCount(inputs), 1);
});

// ── ④ no GPS → time-only; no takenAt + no GPS → fall-through cluster ──────────

test('no GPS: clustering falls back to pure time (cross-day still splits)', () => {
  const inputs = [
    photo('a', '2024-03-15T09:00:00'),
    photo('b', '2024-03-15T10:00:00'),
    photo('c', '2024-03-16T09:00:00'),
  ];
  assert.deepEqual(labels(inputs), ['c1', 'c1', 'c2']);
});

test('no takenAt + no GPS: every photo lands in a single fall-through cluster (no throw)', () => {
  const inputs = [photo('a', null), photo('b', null), photo('c', null)];
  assert.equal(clusterCount(inputs), 1);
  assert.ok(labels(inputs).every((l) => l === 'c1'));
});

test('empty input returns an empty map and never throws', () => {
  assert.equal(assignClusterIds([]).size, 0);
});

test('mixed: untimed photos sink to the end and glue to the trailing cluster', () => {
  const inputs = [
    photo('a', '2024-03-15T09:00:00'),
    photo('noTime', null),
    photo('b', '2024-03-16T09:00:00'),
  ];
  const map = assignClusterIds(inputs);
  // Sorted order: a (day 1), b (day 2), then untimed sinks last. a=c1; day boundary
  // a→b opens c2; b→untimed can't be judged on time and has no geo → untimed joins c2.
  assert.equal(map.get('a'), 'c1');
  assert.equal(map.get('b'), 'c2');
  assert.equal(map.get('noTime'), 'c2');
});

// ── ⑤ cluster ids are time-ordered c1/c2/… regardless of input order ─────────

test('clusterIds are numbered in time order even when input is shuffled', () => {
  const inputs = [
    photo('late', '2024-03-17T09:00:00'),
    photo('early', '2024-03-15T09:00:00'),
    photo('mid', '2024-03-16T09:00:00'),
  ];
  const map = assignClusterIds(inputs);
  assert.equal(map.get('early'), 'c1');
  assert.equal(map.get('mid'), 'c2');
  assert.equal(map.get('late'), 'c3');
});

// ── PRIVACY: output is labels only — never coordinates ───────────────────────

test('PRIVACY: output values are clusterId strings only, no coordinate ever returned', () => {
  const inputs = [
    photo('a', '2024-03-15T09:00:00', { lat: 40.5, lng: -74 }),
    photo('b', '2024-03-15T10:00:00', { lat: 40.5, lng: -74 }),
  ];
  const map = assignClusterIds(inputs);
  for (const value of map.values()) {
    assert.equal(typeof value, 'string');
    assert.match(value, /^c\d+$/); // c1/c2/… — never a number/lat/lng/object
  }
  // The serialized result carries no lat/lng/geo keys.
  const serialized = JSON.stringify([...map.entries()]);
  assert.equal(/lat|lng|geo|coord/i.test(serialized), false);
});
