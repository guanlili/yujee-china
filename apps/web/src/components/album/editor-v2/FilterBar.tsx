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
  runFilterPreviewGeneration,
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
  onScopeChange,
  onRetry,
  onClose,
  embedded = false,
}: {
  locale: string;
  state: PhotoFilterState | null;
  scope: FilterScope;
  photoId: string | null;
  persistError: string | null;
  onChange: (state: PhotoFilterState) => void;
  onScopeChange?: (scope: FilterScope) => void;
  onRetry: () => void;
  onClose: () => void;
  embedded?: boolean;
}) {
  const zh = locale === 'zh';
  const current = currentScopeFilter(state, scope, photoId);
  const strength = current?.strength ?? 100;
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [previewState, setPreviewState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [previewRetry, setPreviewRetry] = useState(0);
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
      // Preview inputs are always the unfiltered cached thumb. This prevents
      // stacking the next LUT on top of the currently selected one.
      const result = await runFilterPreviewGeneration({
        photoId,
        strength,
        generation: mine,
        owner,
        getBase: (id) => photoStore.getTierBlob(id, 'thumb', null),
        applyPreview: (base, filter) => lutEngine.applyPreview(base, filter),
        createUrl: (blob) => URL.createObjectURL(blob),
      });
      if (mine !== generationRef.current || result.status === 'stale') return;
      if (result.status === 'ready') {
        setPreviews(result.urls);
        setPreviewState('ready');
      } else {
        setPreviewState(result.status);
      }
    })();

    return () => {
      owner.invalidate(mine);
      generationRef.current += 1;
    };
  }, [photoId, previewRetry, strength]);

  const apply = (ref: PhotoFilterRef | null) => {
    if (scope === 'photo' && photoId) onChange(setPhotoOverride(state, photoId, ref));
    else onChange(setBookFilter(state, ref));
  };
  const select = (lutId: LutId) => apply({ lutId, strength: quantizeStrength(strength) });

  return (
    <aside
      className="filter-bar"
      role={embedded ? undefined : 'dialog'}
      aria-label={zh ? '照片风格' : 'Photo style'}
    >
      <div className="filter-bar-head">
        <div>
          <strong>{zh ? '风格' : 'Style'}</strong>
          <span>{scope === 'book' ? (zh ? '全书' : 'Whole book') : (zh ? '当前照片' : 'Current photo')}</span>
        </div>
        <button type="button" onClick={onClose} aria-label={zh ? '关闭风格面板' : 'Close style panel'}>×</button>
      </div>

      {onScopeChange && (
        <div className="filter-scope-switch" role="group" aria-label={zh ? '风格应用范围' : 'Style scope'}>
          <button
            type="button"
            className="filter-scope-option"
            aria-pressed={scope === 'photo'}
            onClick={() => onScopeChange('photo')}
          >
            {zh ? '当前照片' : 'Current photo'}
          </button>
          <button
            type="button"
            className="filter-scope-option"
            aria-pressed={scope === 'book'}
            onClick={() => onScopeChange('book')}
          >
            {zh ? '全书' : 'Whole book'}
          </button>
        </div>
      )}

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
      {previewState === 'error' && (
        <p className="filter-state filter-error" role="alert">
          {zh ? '预览生成失败。' : 'Preview generation failed.'}
          <button type="button" onClick={() => setPreviewRetry((value) => value + 1)}>
            {zh ? '重试' : 'Retry'}
          </button>
        </p>
      )}

      <div className="filter-grid" aria-busy={previewState === 'loading'}>
        <button
          type="button"
          className="filter-card"
          aria-pressed={current === null}
          onClick={() => apply(null)}
        >
          <div className="filter-card-preview">
            {previews.original && <img src={previews.original} alt="" />}
          </div>
          <span>{zh ? '原片' : 'Original'}</span>
        </button>
        {LUT_DEFINITIONS.map((definition) => (
          <button
            type="button"
            className="filter-card"
            key={definition.id}
            aria-pressed={current?.lutId === definition.id}
            onClick={() => select(definition.id)}
          >
            <div className="filter-card-preview">
              {previews[definition.id] && <img src={previews[definition.id]} alt="" />}
            </div>
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
