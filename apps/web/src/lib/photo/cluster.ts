'use client';

// Browser-side deterministic spatio-temporal clustering (#232, WP-B).
//
// The browser is the ONLY place that ever holds the original photo + its EXIF
// GPS. Here we use the EXIF capture time + GPS coordinates to group photos into
// clusters and hand the Agent ONE opaque label per photo (`clusterId`: c1/c2/…).
//
// PRIVACY RED LINE (architecture §3, #232 carve-out): coordinates live ONLY in
// this module's in-memory computation. The ONLY thing that escapes — the only
// value any caller may read off the result — is the `clusterId` string. No lat /
// lng / place ever enters a request body, a log, IndexedDB, or any persistence.
// `ClusterGeo` is a transient, submit-time-only value; never store it on the
// photo object that flows to `/v3/analyze`.
//
// Two-layer design (the algorithm is the SEMANTIC layer only — it groups by real
// time/place structure and NEVER cuts on photo count; a dense 30-photo day stays
// one cluster, it is never split at the Nth photo):
//   ① sort by takenAt (ascending; missing takenAt sinks to the end)
//   ② time cut:  adjacent gap > 6h OR a calendar-day boundary → new cluster
//   ③ geo cut:   within a time cluster, if a boundary's two sides both have GPS
//                and are > 1° (~111km) apart → split there (tolerates a road trip)
//   ④ no GPS → time-only; neither takenAt nor GPS → fall-through cluster (never throws)
//      (a pair that BOTH carry GPS can still geo-split even if one/both lack a time —
//       the geo check runs whenever both sides have coordinates)
//   ⑤ number clusters c1/c2/… in time order

// ── Tunable thresholds (named constants, see algorithm above) ───────────────

/**
 * Time gap that opens a new cluster. Adjacent photos more than this many hours
 * apart are treated as a different occasion. 6h spans a normal day's activities
 * without splitting a long single outing.
 */
export const CLUSTER_TIME_GAP_HOURS = 6;

/**
 * Geo gap (in degrees of great-circle distance, ~111km per degree) that splits a
 * time cluster into two places. 1° ≈ 111km tolerates same-day driving/commuting
 * (you stay one cluster around a city) but separates genuinely distant locations
 * (e.g. two cities visited the same day).
 */
export const CLUSTER_GEO_GAP_DEGREES = 1;

/** Degrees → kilometres, for the human-readable comment above. ~111.195 km / °. */
const KM_PER_DEGREE = 111.195;

/** Geo gap expressed in kilometres (derived from the degree threshold). */
export const CLUSTER_GEO_GAP_KM = CLUSTER_GEO_GAP_DEGREES * KM_PER_DEGREE;

const EARTH_RADIUS_KM = 6371.0088;

// ── Types ───────────────────────────────────────────────────────────────────

/**
 * Transient GPS for one photo. EXISTS ONLY during in-browser clustering. NEVER
 * attach this to a `GenerationPhoto` / request body / log / IndexedDB record.
 */
export type ClusterGeo = { lat: number; lng: number };

/**
 * One photo's clustering inputs. `takenAt` is the EXIF ISO local datetime (or
 * null); `geo` is the transient GPS (or null when the photo carries no GPS).
 */
export type ClusterInput = {
  photoId: string;
  takenAt: string | null | undefined;
  geo: ClusterGeo | null | undefined;
};

// ── Haversine ────────────────────────────────────────────────────────────────

/**
 * Great-circle distance between two lat/lng points, in kilometres. Pure; used
 * only inside clustering — distances never leave this module.
 */
export function haversineKm(a: ClusterGeo, b: ClusterGeo): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ── Clustering ────────────────────────────────────────────────────────────────

function parseTime(takenAt: string | null | undefined): number | null {
  if (!takenAt) return null;
  const t = Date.parse(takenAt);
  return Number.isNaN(t) ? null : t;
}

/** Local calendar day key "YYYY-MM-DD" from an EXIF ISO-local datetime string. */
function dayKey(takenAt: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(takenAt);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/**
 * Assign each photo a deterministic `clusterId` (c1/c2/…) from its EXIF time +
 * GPS. Returns a Map keyed by photoId. The ONLY output is the label string —
 * coordinates never leave this call.
 *
 * Back-compat: when every photo lacks takenAt AND GPS, all land in a single
 * fall-through cluster (c1); the Agent then degrades to "one big batch / model
 * free grouping" exactly as before clusterId existed. Never throws.
 */
export function assignClusterIds(inputs: readonly ClusterInput[]): Map<string, string> {
  const result = new Map<string, string>();
  if (inputs.length === 0) return result;

  // ① Stable sort by takenAt ascending; photos without a parseable time sink to
  //    the end (preserving their original order) so they form a trailing cluster
  //    rather than corrupting timed neighbours.
  const indexed = inputs.map((photo, originalIndex) => ({
    photo,
    originalIndex,
    time: parseTime(photo.takenAt),
  }));
  indexed.sort((a, b) => {
    if (a.time === null && b.time === null) return a.originalIndex - b.originalIndex;
    if (a.time === null) return 1;
    if (b.time === null) return -1;
    if (a.time !== b.time) return a.time - b.time;
    return a.originalIndex - b.originalIndex;
  });

  // Walk the sorted list; decide at each boundary whether to open a new cluster.
  let clusterNumber = 1;
  let prev: (typeof indexed)[number] | null = null;

  for (const cur of indexed) {
    if (prev !== null) {
      if (boundaryOpensNewCluster(prev, cur)) clusterNumber += 1;
    }
    result.set(cur.photo.photoId, `c${clusterNumber}`);
    prev = cur;
  }

  return result;
}

function boundaryOpensNewCluster(
  prev: { photo: ClusterInput; time: number | null },
  cur: { photo: ClusterInput; time: number | null },
): boolean {
  // ② Time cut. If either side lacks a time we cannot judge time distance, so we
  //    do NOT open a new cluster here on time grounds (untimed tail stays glued
  //    to its neighbour's cluster) — geo may still cut below.
  if (prev.time !== null && cur.time !== null) {
    const gapHours = (cur.time - prev.time) / 3_600_000;
    if (gapHours > CLUSTER_TIME_GAP_HOURS) return true;

    // Calendar-day boundary (uses the EXIF local-day string, not UTC, so it
    // matches how a person experienced the day).
    const prevDay = prev.photo.takenAt ? dayKey(prev.photo.takenAt) : null;
    const curDay = cur.photo.takenAt ? dayKey(cur.photo.takenAt) : null;
    if (prevDay && curDay && prevDay !== curDay) return true;
  }

  // ③ Geo cut. Only when BOTH sides have GPS and they are far apart. This is what
  //    splits "same day, two cities" without ever cutting on photo count.
  const a = prev.photo.geo;
  const b = cur.photo.geo;
  if (a && b && haversineKm(a, b) > CLUSTER_GEO_GAP_KM) return true;

  return false;
}
