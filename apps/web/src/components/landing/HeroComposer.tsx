'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSession } from '@/lib/auth/client';
import { compressFile, type CompressedPhoto } from '@/lib/photo/compress';
import { photoStore } from '@/lib/photo/store';
import {
  clusterCompressedPhotos,
  compressedPhotosFromCache,
  CreditInsufficientError,
  PhotosUnavailableError,
  UnauthorizedError,
  photosFromStore,
  submitAnalyzeV3,
} from '@/lib/generation/client';
import { albumRecipe, generationDraft, type GenerationDraft } from '@/lib/generation/draft';
import type { AppMessages } from '@/lib/i18n/messages';
import type { Locale } from '@/lib/i18n/routing';
import { MAX_PHOTOS_PER_GENERATION } from '@/config/pricing';

type LocalPhoto = {
  photoId: string;
  previewUrl: string;
  width: number;
  height: number;
  // Holds the compressed photo (incl. transient clusterGeo) so clustering can run
  // over the WHOLE selected set at submit time — clusterId is a property of the set,
  // never of a single file, so it can't be assigned in the per-file onFiles loop.
  compressed?: CompressedPhoto;
};

interface Props {
  locale: Locale;
  placeholder: string;
  uploadLabel: string;
  hints: { label: string; fill: string }[];
  createMessages: AppMessages['dashboard']['create'];
  resumeGeneration?: boolean;
  variant?: 'home1' | 'redesign';
  submitLabel?: string;
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
  variant = 'home1',
  submitLabel = t.send,
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

