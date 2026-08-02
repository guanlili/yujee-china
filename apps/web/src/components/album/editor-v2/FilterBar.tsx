'use client';

/* 风格(滤镜)面板。桌面与移动共用这一个组件 —— 桌面是钉在画布底部的短浮层,移动是
   bottom-sheet(见 mobile/modals/FilterSheet),骨架同一套:范围二选一 → 横滑卡片列表
   (两端都是三排,2026-08-02 起桌面对齐移动端;两端各挂一枚翻页箭头)→ 强度(按需)。

   ── 这次收敛掉了什么 ──
   改之前有三个控件在回答同一个问题「这个风格作用于谁」:标题右边的 scope 标签、scope
   二选一胶囊、还有一条「跟随全书风格」下划线链接。而且那条链接掩盖了一个真实的语义差:
     · overrides[photoId] 不存在   = 跟随全书
     · overrides[photoId] === null = 这张明确不要滤镜(原片)
   两个不同状态,一个做成下划线链接、一个做成卡片,看起来毫不相干。

   现在「跟随全书」是卡片网格里的第一张,与「原片」「27 个滤镜」并列 —— 它们本来就是
   同一维度的选择:这张图用什么。三个控件塌成一个。 */

import { useCallback, useEffect, useRef, useState } from 'react';
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

/**
 * 缩略图一律按满强度生成。
 *
 * 缩略图要回答的是「这个滤镜是什么调子」,不是「70% 强度下什么样」。早先跟着当前 strength
 * 生成,于是 strength 进了 effect 依赖 —— 滑块每动一格(step=5)就销毁 28 个 objectURL、
 * 把 27 个 LUT 重新过一遍 WebGL,整排卡片还会闪回骨架态。强度的实时反馈本来就在画布上
 * (reloadPhotoFilter),缩略图不必也不该跟着抖。
 */
