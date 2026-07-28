'use client';

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
  onRetry,
  onClose,
}: {
  open: boolean;
  locale: string;
  state: PhotoFilterState | null;
  scope: 'book' | 'photo';
  photoId: string | null;
  persistError: string | null;
  onChange: (state: PhotoFilterState) => void;
  onRetry: () => void;
  onClose: () => void;
}) {
  const zh = locale === 'zh';
  return (
    <ModalHost
      open={open}
      onClose={onClose}
      cardClassName="mobile-filter-sheet"
      ariaLabel={zh ? '照片风格' : 'Photo style'}
      testId="filter-sheet"
    >
      <FilterBar
        locale={locale}
        state={state}
        scope={scope}
        photoId={photoId}
        persistError={persistError}
        onChange={onChange}
        onRetry={onRetry}
        onClose={onClose}
      />
    </ModalHost>
  );
}
