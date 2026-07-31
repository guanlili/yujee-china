import {
  LUT_DEFINITIONS,
  effectiveRenderVersion,
  normalizePhotoFilterState,
  quantizeStrength,
  resolveEffectiveFilter,
  type PhotoFilterRef,
  type PhotoFilterState,
} from '@/lib/photo/filter-state';
import type {
  SignedSnapshotUpload,
  SnapshotEntry,
} from '@/lib/album/photo-snapshot-client';
import type { TierBlobResult } from '@/lib/photo/store';

function withoutEmptyOverrides(
  state: PhotoFilterState,
  overrides: Record<string, PhotoFilterRef | null>,
): PhotoFilterState {
  return Object.keys(overrides).length > 0
    ? { default: state.default, overrides }
    : { default: state.default };
}

export function setBookFilter(
  state: PhotoFilterState | null | undefined,
  filter: PhotoFilterRef | null,
): PhotoFilterState {
  return normalizePhotoFilterState({
    default: filter,
    ...(state?.overrides && Object.keys(state.overrides).length > 0
      ? { overrides: { ...state.overrides } }
      : {}),
  })!;
}

export function setPhotoOverride(
  state: PhotoFilterState | null | undefined,
  photoId: string,
  filter: PhotoFilterRef | null,
): PhotoFilterState {
  return normalizePhotoFilterState({
    default: state?.default ?? null,
    overrides: { ...(state?.overrides ?? {}), [photoId]: filter },
  })!;
}

export function clearPhotoOverride(
  state: PhotoFilterState | null | undefined,
  photoId: string,
): PhotoFilterState {
  const current: PhotoFilterState = state ?? { default: null };
  const overrides = { ...(current.overrides ?? {}) };
  delete overrides[photoId];
  return normalizePhotoFilterState(withoutEmptyOverrides(current, overrides))!;
}

export function currentScopeFilter(
  state: PhotoFilterState | null | undefined,
  scope: 'book' | 'photo',
  photoId?: string | null,
): PhotoFilterRef | null {
  return scope === 'photo' && photoId
    ? resolveEffectiveFilter(state, photoId)
    : state?.default ?? null;
}

export function collectSnapshotEntries(
  photoIds: string[],
  state: PhotoFilterState | null | undefined,
): SnapshotEntry[] {
  return [...new Set(photoIds)].map((photoId) => ({
    photoId,
    renderVersion: effectiveRenderVersion(state, photoId),
  }));
}

export function filterSnapshotMismatches(
  entries: SnapshotEntry[],
  currentVersions: Record<string, string> | null | undefined,
): SnapshotEntry[] {
  return entries.filter(
    (entry) => currentVersions?.[entry.photoId] !== entry.renderVersion,
  );
}

/**
 * 点在这儿算不算「点到别处」—— 是就该收起风格面板。
 *
 * 两类必须放过,否则面板会自己跟自己打架:
 *   · 面板内部(.filter-bar):选滤镜、拖强度、点翻页箭头都在里面,收了就没法用
 *   · 打开它的那枚按钮(.img-edit-style):不放过的话,一次点击先被这里收起、
 *     再被按钮打开(或反过来),表现是「点风格没反应」
 * 其余一律收起 —— 包括点另一张照片:用户的注意力已经移走了,面板赖着不走就是遮挡。
 */
export function shouldDismissFilterPanel(target: EventTarget | null): boolean {
  const el = target as Element | null;
  if (typeof el?.closest !== 'function') return true;
  if (el.closest('.filter-bar')) return false;
  if (el.closest('.img-edit-style')) return false;
  return true;
}

export function createLatestCommit<T>(commit: (value: T) => void) {
  let generation = 0;
  let disposed = false;
  return {
    async run(load: () => Promise<T>): Promise<void> {
      if (disposed) return;
      const mine = ++generation;
      const value = await load();
      if (!disposed && mine === generation) commit(value);
    },
    invalidate(): void {
      generation += 1;
    },
    dispose(): void {
      disposed = true;
      generation += 1;
    },
  };
}

export interface OwnedUrlController {
  start(): number;
  isCurrent(mine: number): boolean;
  own(mine: number, url: string): boolean;
  invalidate(mine: number): void;
  dispose(): void;
}