const PREVIEW_STRENGTH = 100;

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
  /** 这张图正在跟随全书 = 没有自己的 override(与 override === null 是两回事)。 */
  const following =
    scope === 'photo' && photoId != null && state?.overrides?.[photoId] === undefined;
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [previewState, setPreviewState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [previewRetry, setPreviewRetry] = useState(0);
  /* 卡片三排横滑(两端同形态)。手指能滑,鼠标不好滑 —— 而且「右边还有没有卡」横滑条
     自己不会说。所以两端各挂一枚翻页箭头,点一下滚一屏。
     箭头按**那个方向还能不能滚**决定出不出,不灰着占位:一个永远点不动的控件比没有更
     让人困惑(与强度滑块按需挂载同一条口径)。
     初值给 right:true —— 27 个滤镜在任何视口都滚得动,首帧就该有右箭头;真实值等卡片
     就位后由 syncPager 量出来纠正。 */
  const gridRef = useRef<HTMLDivElement>(null);
  const [pager, setPager] = useState({ left: false, right: true });
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
        strength: PREVIEW_STRENGTH,
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
  }, [photoId, previewRetry]);

  /** 量一次「左右还能不能滚」。滚动中、卡片就位后、面板尺寸变了都要重量。 */
  const syncPager = useCallback(() => {
    const el = gridRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    // 1px 容差:分数像素会让 scrollLeft 永远差一点点到不了 max,右箭头就永远消不掉。
    setPager((prev) => {
      const next = { left: el.scrollLeft > 1, right: el.scrollLeft < max - 1 };
      return prev.left === next.left && prev.right === next.right ? prev : next;
    });
  }, []);
  useEffect(() => {
    syncPager();
    const el = gridRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    // 面板宽度会变(桌面折叠对话栏、移动端旋屏),能滚的方向跟着变。
    const ro = new ResizeObserver(syncPager);
    ro.observe(el);
    return () => ro.disconnect();
  }, [syncPager, previewState, scope, photoId]);
  /** 翻一屏,留 15% 重叠 —— 刚扫到的那张不至于被翻过去就找不回来。 */
  const pageBy = (direction: 1 | -1) => {
    const el = gridRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * Math.max(120, el.clientWidth * 0.85), behavior: 'smooth' });
  };

  const apply = (ref: PhotoFilterRef | null) => {
    if (scope === 'photo' && photoId) onChange(setPhotoOverride(state, photoId, ref));
    else onChange(setBookFilter(state, ref));
  };
  const select = (lutId: LutId) => apply({ lutId, strength: quantizeStrength(strength) });
  /** 全书当前风格 —— 「跟随全书」那张卡的缩略图用它,让用户看到跟随的结果长什么样。 */
  const bookLutId = state?.default?.lutId ?? null;

  return (
    <aside
      className="filter-bar"
      role={embedded ? undefined : 'dialog'}
      aria-label={zh ? '照片风格' : 'Photo style'}
    >
      <div className="filter-bar-head">
        <strong>{zh ? '风格' : 'Style'}</strong>
        {/* scope 只在一个地方表达。给了切换器 → 切换器自己就说明了当前在哪一档;
            没给 → 退回静态标签。两者互斥 —— 早先是「标签 + 切换器 + 跟随链接」三份并存。
            谁给谁不给:桌面永远给(它只有「点选中的图 → 风格」一个入口);移动端只在
            **从选中的照片**进来时给 —— 从「更多 → 全书风格」进来时 photoId 只是拿来生成
            缩略图的第一张,切到「这张照片」等于在改一张用户没选过的图(见 FilterSheet)。 */}
        {onScopeChange ? (
          <div className="filter-scope-switch" role="group" aria-label={zh ? '风格应用范围' : 'Style scope'}>
            <button
              type="button"
              className="filter-scope-option"
              aria-pressed={scope === 'photo'}
              onClick={() => onScopeChange('photo')}
            >
              {zh ? '这张照片' : 'This photo'}
            </button>
            <button
              type="button"
              className="filter-scope-option"
              aria-pressed={scope === 'book'}
              onClick={() => onScopeChange('book')}
            >
              {zh ? '整本书' : 'Whole book'}
            </button>
          </div>
        ) : (
          <span className="filter-scope-label">
            {scope === 'book' ? (zh ? '整本书' : 'Whole book') : (zh ? '这张照片' : 'This photo')}
          </span>
        )}
        <button type="button" className="filter-bar-close" onClick={onClose} aria-label={zh ? '关闭风格面板' : 'Close style panel'}>×</button>
      </div>

      {previewState === 'missing' ? (
        <p className="filter-state" role="status">
          {zh ? '这张照片的原图不在本机,换个设备或先备份照片' : 'The original is not on this device'}
        </p>
      ) : previewState === 'error' ? (
        <p className="filter-state filter-error" role="alert">
          {zh ? '预览生成失败。' : 'Preview generation failed.'}
          <button type="button" onClick={() => setPreviewRetry((value) => value + 1)}>
            {zh ? '重试' : 'Retry'}
          </button>
        </p>
      ) : (
        <div className="filter-strip">
          {/* 左右翻页:绝对定位压在横滑条两端,出现/消失不推动卡片(没有布局跳动)。 */}
          {pager.left && (
            <button
              type="button"
              className="filter-page filter-page-prev"
              aria-label={zh ? '上一屏风格' : 'Previous styles'}
              onClick={() => pageBy(-1)}
            >
              ‹
            </button>
          )}
          {pager.right && (
            <button
              type="button"
              className="filter-page filter-page-next"
              aria-label={zh ? '下一屏风格' : 'Next styles'}
              onClick={() => pageBy(1)}
            >
              ›
            </button>
          )}
          <div
            className="filter-grid"
            ref={gridRef}
            onScroll={syncPager}
            role="group"
            aria-label={zh ? '选择风格' : 'Choose a style'}
            aria-busy={previewState === 'loading'}
          >
            {/* 跟随全书:与「原片」并列的一个选择,不是附属操作。book scope 下无意义。 */}
            {scope === 'photo' && photoId && (
              <button
                type="button"
                className="filter-card filter-card-follow"
                aria-pressed={following}
                onClick={() => onChange(clearPhotoOverride(state, photoId))}
              >
                <div className="filter-card-preview">
                  {(bookLutId ? previews[bookLutId] : previews.original) && (
                    <img src={bookLutId ? previews[bookLutId] : previews.original} alt="" />
                  )}
                </div>
                <span>{zh ? '跟随全书' : 'Follow book'}</span>
              </button>
            )}
            <button
              type="button"
              className="filter-card"
              aria-pressed={!following && current === null}
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
                aria-pressed={!following && current?.lutId === definition.id}
                onClick={() => select(definition.id)}
              >
                <div className="filter-card-preview">
                  {previews[definition.id] && <img src={previews[definition.id]} alt="" />}
                </div>
                <span>{zh ? definition.nameZh : definition.id}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 强度只在「当前这一层真的有滤镜」时存在。原片 / 跟随全书 下没有强度可调,
          早先用 disabled 灰着占位 —— 一个永远点不动的控件比没有更让人困惑。 */}
      {current && !following && (
        <label className="filter-strength">
          <span>{zh ? '强度' : 'Strength'} {Math.round(strength)}%</span>
          <input
            type="range"
            min="0"
            max="100"
            step="5"
            value={strength}
            aria-label={zh ? '滤镜强度' : 'Filter strength'}
            onChange={(event) => apply({
              ...current,
              strength: Number(event.currentTarget.value),
            })}
          />
        </label>
      )}

      {persistError && (
        <p className="filter-state filter-error" role="alert">
          {zh ? '风格保存失败。' : 'Style failed to save.'}
          <button type="button" onClick={onRetry}>{zh ? '重试' : 'Retry'}</button>
        </p>
      )}
    </aside>
  );
}
