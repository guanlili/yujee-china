'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { compressFile } from '@/lib/photo/compress';
import { photoStore } from '@/lib/photo/store';
import {
  submitGeneration,
  photosFromStore,
  CreditInsufficientError,
  PhotosUnavailableError,
} from '@/lib/generation/client';
import { generationDraft, albumRecipe } from '@/lib/generation/draft';
import { getMessages } from '@/lib/i18n/messages';
import type { Locale } from '@/lib/i18n/routing';
import { AppChrome } from '@/components/app/AppChrome';

type LocalPhoto = {
  photoId: string;
  previewUrl: string;
  width: number;
  height: number;
};

function inferLanguage(prompt: string): 'zh' | 'en' {
  return /[一-龥]/.test(prompt) ? 'zh' : 'en';
}

export default function CreatePage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = use(params);
  const t = getMessages(locale).dashboard.create;
  const router = useRouter();
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [resumed, setResumed] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Coming back from /pricing after topping up (§6.5.2): rebuild the form from
  // the saved draft + the originals still in IndexedDB so the user resubmits the
  // exact same memoir. If the originals are gone (cleared cache / other device)
  // we drop the draft and start clean rather than submit a partial set.
  useEffect(() => {
    const draft = generationDraft.load();
    if (!draft) return;
    let cancelled = false;
    (async () => {
      const urls = await photoStore.getObjectUrls(draft.photoIds);
      const restored = draft.photoIds
        .filter((id) => urls[id])
        .map((id) => ({ photoId: id, previewUrl: urls[id]!, width: 0, height: 0 }));
      if (cancelled) return;
      if (restored.length < 1) {
        generationDraft.clear();
        return;
      }
      setPrompt(draft.prompt);
      setPhotos(restored);
      setResumed(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
        // Originals live in IndexedDB only (invariant 1); base64 is rebuilt from
        // them at submit time, so a /pricing detour can resume without re-upload.
        await photoStore.put(photoId, f);
        const previewUrl = (await photoStore.getObjectUrl(photoId)) ?? '';
        next.push({ photoId, previewUrl, width, height });
      }
      setPhotos((prev) => [...prev, ...next]);
    } catch (e) {
      setErr(String(e));
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
    if (!prompt.trim()) {
      setErr(t.errPromptEmpty);
      return;
    }
    setBusy(true);
    setErr(null);
    const language = inferLanguage(prompt);
    const photoIds = photos.map((p) => p.photoId);
    try {
      const builtPhotos = await photosFromStore(photoIds);
      const { albumId } = await submitGeneration({
        requestId: crypto.randomUUID(),
        prompt: prompt.trim(),
        language,
        photos: builtPhotos,
      });
      // Submitted — the draft has served its purpose. Persist the per-album
      // recipe so a later FAILED → retry knows which originals to resend (§6.5.3).
      generationDraft.clear();
      albumRecipe.save(albumId, { language, photoIds });
      // Address the album by uuid — it polls itself by status. No job id in the
      // URL: a stale/cleaned-up requestId must never gate whether the album opens.
      router.push(`/${locale}/album/${albumId}`);
    } catch (e) {
      if (e instanceof CreditInsufficientError) {
        // Short on credits: stash the draft (originals already in IndexedDB),
        // send the user to /credits to top up — that's the real checkout entry,
        // not /pricing — then resume here on return (§6.5.2).
        generationDraft.save({ prompt: prompt.trim(), language, photoIds });
        router.push(`/${locale}/credits?from=create`);
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

  const canSubmit = !busy && photos.length >= 1 && prompt.trim().length > 0;

  return (
    <AppChrome locale={locale} activeNav="home" showCredits={false} showFooter>
      {/* Brand glow CTA (DESIGN.md §4): black pill on top, ::after linear-gradient
          (green→purple→lime) + blur underneath. Scoped to this page only — does
          not touch globals.css. This is the composer's primary CTA glow. */}
      <style>{`
        .yj-btn-glow { position: relative; }
        .yj-btn-glow > button { position: relative; z-index: 1; }
        .yj-btn-glow::after {
          content: ''; position: absolute; z-index: 0; pointer-events: none;
          left: -14%; right: -14%; bottom: -3px; height: 100%;
          background: linear-gradient(90deg, var(--grad-green), var(--grad-purple), var(--grad-lime));
          filter: blur(10px); opacity: .6; border-radius: 9999px;
          transition: filter .3s ease, opacity .3s ease, bottom .3s ease;
        }
        .yj-btn-glow:hover:not(.is-disabled) > button { transform: translateY(-1px); }
        .yj-btn-glow:hover:not(.is-disabled)::after { filter: blur(13px); opacity: .8; bottom: -4px; }
        .yj-btn-glow.is-disabled::after { opacity: 0; }
      `}</style>
      <section className="relative flex flex-col items-center justify-center overflow-hidden px-5 pb-20 pt-20 sm:px-8 md:pt-28 min-h-[78vh]">
        {/* Hero ambient glow — one per page (DESIGN.md §5): three-colour mirrored
            diffuse halo. rgba is allowed for ambient gradients per the brief. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              'radial-gradient(ellipse 80% 60% at 0% 0%, rgba(19,184,166,0.07) 0%, transparent 70%), radial-gradient(ellipse 60% 70% at 50% 100%, rgba(140,94,244,0.06) 0%, transparent 70%), radial-gradient(ellipse 70% 50% at 100% 18%, rgba(218,244,94,0.06) 0%, transparent 70%)',
          }}
        />

        <h1
          className="m-0 max-w-[720px] text-center text-[clamp(30px,5.4vw,52px)] font-extrabold leading-[1.14] tracking-[-0.02em] text-[var(--fg)]"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {t.heroTitle}
        </h1>
        <p className="mt-3.5 mb-9 max-w-[520px] text-center text-[clamp(15px,2.2vw,19px)] leading-[1.55] text-[var(--muted)]">
          {t.heroSub}
        </p>

        {resumed && (
          <div className="mb-7 w-full max-w-[720px] rounded-2xl border border-[var(--accent)]/30 bg-[var(--accent)]/10 px-5 py-3.5 text-sm">
            {t.resumeBanner}
          </div>
        )}

        {/* Composer: 2px brand gradient border, 22px radius, teal focus ring */}
        <div
          className="relative w-full max-w-[720px] rounded-[22px] p-[2px] transition-shadow duration-300 focus-within:shadow-[0_0_0_4px_rgba(19,184,166,0.18)]"
          style={{
            background: 'linear-gradient(135deg, var(--grad-green), var(--grad-purple) 55%, var(--grad-lime))',
          }}
        >
          <div className="rounded-[20px] bg-[var(--surface)] p-4 sm:p-5">
            <div className="flex items-start gap-3 sm:gap-4">
              <label
                title={t.uploadTitle}
                className="flex h-[78px] w-[52px] flex-shrink-0 -rotate-[15deg] cursor-pointer items-center justify-center rounded-lg bg-[var(--bg)] text-[var(--muted)] transition-transform duration-200 hover:scale-[1.04] hover:text-[var(--fg-2)] aria-disabled:opacity-50"
                aria-disabled={busy}
              >
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  disabled={busy}
                  onChange={(e) => onFiles(e.target.files)}
                />
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-[22px] w-[22px]">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                maxLength={500}
                rows={3}
                placeholder={t.placeholder}
                className="min-h-[72px] flex-1 resize-none border-none bg-transparent pt-1 text-base leading-relaxed text-[var(--fg)] outline-none placeholder:text-[var(--meta)]"
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
                        className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-black/60 text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
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
                {t.hints.map((h) => (
                  <button
                    key={h.label}
                    type="button"
                    onClick={() => setPrompt(h.prompt)}
                    className="rounded-full bg-[var(--bg)] px-2.5 py-1 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--border-soft)] hover:text-[var(--fg-2)]"
                  >
                    {h.label}
                  </button>
                ))}
              </div>
              <div
                className={`yj-btn-glow flex-shrink-0${canSubmit ? '' : ' is-disabled'}`}
              >
                <button
                  type="button"
                  onClick={submit}
                  disabled={!canSubmit}
                  aria-label={t.send}
                  title={t.send}
                  className="grid h-10 w-10 place-items-center rounded-full bg-[var(--fg)] text-[var(--surface)] transition-transform duration-200 disabled:cursor-not-allowed disabled:opacity-40"
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
          </div>
        </div>

        {err && <p className="mt-5 text-sm text-red-600">{err}</p>}
        <p className="mt-4 text-xs text-[var(--meta)]">{busy ? t.compressing : t.tip}</p>
      </section>
    </AppChrome>
  );
}