export function createOwnedUrlController(revoke: (url: string) => void): OwnedUrlController {
  let generation = 0;
  let disposed = false;
  const active = new Set<string>();
  const revokeActive = () => {
    for (const url of active) revoke(url);
    active.clear();
  };
  return {
    start(): number {
      revokeActive();
      return ++generation;
    },
    isCurrent(mine: number): boolean {
      return !disposed && mine === generation;
    },
    own(mine: number, url: string): boolean {
      if (disposed || mine !== generation) {
        revoke(url);
        return false;
      }
      active.add(url);
      return true;
    },
    invalidate(mine: number): void {
      if (mine !== generation) return;
      generation += 1;
      revokeActive();
    },
    dispose(): void {
      disposed = true;
      generation += 1;
      revokeActive();
    },
  };
}

export type PreviewGenerationResult =
  | { status: 'ready'; urls: Record<string, string> }
  | { status: 'missing' | 'error' | 'stale' };

export async function runFilterPreviewGeneration({
  photoId,
  strength,
  generation,
  owner,
  getBase,
  applyPreview,
  createUrl,
}: {
  photoId: string;
  strength: number;
  generation: number;
  owner: OwnedUrlController;
  getBase: (photoId: string) => Promise<Blob | undefined>;
  applyPreview: (base: Blob, filter: PhotoFilterRef) => Promise<Blob>;
  createUrl: (blob: Blob) => string;
}): Promise<PreviewGenerationResult> {
  try {
    const base = await getBase(photoId);
    if (!owner.isCurrent(generation)) return { status: 'stale' };
    if (!base) return { status: 'missing' };

    const urls: Record<string, string> = {};
    const originalUrl = createUrl(base);
    if (!owner.own(generation, originalUrl)) return { status: 'stale' };
    urls.original = originalUrl;
    const normalizedStrength = quantizeStrength(strength);

    for (const definition of LUT_DEFINITIONS) {
      const blob = await applyPreview(base, {
        lutId: definition.id,
        strength: normalizedStrength,
      });
      if (!owner.isCurrent(generation)) return { status: 'stale' };
      if (normalizedStrength > 0 && blob === base) {
        owner.invalidate(generation);
        return { status: 'error' };
      }
      const url = createUrl(blob);
      if (!owner.own(generation, url)) return { status: 'stale' };
      urls[definition.id] = url;
    }

    return owner.isCurrent(generation)
      ? { status: 'ready', urls }
      : { status: 'stale' };
  } catch {
    if (owner.isCurrent(generation)) owner.invalidate(generation);
    return { status: 'error' };
  }
}

export const FILTER_SAVE_DELAY_MS = 180;

