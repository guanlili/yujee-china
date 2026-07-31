'use client';

import { useCallback, useRef, useState } from 'react';

import {
  confirmPhotoSnapshot,
  putSnapshotBlob,
  signPhotoSnapshotUpload,
  type SignedSnapshotUpload,
  type SnapshotEntry,
} from '@/lib/album/photo-snapshot-client';
import type { PhotoFilterState } from '@/lib/photo/filter-state';
import { photoStore, type TierBlobResult } from '@/lib/photo/store';
import {
  correlateSignedSnapshotUploads,
  createFrozenBackupPlan,
  filterSnapshotMismatches,
  prepareSnapshotBlobs,
  uploadCorrelatedSnapshots,
} from '../filter-controller';

export type BackupState = 'idle' | 'backing-up' | 'backed-up' | 'failed';

export type BackupResult = {
  /** 这一轮冻结计划之后仍没备份成功的照片数。 */
  missing: number;
  uploaded: number;
  /** 精确到 photoId + renderVersion 的本地版本表,供下一轮直接跳过。 */
  renderVersions: Record<string, string>;
};

export type PhotoBackupDependencies = {
  getTierBlobStatus: (
    photoId: string,
    state: PhotoFilterState | null,
  ) => Promise<TierBlobResult>;
  sign: (entries: SnapshotEntry[]) => Promise<SignedSnapshotUpload[]>;
  put: (putUrl: string, blob: Blob) => Promise<void>;
  confirm: (entries: SnapshotEntry[]) => Promise<unknown>;
};

const DEFAULT_DEPENDENCIES: PhotoBackupDependencies = {
  // 上传档(3400)而不是屏显档(1600),与桌面同口径 —— 换设备后导出拿它当源图。
  getTierBlobStatus: (photoId, state) =>
    photoStore.getTierBlobStatus(photoId, 'backup', state),
  sign: () => Promise.reject(new Error('albumId-bound signer is required')),
  put: putSnapshotBlob,
  confirm: () => Promise.reject(new Error('albumId-bound confirmer is required')),
};

/**
 * Execute one immutable backup batch. All render versions and bytes come from the
 * same normalized frozen filter snapshot; callers may safely change UI state while
 * this promise is pending.
 */
export async function runPhotoBackup({
  albumId,
  photoIds,
  photoFilter,
  currentVersions,
  onProgress,
  deps,
  force = false,
}: {
  albumId: string;
  photoIds: string[];
  photoFilter: PhotoFilterState | null;
  currentVersions: Record<string, string>;
  onProgress?: (progress: { done: number; total: number }) => void;
  deps?: Partial<PhotoBackupDependencies>;
  /** 整本重传一遍(忽略「已备份过同一版本」)。用来把存量 1600 的备份升到 3400 ——
   *  档位不进 renderVersion(进了会把存量分享全打成 409),所以升档只能靠这条。 */
  force?: boolean;
}): Promise<BackupResult> {
  const dependencies: PhotoBackupDependencies = {
    ...DEFAULT_DEPENDENCIES,
    sign: (entries) => signPhotoSnapshotUpload(albumId, entries),
    confirm: (entries) => confirmPhotoSnapshot(albumId, entries),
    ...deps,
  };
  // Capture once before the first await. createFrozenBackupPlan normalizes,
  // deduplicates, freezes, and selects render-version mismatches only.
  const plan = createFrozenBackupPlan(photoIds, photoFilter, currentVersions, force);
  const nextVersions = { ...currentVersions };
  if (plan.pending.length === 0) {
    return { missing: 0, uploaded: 0, renderVersions: nextVersions };
  }

  const prepared = await prepareSnapshotBlobs(
    plan,
    (entry, frozenState) =>
      dependencies.getTierBlobStatus(entry.photoId, frozenState),
  );
  if (prepared.ready.length === 0) {
    return {
      missing: plan.pending.length,
      uploaded: 0,
      renderVersions: nextVersions,
    };
  }

  const requestedEntries = prepared.ready.map(({ entry }) => entry);
  const signed = await dependencies.sign(requestedEntries);
  // This rejects missing, duplicate, unexpected, and renderVersion-mismatched
  // signatures before the first PUT.
  const correlated = correlateSignedSnapshotUploads(requestedEntries, signed);
  let done = 0;
  onProgress?.({ done, total: correlated.length });
  const uploaded = await uploadCorrelatedSnapshots(
    correlated.map((item, index) => ({
      ...item,
      blob: prepared.ready[index]!.blob,
    })),
    async (putUrl, blob) => {
      try {
        await dependencies.put(putUrl, blob);
      } finally {
        done += 1;
        onProgress?.({ done, total: correlated.length });
      }
    },
  );

  if (uploaded.length > 0) {
    // Confirm exactly the entries whose PUTs succeeded. Do not advance the local
    // map until the server has accepted the same correlated entries.
    await dependencies.confirm(uploaded);
    for (const entry of uploaded) {
      nextVersions[entry.photoId] = entry.renderVersion;
    }
  }

  return {
    missing: filterSnapshotMismatches([...plan.entries], nextVersions).length,
    uploaded: uploaded.length,
    renderVersions: nextVersions,
  };
}

export function usePhotoBackup(
  albumId: string,
  photoFilter: PhotoFilterState | null,
  initialVersions: Record<string, string>,
) {
  const [state, setState] = useState<BackupState>('idle');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [renderVersions, setRenderVersions] = useState<Record<string, string>>(
    () => ({ ...initialVersions }),
  );
  const versionRef = useRef(renderVersions);
  versionRef.current = renderVersions;
  const running = useRef(false);

  const backup = useCallback(
    async (bookPhotoIds: string[], force = false): Promise<BackupResult> => {
      if (running.current) {
        const pending = createFrozenBackupPlan(
          bookPhotoIds,
          photoFilter,
          versionRef.current,
        ).pending.length;
        return {
          missing: pending,
          uploaded: 0,
          renderVersions: { ...versionRef.current },
        };
      }
      running.current = true;
      setState('backing-up');
      setProgress({ done: 0, total: 0 });
      try {
        const result = await runPhotoBackup({
          albumId,
          photoIds: bookPhotoIds,
          photoFilter,
          currentVersions: versionRef.current,
          onProgress: setProgress,
          force,
        });
        versionRef.current = result.renderVersions;
        setRenderVersions(result.renderVersions);
        setState(result.missing === 0 ? 'backed-up' : 'failed');
        return result;
      } catch {
        const fallback = {
          missing: createFrozenBackupPlan(
            bookPhotoIds,
            photoFilter,
            versionRef.current,
          ).pending.length,
          uploaded: 0,
          renderVersions: { ...versionRef.current },
        };
        setState('failed');
        return fallback;
      } finally {
        running.current = false;
        setProgress(null);
      }
    },
    [albumId, photoFilter],
  );

  return { state, progress, renderVersions, backup };
}
