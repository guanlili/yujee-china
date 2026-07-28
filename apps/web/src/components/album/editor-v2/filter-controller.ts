import {
  effectiveRenderVersion,
  resolveEffectiveFilter,
  type PhotoFilterRef,
  type PhotoFilterState,
} from '@/lib/photo/filter-state';
import type { SnapshotEntry } from '@/lib/album/photo-snapshot-client';

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
  return {
    default: filter,
    ...(state?.overrides && Object.keys(state.overrides).length > 0
      ? { overrides: { ...state.overrides } }
      : {}),
  };
}

export function setPhotoOverride(
  state: PhotoFilterState | null | undefined,
  photoId: string,
  filter: PhotoFilterRef | null,
): PhotoFilterState {
  return {
    default: state?.default ?? null,
    overrides: { ...(state?.overrides ?? {}), [photoId]: filter },
  };
}

export function clearPhotoOverride(
  state: PhotoFilterState | null | undefined,
  photoId: string,
): PhotoFilterState {
  const current: PhotoFilterState = state ?? { default: null };
  const overrides = { ...(current.overrides ?? {}) };
  delete overrides[photoId];
  return withoutEmptyOverrides(current, overrides);
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

export function createOwnedUrlController(revoke: (url: string) => void) {
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
