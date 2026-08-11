'use client';

import { boundPick } from '@/lib/i18n/pick';
import type { Locale } from '@/lib/i18n/routing';
import type { PhotoFilterState } from '@/lib/photo/filter-state';
import { FilterBar } from '../../FilterBar';
import { ModalHost } from './ModalHost';

export function FilterSheet({
  open,
  locale,
  state,
  scope,
  photoId,
  persistError,
  onChange,
  onScopeChange,
  onRetry,
  onClose,
}: {
  open: boolean;
  locale: Locale;
  state: PhotoFilterState | null;
  scope: 'book' | 'photo';
  photoId: string | null;
  persistError: string | null;
  onChange: (state: PhotoFilterState) => void;
  /** 给了就渲染「这张照片 / 整本书」切换器,不给退回静态标签(见 FilterBar)。
   *  Root 只在**从选中的照片进来**时给 —— 那时「这张照片」才指得明白是哪张。
   *  从「更多 → 全书风格」进来时 photoId 只是拿来生成缩略图的第一张,切到 photo
   *  等于在改一张用户没选过的照片,所以那条入口不给切换器。 */
  onScopeChange?: (scope: 'book' | 'photo') => void;
  onRetry: () => void;
  onClose: () => void;
}) {
  const aT = boundPick(locale);
  return (
    <ModalHost
      open={open}
      onClose={onClose}
      variant="bottom-sheet"
      cardClassName="mobile-filter-sheet"
      ariaLabel={aT('照片风格', 'Photo style')}
      testId="filter-sheet"
    >
      <FilterBar
        embedded
        locale={locale}
        state={state}
        scope={scope}
        photoId={photoId}
        persistError={persistError}
        onChange={onChange}
        onScopeChange={onScopeChange}
        onRetry={onRetry}
        onClose={onClose}
      />
    </ModalHost>
  );
}
