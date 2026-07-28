import { LUT_DEFINITIONS, LutIdSchema, type LutId } from '../filter-state';

export const THUMB_LUT_SIZE = 17;
export const FULL_LUT_SIZE = 33;

const RGB_CHANNELS = 3;
const THUMB_LUT_BYTES = THUMB_LUT_SIZE ** 3 * RGB_CHANNELS;
const FULL_LUT_BYTES = FULL_LUT_SIZE ** 3 * RGB_CHANNELS;
const ALL_THUMBS_BYTES = LUT_DEFINITIONS.length * THUMB_LUT_BYTES;
const THUMBS_URL = '/luts/thumbs.bin.gz';
const manifestIndex = new Map<LutId, number>(
  LUT_DEFINITIONS.map((definition, index) => [definition.id, index]),
);

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface LutResourceLoader {
  loadThumbLut(id: LutId): Promise<Uint8Array>;
  loadFullLut(id: LutId): Promise<Uint8Array>;
}

function createLutResourceLoader(fetchImpl: FetchLike): LutResourceLoader {
  const lutPromises = new Map<string, Promise<Uint8Array>>();
  let combinedThumbsPromise: Promise<Uint8Array> | undefined;

  function cacheRetryable(key: string, load: () => Promise<Uint8Array>): Promise<Uint8Array> {
    const cached = lutPromises.get(key);
    if (cached) return cached;

    const promise = load();
    lutPromises.set(key, promise);
    void promise.catch(() => {
      if (lutPromises.get(key) === promise) lutPromises.delete(key);
    });
    return promise;
  }

  function loadCombinedThumbs(): Promise<Uint8Array> {
    if (combinedThumbsPromise) return combinedThumbsPromise;
    const promise = fetchAndDecompress(fetchImpl, THUMBS_URL, ALL_THUMBS_BYTES);
    combinedThumbsPromise = promise;
    void promise.catch(() => {
      if (combinedThumbsPromise === promise) combinedThumbsPromise = undefined;
    });
    return promise;
  }

  return {
    loadThumbLut(id) {
      let trustedId: LutId;
      try {
        trustedId = parseTrustedId(id);
      } catch (error) {
        return Promise.reject(error);
      }
      const index = manifestIndex.get(trustedId);
      if (index === undefined) {
        return Promise.reject(new Error(`Unrecognized trusted LUT id: ${String(id)}`));
      }

      return cacheRetryable(`thumb:${trustedId}`, async () => {
        const all = await loadCombinedThumbs();
        const start = index * THUMB_LUT_BYTES;
        return all.subarray(start, start + THUMB_LUT_BYTES);
      });
    },

    loadFullLut(id) {
      let trustedId: LutId;
      try {
        trustedId = parseTrustedId(id);
      } catch (error) {
        return Promise.reject(error);
      }
      return cacheRetryable(`full:${trustedId}`, () =>
        fetchAndDecompress(
          fetchImpl,
          `/luts/full/${trustedId}.bin.gz`,
          FULL_LUT_BYTES,
        ));
    },
  };
}

function parseTrustedId(id: LutId): LutId {
  const result = LutIdSchema.safeParse(id);
  if (!result.success) throw new Error(`Unrecognized trusted LUT id: ${String(id)}`);
  return result.data;
}

async function fetchAndDecompress(
  fetchImpl: FetchLike,
  url: string,
  expectedLength: number,
): Promise<Uint8Array> {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`LUT resource ${url} failed with HTTP ${response.status}`);
  }
  if (typeof globalThis.DecompressionStream !== 'function') {
    throw new Error('LUT resources require browser DecompressionStream(gzip) support');
  }
  if (!response.body) throw new Error(`LUT resource ${url} returned no response body`);

  const stream = response.body.pipeThrough(new DecompressionStream('gzip'));
  const decoded = new Uint8Array(await new Response(stream).arrayBuffer());
  if (decoded.byteLength !== expectedLength) {
    throw new Error(
      `LUT resource ${url} decoded length ${decoded.byteLength}; expected ${expectedLength}`,
    );
  }
  return decoded;
}

const defaultLoader = createLutResourceLoader((input, init) => fetch(input, init));

export const loadThumbLut = defaultLoader.loadThumbLut;
export const loadFullLut = defaultLoader.loadFullLut;

/** Narrow fetch seam for Node tests; production callers use the two functions above. */
export function createLutResourceLoaderForTesting(fetchImpl: FetchLike): LutResourceLoader {
  return createLutResourceLoader(fetchImpl);
}
