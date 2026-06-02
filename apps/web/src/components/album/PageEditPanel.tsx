'use client';

import { useEffect, useState } from 'react';
import type { Locale } from '@/lib/i18n/routing';
import { getMessages } from '@/lib/i18n/messages';
import type { EditorPage } from './types';

interface Props {
  page: EditorPage;
  locale: Locale;
  availablePhotoIds: string[];
  imageUrls: Record<string, string>;
  onSaveText: (slot: string, value: string) => void;
  onSaveImage: (slot: string, photoId: string) => void;
}

// Editing surface for the selected page: one field per text slot (save on blur)
// and a photo picker per image slot. Drag-to-swap is reduced to a dropdown for
// v1 — same PATCH /pages/[idx] contract, simpler to ship.
export function PageEditPanel({
  page,
  locale,
  availablePhotoIds,
  imageUrls,
  onSaveText,
  onSaveImage,
}: Props) {
  const t = getMessages(locale).dashboard.editor;
  const [drafts, setDrafts] = useState<Record<string, string>>(page.textsJson);

  useEffect(() => {
    setDrafts(page.textsJson);
  }, [page.pageIndex, page.textsJson]);

  const textSlots = Object.keys(page.textsJson);
  const imageSlots = Object.keys(page.imagesJson);

  return (
    <div className="space-y-6">
      <p className="uppercase tracking-[0.2em] text-[10px] text-[var(--muted)]">
        {t.editPageTitle.replace('{n}', String(page.pageIndex + 1))} · {page.templateId}
      </p>

      {imageSlots.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-medium">{t.photos}</p>
          {imageSlots.map((slot) => {
            const photoId = page.imagesJson[slot] ?? '';
            const url = imageUrls[photoId];
            return (
              <div key={slot} className="flex items-center gap-3">
                {url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={url} alt={slot} className="w-12 h-12 object-cover rounded" />
                ) : (
                  <div className="w-12 h-12 rounded bg-[var(--border)] shrink-0" />
                )}
                <div className="flex-1">
                  <p className="text-[10px] uppercase tracking-wide text-[var(--muted)]">{slot}</p>
                  <select
                    value={photoId}
                    onChange={(e) => onSaveImage(slot, e.target.value)}
                    className="mt-1 w-full text-sm border border-[var(--border)] rounded px-2 py-1 bg-white"
                  >
                    {!availablePhotoIds.includes(photoId) && photoId && (
                      <option value={photoId}>{photoId}</option>
                    )}
                    {availablePhotoIds.map((id) => (
                      <option key={id} value={id}>
                        {id}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {textSlots.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-medium">{t.text}</p>
          {textSlots.map((slot) => (
            <label key={slot} className="block">
              <span className="text-[10px] uppercase tracking-wide text-[var(--muted)]">{slot}</span>
              <textarea
                value={drafts[slot] ?? ''}
                rows={Math.max(1, Math.ceil((drafts[slot] ?? '').length / 40))}
                onChange={(e) => setDrafts((d) => ({ ...d, [slot]: e.target.value }))}
                onBlur={() => {
                  if (drafts[slot] !== page.textsJson[slot]) onSaveText(slot, drafts[slot] ?? '');
                }}
                className="mt-1 w-full text-sm border border-[var(--border)] rounded px-2 py-1.5 bg-white"
              />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