  const submitDraft = async (draft: GenerationDraft, cachedPhotos?: readonly CompressedPhoto[]) => {
    const photoIds = draft.photoIds;
    // No client-side balance pre-check here on purpose: selecting/uploading photos
    // is cheap (compressed, client-side) and is exactly the investment we WANT the
    // user to make before any paywall (sunk-cost — once they've done the work they
    // don't want to abandon). The only billing gate lives server-side, right before
    // the AI runs: submitAnalyzeV3 → precheck + hold inside the album tx, which throws
    // CREDIT_INSUFFICIENT before the agent is ever called (no wasted AI spend). The
    // catch below routes that to /credits.
    // Prefer the in-memory compressed set (cluster it here); else rebuild from
    // IndexedDB (photosFromStore clusters internally). Either way the photos sent
    // carry clusterId only — never coordinates.
    const cached = compressedPhotosFromCache(photoIds, cachedPhotos);
    const builtPhotos = cached ? clusterCompressedPhotos(cached) : await photosFromStore(photoIds);
    const trimmed = draft.prompt.trim();
    const { albumId, requestId } = await submitAnalyzeV3({
      requestId: crypto.randomUUID(),
      language: draft.language,
      // promptHint is optional — omit when blank.
      ...(trimmed ? { promptHint: trimmed } : {}),
      photos: builtPhotos,
    });
    generationDraft.clear();
    albumRecipe.save(albumId, { language: draft.language, photoIds, requestId });
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
        if (photos.length + next.length >= MAX_PHOTOS_PER_GENERATION) break;
        const photoId = crypto.randomUUID();
        const compressed = await compressFile(f, photoId);
        await photoStore.put(photoId, f);
        const previewUrl = (await photoStore.getObjectUrl(photoId)) ?? '';
        next.push({
          photoId,
          previewUrl,
          width: compressed.width,
          height: compressed.height,
          compressed,
        });
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
    if (busy) return;
    if (photos.length < 1) {
      setErr(t.errPhotoMin);
      return;
    }
    // The story prompt is optional in v2 (promptHint): photos are the only required
    // step. If blank, the authoring flow asks the theme question first.
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
      await submitDraft(draft, photos.map((p) => p.compressed).filter((p): p is CompressedPhoto => !!p));
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

  if (variant === 'redesign') {
    return (
      <>
        <style>{`
          #homepage-composer.landing-composer {
            position: relative; z-index: 1; border-radius: 22px; padding: 16px 16px 14px; text-align: left;
            background: rgba(255,255,255,.58);
            -webkit-backdrop-filter: blur(24px) saturate(180%); backdrop-filter: blur(24px) saturate(180%);
            border: 1px solid rgba(255,255,255,.70);
            box-shadow: 0 6px 30px rgba(0,0,0,.10), 0 1px 2px rgba(0,0,0,.04), inset 0 1px 0 rgba(255,255,255,.9);
            transition: box-shadow .3s ease;
          }
          #homepage-composer.landing-composer:focus-within {
            box-shadow: 0 0 0 4px rgba(19,184,166,.18), 0 12px 44px rgba(140,94,244,.16);
          }
          #homepage-composer .cmp-input {
            width: 100%; border: 0; outline: none; resize: none; font-size: 15px; line-height: 1.6;
            color: #111; background: transparent; padding: 6px 4px; font-family: inherit;
          }
          #homepage-composer .cmp-input::placeholder { color: #888; }
          #homepage-composer .cmp-tile {
            display: grid; place-items: center; margin-left: 14px; margin-top: 12px; width: 66px; aspect-ratio: 1 / 1.414;
            flex: none; border-radius: 12px; background: rgba(17,17,17,.05); border: 0; color: #9aa0a8; cursor: pointer;
            transform: rotate(-20deg); transition: background .15s, color .15s, transform .18s cubic-bezier(.34,1.56,.64,1);
          }
          #homepage-composer .cmp-tile:hover { background: rgba(17,17,17,.09); color: #555; }
          #homepage-composer .cmp-tile:active { transform: rotate(0deg) scale(.97); }
          #homepage-composer .btn-glow { position: relative; display: inline-block; }
          #homepage-composer .btn-glow > button { position: relative; z-index: 1; transition: transform .2s ease, opacity .2s ease; }
          #homepage-composer .btn-glow::after {
            content: ''; position: absolute; z-index: 0; pointer-events: none;
            left: 6%; right: 6%; bottom: -3px; height: 72%;
            background: linear-gradient(90deg, var(--grad-green), var(--grad-purple), var(--grad-lime));
            filter: blur(14px); opacity: .7; border-radius: 9999px;
            transition: filter .3s ease, opacity .3s ease, bottom .3s ease;
          }
          #homepage-composer .btn-glow:not(.btn-glow-disabled):hover > button { transform: translateY(-2px); }
          #homepage-composer .btn-glow:not(.btn-glow-disabled):hover::after { filter: blur(18px); opacity: .85; bottom: -5px; }
          #homepage-composer .btn-glow-disabled::after { opacity: 0; }
          #homepage-composer .cmp-submit {
            display: inline-flex; align-items: center; gap: 6px; padding: 10px 28px; border-radius: 9999px;
            background: #111; color: #fff; font-size: 14px; font-weight: 600; cursor: pointer; border: 0;
          }
        `}</style>
        <div id="homepage-composer" className="landing-composer">
          <div className="flex items-start gap-4">
            <label title={uploadLabel} aria-disabled={busy} className="cmp-tile">
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                disabled={busy}
                aria-label={uploadLabel}
                onChange={(e) => onFiles(e.target.files)}
              />
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </label>
            <textarea
              rows={4}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              maxLength={500}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (busy) return;
                  void submit();
                }
              }}
              placeholder={placeholder}
              className="cmp-input flex-1 min-w-0"
            />
          </div>
          {photos.length > 0 && (
            <div className="mt-4">
              <div className="grid grid-cols-6 gap-2 md:grid-cols-8">
                {photos.map((p) => (
                  <div key={p.photoId} className="group relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.previewUrl} alt="" className="aspect-square w-full rounded-lg object-cover" />
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
          <div className="flex justify-end" style={{ marginTop: '-22px' }}>
            <div className={`btn-glow ${busy ? 'btn-glow-disabled' : ''}`}>
              <button
                type="button"
                onClick={submit}
                disabled={busy}
                aria-label={t.send}
                title={t.send}
                className="cmp-submit disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                ) : (
                  <>
                    <span>{submitLabel}</span>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                      <path d="M5 12h14M13 6l6 6-6 6" />
                    </svg>
                  </>
                )}
              </button>
            </div>
          </div>
          {err && <p className="mt-4 text-sm text-red-600">{err}</p>}
        </div>
      </>
    );
  }

  return (
    <>
      <style>{`
        #homepage-composer .btn-glow { position: relative; }
        #homepage-composer .btn-glow > button { position: relative; z-index: 1; }
        #homepage-composer .btn-glow::after {
          content: ''; position: absolute; z-index: 0; pointer-events: none;
          left: 6%; right: 6%; bottom: -3px; height: 72%;
          background: linear-gradient(90deg, var(--grad-green), var(--grad-purple), var(--grad-lime));
          filter: blur(13px); opacity: .6; border-radius: 9999px;
          transition: filter .3s ease, opacity .3s ease, bottom .3s ease;
        }
        #homepage-composer .btn-glow:not(.btn-glow-disabled):hover > button { transform: translateY(-2px); }
        #homepage-composer .btn-glow:not(.btn-glow-disabled):hover::after { filter: blur(17px); opacity: .78; bottom: -5px; }
        #homepage-composer .btn-glow-round::after { left: -14%; right: -14%; bottom: -3px; height: 100%; filter: blur(10px); opacity: .6; }
        #homepage-composer .btn-glow-round:not(.btn-glow-disabled):hover > button { transform: translateY(-1px); }
        #homepage-composer .btn-glow-round:not(.btn-glow-disabled):hover::after { filter: blur(13px); opacity: .8; bottom: -4px; }
      `}</style>
      <div
        id="homepage-composer"
        className="relative z-[1] w-full max-w-[720px] rounded-[22px] p-[2px] text-left transition-shadow focus-within:shadow-[0_0_0_4px_rgba(19,184,166,0.18)]"
        style={{
          background: 'linear-gradient(135deg, var(--grad-green), var(--grad-purple) 55%, var(--grad-lime))',
        }}
      >
        <div className="rounded-[20px] bg-[var(--surface)] p-4 sm:p-5">
          <div className="flex items-start gap-3 sm:gap-4">
            <label
              title={uploadLabel}
              aria-disabled={busy}
              className="flex h-[78px] w-[52px] flex-shrink-0 -rotate-[15deg] cursor-pointer items-center justify-center rounded-lg bg-[var(--bg)] text-[var(--muted)] transition-colors hover:bg-[var(--border)] hover:text-[var(--fg)] aria-disabled:opacity-50"
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
              rows={2}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              maxLength={500}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (busy) return;
                  void submit();
                }
              }}
              placeholder={placeholder}
              className="flex-1 resize-none border-none bg-transparent pt-1 text-[var(--text-base)] leading-relaxed text-[var(--fg)] outline-none placeholder:text-[var(--meta)]"
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
          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
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
            <div className={`btn-glow btn-glow-round flex-shrink-0 ${busy ? 'btn-glow-disabled' : ''}`}>
              <button
                type="button"
                onClick={submit}
                disabled={busy}
                aria-label={t.send}
                title={t.send}
                className="grid h-10 w-10 place-items-center rounded-full bg-[var(--fg)] text-white transition-transform duration-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]">
                    <line x1="12" y1="19" x2="12" y2="5" />
                    <polyline points="5 12 12 5 19 12" />
                  </svg>
                )}
              </button>
            </div>
          </div>
          {err && <p className="mt-4 text-sm text-red-600">{err}</p>}
          <p className="mt-4 text-xs text-[var(--meta)]">{busy ? t.compressing : t.tip}</p>
        </div>
      </div>
    </>
  );
}