export function createFilterSaveController({
  save,
  onSuccess,
  onError,
  setTimer = (run, delay) => setTimeout(run, delay),
  clearTimer = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}: {
  save: (
    state: PhotoFilterState | null,
    signal: AbortSignal,
  ) => Promise<PhotoFilterState | null>;
  onSuccess: (state: PhotoFilterState | null) => void;
  onError: (error: Error) => void;
  setTimer?: (run: () => void, delay: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}) {
  let generation = 0;
  let timer: unknown;
  let abort: AbortController | undefined;
  let disposed = false;
  let latest: PhotoFilterState | null = null;
  let hasLatest = false;

  const schedule = (state: PhotoFilterState | null) => {
    if (disposed) return;
    latest = state;
    hasLatest = true;
    generation += 1;
    if (timer !== undefined) clearTimer(timer);
    timer = undefined;
    abort?.abort();
    abort = undefined;
    const mine = generation;
    timer = setTimer(() => {
      timer = undefined;
      if (disposed || mine !== generation) return;
      const currentAbort = new AbortController();
      abort = currentAbort;
      void save(state, currentAbort.signal).then(
        (normalized) => {
          if (!disposed && mine === generation && !currentAbort.signal.aborted) {
            onSuccess(normalized);
          }
        },
        (cause: unknown) => {
          if (
            !disposed
            && mine === generation
            && !currentAbort.signal.aborted
          ) {
            onError(cause instanceof Error ? cause : new Error(String(cause)));
          }
        },
      );
    }, FILTER_SAVE_DELAY_MS);
  };

  return {
    schedule,
    retry(): void {
      if (hasLatest) schedule(latest);
    },
    dispose(): void {
      disposed = true;
      generation += 1;
      if (timer !== undefined) clearTimer(timer);
      timer = undefined;
      abort?.abort();
      abort = undefined;
    },
  };
}

function freezeFilterState(
  state: PhotoFilterState | null | undefined,
): PhotoFilterState | null {
  const normalized = normalizePhotoFilterState(state);
  if (!normalized) return null;
  const defaultRef = normalized.default
    ? Object.freeze({ ...normalized.default })
    : null;
  const overrides = normalized.overrides
    ? Object.freeze(Object.fromEntries(
        Object.entries(normalized.overrides).map(([photoId, ref]) => [
          photoId,
          ref ? Object.freeze({ ...ref }) : null,
        ]),
      ))
    : undefined;
  return Object.freeze({
    default: defaultRef,
    ...(overrides ? { overrides } : {}),
  });
}

export interface FrozenBackupPlan {
  readonly photoFilter: PhotoFilterState | null;
  readonly entries: readonly SnapshotEntry[];
  readonly pending: readonly SnapshotEntry[];
}

/**
 * @param force 忽略「已备份过同一个版本」的判断,整本重传一遍。
 *
 *   为什么需要它:renderVersion **只编滤镜**(`pf-v1__{lutId}__{strength}`),不编上传
 *   档位 —— 档位一进版本号,存量备份当场全变「过期」,分享闸门
 *   (`recordedVersions[id] === effectiveRenderVersion(...)`)会直接 409,而且只有在
 *   还留着原图的那台设备上重传才修得好。代价是:上传档从 1600 提到 3400 之后,
 *   **存量备份不会自动升级**(版本号没变 → filterSnapshotMismatches 认为没事可做)。
 *   所以升档要靠用户主动触发这一条:同 key、同版本、更好的字节,零 409 风险。
 */
export function createFrozenBackupPlan(
  photoIds: string[],
  state: PhotoFilterState | null | undefined,
  currentVersions: Record<string, string> | null | undefined,
  force = false,
): FrozenBackupPlan {
  const photoFilter = freezeFilterState(state);
  const entries = Object.freeze(
    collectSnapshotEntries(photoIds, photoFilter)
      .map((entry) => Object.freeze({ ...entry })),
  );
  const pending = Object.freeze(
    force ? [...entries] : filterSnapshotMismatches([...entries], currentVersions),
  );
  return Object.freeze({ photoFilter, entries, pending });
}

export async function prepareSnapshotBlobs(
  plan: FrozenBackupPlan,
  load: (
    entry: SnapshotEntry,
    frozenState: PhotoFilterState | null,
  ) => Promise<TierBlobResult | undefined>,
): Promise<{
  ready: Array<{ entry: SnapshotEntry; blob: Blob }>;
  failures: SnapshotEntry[];
}> {
  const ready: Array<{ entry: SnapshotEntry; blob: Blob }> = [];
  const failures: SnapshotEntry[] = [];
  for (const entry of plan.pending) {
    const result = await load(entry, plan.photoFilter).catch(() => undefined);
    if (!result?.blob || result.filteredFallback) {
      failures.push(entry);
      continue;
    }
    ready.push({ entry, blob: result.blob });
  }
  return { ready, failures };
}

function snapshotEntryKey(entry: SnapshotEntry): string {
  return `${entry.photoId}\u0000${entry.renderVersion}`;
}

export interface CorrelatedSnapshotUpload {
  entry: SnapshotEntry;
  putUrl: string;
}

export function correlateSignedSnapshotUploads(
  expected: readonly SnapshotEntry[],
  signed: readonly SignedSnapshotUpload[],
): CorrelatedSnapshotUpload[] {
  const expectedByKey = new Map(
    expected.map((entry) => [snapshotEntryKey(entry), entry]),
  );
  if (expectedByKey.size !== expected.length) {
    throw new Error('duplicate expected snapshot entry');
  }
  const signedByKey = new Map<string, SignedSnapshotUpload>();
  for (const item of signed) {
    const key = snapshotEntryKey(item);
    if (!expectedByKey.has(key)) {
      throw new Error('unexpected or mismatched signed snapshot entry');
    }
    if (signedByKey.has(key)) {
      throw new Error('duplicate signed snapshot entry');
    }
    signedByKey.set(key, item);
  }
  if (signedByKey.size !== expectedByKey.size) {
    throw new Error('missing signed snapshot entry');
  }
  return expected.map((entry) => ({
    entry,
    putUrl: signedByKey.get(snapshotEntryKey(entry))!.putUrl,
  }));
}

export async function uploadCorrelatedSnapshots(
  items: Array<CorrelatedSnapshotUpload & { blob: Blob }>,
  put: (putUrl: string, blob: Blob) => Promise<void>,
): Promise<SnapshotEntry[]> {
  const uploaded: SnapshotEntry[] = [];
  const queue = [...items];
  const worker = async () => {
    for (;;) {
      const item = queue.shift();
      if (!item) return;
      try {
        await put(item.putUrl, item.blob);
        uploaded.push(item.entry);
      } catch {
        // Partial success is confirmed exactly; failed entries stay retryable.
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  return uploaded;
}
