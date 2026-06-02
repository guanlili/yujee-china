'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSession } from '@/lib/auth/client';
import { compressFile } from '@/lib/photo/compress';
import { photoStore } from '@/lib/photo/store';
import {
  CreditInsufficientError,
  PhotosUnavailableError,
  UnauthorizedError,
  photosFromStore,
  submitGeneration,
} from '@/lib/generation/client';
import { albumRecipe, generationDraft, type GenerationDraft } from '@/lib/generation/draft';
import type { AppMessages } from '@/lib/i18n/messages';
import type { Locale } from '@/lib/i18n/routing';

type LocalPhoto = {
  photoId: string;
  previewUrl: string;
  width: number;
  height: number;
};

interface Props {
  locale: Locale;
  placeholder: string;
  uploadLabel: string;
  hints: { label: string; fill: string }[];
  createMessages: AppMessages['dashboard']['create'];
  resumeGeneration?: boolean;
}

function inferLanguage(prompt: string): 'zh' | 'en' {
  return /[一-龥]/.test(prompt) ? 'zh' : 'en';
}

export function HeroComposer({
  locale,
  placeholder,
  uploadLabel,
  hints,
  createMessages: t,
  resumeGeneration = false,
}: Props) {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const resumeAttempted = useRef(false);

  const loginResumePath = `/${locale}?resumeGeneration=1`;
  const loginPath = `/${locale}/login?from=${encodeURIComponent(loginResumePath)}`;

  const hasActiveSession = async () => {
    try {
      const { data } = await getSession();
      return !!data?.session;
    } catch {
      return false;
    }
  };

  const saveDraftAndLogin = (draft: GenerationDraft) => {
    generationDraft.save(draft);
    router.push(loginPath);
  };

  const submitDraft = async (draft: GenerationDraft) => {
    const photoIds = draft.photoIds;
    const builtPhotos = await photosFromStore(photoIds);
    const { albumId } = await submitGeneration({
      requestId: crypto.randomUUID(),
      prompt: draft.prompt.trim(),
      language: draft.language,
      photos: builtPhotos,
    });
    generationDraft.clear();
    albumRecipe.save(albumId, { language: draft.language, photoIds });
    router.push(`/${locale}/album/${albumId}`);
  };

  useEffect(() => {
    if (!resumeGeneration || resumeAttempted.current) return;
    resumeAttempted.current = true;
    const draft = generationDraft.load();
    if (!draft) return;
    let cancelled = false;
    setBusy(true);
    setErr(null);
    setValue(draft.prompt);
    (async () => {
      const urls = await photoStore.getObjectUrls(draft.photoIds);
      const restored = draft.photoIds
        .filter((id) => urls[id])
        .map((id) => ({ photoId: id, previewUrl: urls[id]!, width: 0, height: 0 }));
      if (cancelled) return;
      setPhotos(restored);
      if (restored.length < 1) {
        generationDraft.clear();
        setErr(t.errPhotosUnavailable);
        setBusy(false);
        return;
      }
      try {
        const hasSession = await hasActiveSession();
        if (!hasSession) {
          saveDraftAndLogin(draft);
          return;
        }
        await submitDraft(draft);
      } catch (e) {
        if (cancelled) return;
        if (e instanceof CreditInsufficientError) {
          router.push(`/${locale}/credits?from=home`);
          return;
        }
        if (e instanceof UnauthorizedError) {
          saveDraftAndLogin(draft);
          return;
        }
        if (e instanceof PhotosUnavailableError) {
          generationDraft.clear();
          setErr(t.errPhotosUnavailable);
        } else {
          setErr(e instanceof Error ? e.message : String(e));
        }
        setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [locale, resumeGeneration, router, t.errPhotosUnavailable]);

  const onFiles = async (files: FileList | null) => {
    if (!files) return;
    setBusy(true);
    setErr(null);
    try {
      const next: LocalPhoto[] = [];
      for (const f of Array.from(files)) {
        if (photos.length + next.length >= 30) break;
        const photoId = crypto.randomUUID();
        const { width, height } = await compressFile(f, photoId);
        await photoStore.put(photoId, f);
        const previewUrl = (await photoStore.getObjectUrl(photoId)) ?? '';
        next.push({ photoId, previewUrl, width, height });
      }
      setPhotos((prev) => [...prev, ...next]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = (photoId: string) =>
    setPhotos((prev) => prev.filter((p) => p.photoId !== photoId));

  const submit = async () => {
    if (photos.length < 1) {
      setErr(t.errPhotoMin);
      return;
    }
    if (!value.trim()) {
      setErr(t.errPromptEmpty);
      return;
    }
    setBusy(true);
    setErr(null);
    const language = inferLanguage(value);
    const photoIds = photos.map((p) => p.photoId);
    const draft = { prompt: value.trim(), language, photoIds };
    try {
      const hasSession = await hasActiveSession();
      if (!hasSession) {
        saveDraftAndLogin(draft);
        return;
      }
      await submitDraft(draft);
    } catch (e) {
      if (e instanceof CreditInsufficientError) {
        generationDraft.save(draft);
        router.push(`/${locale}/credits?from=home`);
        return;
      }
      if (e instanceof UnauthorizedError) {
        saveDraftAndLogin(draft);
        return;
      }
      if (e instanceof PhotosUnavailableError) {
        setErr(t.errPhotosUnavailable);
        setBusy(false);
        return;
      }
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div
      id="homepage-composer"
      className="relative z-[1] w-full max-w-[720px] rounded-2xl p-[2px] transition-shadow"
      style={{
        background: 'linear-gradient(135deg, var(--grad-green), var(--grad-purple), var(--grad-lime))',
        boxShadow:
          '0 0 20px rgba(23,225,135,0.15), 0 0 40px rgba(140,94,244,0.1), 0 0 60px rgba(218,244,94,0.08)',
      }}
    >
      <div className="rounded-2xl bg-[var(--surface)] p-5">
        <div className="flex items-start gap-3.5">
          <label
            title={uploadLabel}
            aria-disabled={busy}
            className="flex h-[78px] w-[52px] flex-shrink-0 -rotate-[15deg] cursor-pointer items-center justify-center rounded-2xl bg-[var(--bg)] text-[var(--muted)] transition-colors hover:bg-[var(--border)] hover:text-[var(--fg)] aria-disabled:opacity-50"
          >
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              disabled={busy}
              aria-label={uploadLabel}
              onChange={(e) => onFiles(e.target.files)}
            />
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-[22px] w-[22px]">
              <line x1="12" y1="6" x2="12" y2="18" />
              <line x1="6" y1="12" x2="18" y2="12" />
            </svg>
          </label>
          <textarea
            rows={3}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            maxLength={500}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder={placeholder}
            className="min-h-[72px] flex-1 resize-none border-none bg-transparent text-[var(--text-base)] leading-relaxed text-[var(--fg)] outline-none placeholder:text-[var(--meta)]"
          />
        </div>
        {photos.length > 0 && (
          <div className="mt-4">
            <div className="grid grid-cols-6 gap-2 md:grid-cols-8">
              {photos.map((p) => (
                <div key={p.photoId} className="group relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.previewUrl}
                    alt=""
                    className="aspect-square w-full rounded-lg object-cover"
                  />
                  <button
                    type="button"
                    aria-label={t.removePhoto}
                    onClick={() => remove(p.photoId)}
                    className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-[var(--meta)]">
              {t.photoCount.replace('{count}', String(photos.length))} · {t.minPhotos}
            </p>
          </div>
        )}
        <div className="mt-3.5 flex items-center justify-between gap-3">
          <div className="hidden flex-1 flex-wrap gap-1.5 sm:flex">
            {hints.map((hint) => (
              <button
                key={hint.label}
                type="button"
                onClick={() => setValue(hint.fill)}
                className="rounded-full bg-[var(--bg)] px-2.5 py-1 text-[var(--text-xs)] text-[var(--meta)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-colors hover:bg-[var(--border-soft)] hover:text-[var(--fg-2)]"
              >
                {hint.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            aria-label={t.send}
            title={t.send}
            className="flex h-[42px] w-[42px] flex-shrink-0 items-center justify-center rounded-full bg-[var(--fg)] text-[var(--surface)] transition-all duration-200 hover:enabled:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-40"
            style={{
              boxShadow:
                '-6px 4px 8px -4px rgba(23,225,135,0.5), -3px 4px 8px -4px rgba(218,244,94,0.45), 0px 4px 8px -4px rgba(140,94,244,0.5), 3px 4px 8px -4px rgba(218,244,94,0.45), 6px 4px 8px -4px rgba(23,225,135,0.5)',
            }}
          >
            {busy ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            )}
          </button>
        </div>
        {err && <p className="mt-4 text-sm text-red-600">{err}</p>}
        <p className="mt-4 text-xs text-[var(--meta)]">{busy ? t.compressing : t.tip}</p>
      </div>
    </div>
  );
}
