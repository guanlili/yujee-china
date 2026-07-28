'use client';

import { useEffect, useRef, useState } from 'react';
import {
  LUT_DEFINITIONS,
  quantizeStrength,
  type LutId,
  type PhotoFilterRef,
  type PhotoFilterState,
} from '@/lib/photo/filter-state';
import { photoStore } from '@/lib/photo/store';
import { lutEngine } from '@/lib/photo/lut/engine';
import {
  clearPhotoOverride,
  createOwnedUrlController,
  currentScopeFilter,
  setBookFilter,
  setPhotoOverride,
} from './filter-controller';

type FilterScope = 'book' | 'photo';

export function FilterBar({
  locale,
  state,
  scope,
  photoId,
  persistError,
  onChange,
  onRetry,
  onClose,
}: {
  locale: string;
  state: PhotoFilterState | null;
  scope: FilterScope;
  photoId: string | null;
  persistError: string | null;
  onChange: (state: PhotoFilterState) => void;
  onRetry: () => void;
  onClose: () => void;
}) {
  const zh = locale === 'zh';
  const current = currentScopeFilter(state, scope, photoId);
  const strength = current?.strength ?? 100;
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [previewState, setPreviewState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const generationRef = useRef(0);
  const urlOwnerRef = useRef<ReturnType<typeof createOwnedUrlController> | null>(null);
  if (!urlOwnerRef.current) {
    urlOwnerRef.current = createOwnedUrlController((url) => URL.revokeObjectURL(url));
  }

  useEffect(() => {
    const owner = urlOwnerRef.current!;
    const mine = owner.start();
    generationRef.current = mine;
    setPreviews({});
    setPreviewState('loading');

    void (async () => {
      if (!photoId) {
        if (mine === generationRef.current) setPreviewState('missing');
        return;
      }
      try {
        // Preview inputs are always the unfiltered cached thumb. This prevents
        // stacking the next LUT on top of the currently selected one.
        const base = await photoStore.getTierBlob(photoId, 'thumb', null);
        if (!base) {
          if (mine === generationRef.current) setPreviewState('missing');
          return;
        }
        const next: Record<string, string> = {};
        const originalUrl = URL.createObjectURL(base);
        if (!owner.own(mine, originalUrl)) return;
        next.original = originalUrl;
        for (const definition of LUT_DEFINITIONS) {
          const blob = await lutEngine.applyPreview(base, {
            lutId: definition.id,
            strength: quantizeStrength(strength),
          });
          const url = URL.createObjectURL(blob);
          if (!owner.own(mine, url)) return;
          next[definition.id] = url;
          if (!owner.isCurrent(mine)) return;
        }
        if (!owner.isCurrent(mine)) return;
        setPreviews(next);
        setPreviewState('ready');
      } catch {
        if (owner.isCurrent(mine)) setPreviewState('error');
      }
    })();

    return () => {
      owner.invalidate(mine);
      generationRef.current += 1;
    };
  }, [photoId, strength]);

  const apply = (ref: PhotoFilterRef | null) => {
    if (scope === 'photo' && photoId) onChange(setPhotoOverride(state, photoId, ref));
    else onChange(setBookFilter(state, ref));
  };
  const select = (lutId: LutId) => apply({ lutId, strength: quantizeStrength(strength) });

  return (
    <aside className="filter-bar" role="dialog" aria-label={zh ? '照片风格' : 'Photo style'}>
      <div className="filter-bar-head">
        <div>
          <strong>{zh ? '风格' : 'Style'}</strong>
          <span>{scope === 'book' ? (zh ? '全书' : 'Whole book') : (zh ? '当前照片' : 'Current photo')}</span>
        </div>
        <button type="button" onClick={onClose} aria-label={zh ? '关闭风格面板' : 'Close style panel'}>×</button>
      </div>

      {scope === 'photo' && (
        <button
          type="button"
          className="filter-follow-book"
          onClick={() => photoId && onChange(clearPhotoOverride(state, photoId))}
        >
          {zh ? '跟随全书风格' : 'Follow book style'}
        </button>
      )}

      <label className="filter-strength">
        <span>{zh ? '强度' : 'Strength'} {Math.round(strength)}%</span>
        <input
          type="range"
          min="0"
          max="100"
          step="5"
          value={strength}
          disabled={!current}
          aria-label={zh ? '滤镜强度' : 'Filter strength'}
          onChange={(event) => current && apply({
            ...current,
            strength: Number(event.currentTarget.value),
          })}
        />
      </label>

      {previewState === 'loading' && <p className="filter-state" role="status">{zh ? '正在生成预览…' : 'Generating previews…'}</p>}
      {previewState === 'missing' && <p className="filter-state filter-error" role="status">{zh ? '这张照片的原图不在本机' : 'This photo is unavailable on this device'}</p>}
      {previewState === 'error' && <p className="filter-state filter-error" role="alert">{zh ? '预览生成失败，请重试' : 'Preview generation failed. Try again.'}</p>}

      <div className="filter-grid" aria-busy={previewState === 'loading'}>
        <button
          type="button"
          className="filter-card"
          aria-pressed={current === null}
          onClick={() => apply(null)}
          disabled={previewState !== 'ready'}
        >
          {previews.original && <img src={previews.original} alt="" />}
          <span>{zh ? '原片' : 'Original'}</span>
        </button>
        {LUT_DEFINITIONS.map((definition) => (
          <button
            type="button"
            className="filter-card"
            key={definition.id}
            aria-pressed={current?.lutId === definition.id}
            onClick={() => select(definition.id)}
            disabled={previewState !== 'ready'}
          >
            {previews[definition.id] && <img src={previews[definition.id]} alt="" />}
            <span>{zh ? definition.nameZh : definition.id}</span>
          </button>
        ))}
      </div>

      {persistError && (
        <p className="filter-state filter-error" role="alert">
          {zh ? '风格保存失败。' : 'Style failed to save.'}
          <button type="button" onClick={onRetry}>{zh ? '重试' : 'Retry'}</button>
        </p>
      )}
    </aside>
  );
}
