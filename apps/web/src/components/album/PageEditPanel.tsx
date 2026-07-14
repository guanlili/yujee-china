'use client';

import { useEffect, useState } from 'react';
import { getTemplate } from '@yujee/contracts/templates';
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

// Short per-role hint mirrored from the agent writing guides (placeholder copy).
const ROLE_HINT: Record<string, string> = {
  title: 'short heading',
  body: 'narrative, first person',
  explain: "caption — what's in the photo",
  decoration: 'date / number / label (auto)',
};

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-[var(--bg)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-[var(--meta)]">
      {children}
    </span>
  );
}

// Editing surface for the selected page. Each slot now shows its template role
// (title/body/explain/decoration), language, and char budget so the layout can
// be hand-tuned with the slot's intent visible. Slots come from the template
// definition (every slot, even empty ones), with any stray page-data keys
// appended so legacy content is never hidden.
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

  const tpl = getTemplate(page.templateId);

  const imageSlots = tpl?.images ?? [];
  const imageIds = new Set(imageSlots.map((s) => s.id));
  const extraImageIds = Object.keys(page.imagesJson).filter((id) => !imageIds.has(id));

  const textSlots = tpl?.texts ?? [];
  const textIds = new Set(textSlots.map((s) => s.id));
  const extraTextIds = Object.keys(page.textsJson).filter((id) => !textIds.has(id));

  const hasImages = imageSlots.length > 0 || extraImageIds.length > 0;
  const hasTexts = textSlots.length > 0 || extraTextIds.length > 0;

  const renderImage = (slot: string, hint?: string) => {
    const photoId = page.imagesJson[slot] ?? '';
    const url = imageUrls[photoId];
    return (
      <div key={slot} className="flex items-center gap-3">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={slot}
            className="h-12 w-12 shrink-0 rounded-[var(--radius-md)] object-cover shadow-[var(--shadow-card)]"
          />
        ) : (
          <div className="h-12 w-12 shrink-0 rounded-[var(--radius-md)] bg-[var(--bg)] shadow-[var(--shadow-card)]" />
        )}
        <div className="flex-1">
          <span className="flex items-center gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--meta)]">{slot}</span>
            {hint && <Badge>{hint}</Badge>}
          </span>
          <select
            value={photoId}
            onChange={(e) => onSaveImage(slot, e.target.value)}
            className="mt-1 w-full rounded-full border border-[var(--border-soft)] bg-[var(--surface)] px-3.5 py-2 text-[var(--text-sm)] text-[var(--fg)] shadow-[0_1px_3px_rgba(0,0,0,0.04)] outline-none transition-all focus:border-[var(--accent)] focus:shadow-[var(--focus-ring)]"
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
  };

  // 不显示字数计数/上限：模板不再声明字数限制，用户写多长都行（版面自动缩字号装下）。
  const renderText = (slot: string, meta?: { role: string; lang: string }) => {
    const value = drafts[slot] ?? '';
    return (
      <label key={slot} className="block">
        <span className="flex items-center gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--meta)]">{slot}</span>
          {meta && (
            <>
              <Badge>{meta.role}</Badge>
              <Badge>{meta.lang}</Badge>
            </>
          )}
        </span>
        <textarea
          value={value}
          rows={Math.max(1, Math.ceil(value.length / 40))}
          placeholder={meta ? ROLE_HINT[meta.role] : undefined}
          onChange={(e) => setDrafts((d) => ({ ...d, [slot]: e.target.value }))}
          onBlur={() => {
            if (drafts[slot] !== page.textsJson[slot]) onSaveText(slot, drafts[slot] ?? '');
          }}
          className="mt-1 w-full resize-none rounded-[var(--radius-lg)] border border-[var(--border-soft)] bg-[var(--surface)] px-3.5 py-2.5 text-[var(--text-sm)] leading-relaxed text-[var(--fg)] shadow-[0_1px_3px_rgba(0,0,0,0.04)] outline-none transition-all placeholder:text-[var(--meta)] focus:border-[var(--accent)] focus:shadow-[var(--focus-ring)]"
        />
      </label>
    );
  };

  return (
    <div className="space-y-6">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--meta)]">
        {t.editPageTitle.replace('{n}', String(page.pageIndex + 1))} · {page.templateId}
      </p>

      {hasImages && (
        <div className="space-y-3">
          <p className="text-[var(--text-sm)] font-semibold text-[var(--fg)]">{t.photos}</p>
          {imageSlots.map((s) => {
            const hint = [s.orientation?.[0], s.quality?.[0]].filter(Boolean).join(' · ');
            return renderImage(s.id, hint || undefined);
          })}
          {extraImageIds.map((id) => renderImage(id))}
        </div>
      )}

      {hasTexts && (
        <div className="space-y-3">
          <p className="text-[var(--text-sm)] font-semibold text-[var(--fg)]">{t.text}</p>
          {textSlots.map((s) =>
            renderText(s.id, { role: s.role, lang: s.lang }),
          )}
          {extraTextIds.map((id) => renderText(id))}
        </div>
      )}
    </div>
  );
}
