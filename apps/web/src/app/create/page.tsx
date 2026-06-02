'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { compressFile } from '@/lib/photo/compress';
import { photoStore } from '@/lib/photo/store';
import {
  submitGeneration,
  photosFromStore,
  CreditInsufficientError,
  PhotosUnavailableError,
} from '@/lib/generation/client';
import { generationDraft, albumRecipe } from '@/lib/generation/draft';
import { detectLocale } from '@/lib/i18n/routing';

type LocalPhoto = {
  photoId: string;
  previewUrl: string;
  width: number;
  height: number;
};

function inferLanguage(prompt: string): 'zh' | 'en' {
  return /[一-龥]/.test(prompt) ? 'zh' : 'en';
}

export default function CreatePage() {
  const router = useRouter();
  const pathname = usePathname();
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
      if (restored.length < 3) {
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
      setErr('Add at least 1 photo.');
      return;
    }
    if (!prompt.trim()) {
      setErr('Tell us a short story prompt.');
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
      router.push(`/album/${albumId}`);
    } catch (e) {
      if (e instanceof CreditInsufficientError) {
        // Short on credits: stash the draft (originals already in IndexedDB),
        // send the user to /credits to top up — that's the real checkout entry,
        // not /pricing — then resume here on return (§6.5.2).
        generationDraft.save({ prompt: prompt.trim(), language, photoIds });
        const locale = detectLocale(pathname);
        router.push(`/${locale}/credits?from=create`);
        return;
      }
      if (e instanceof PhotosUnavailableError) {
        setErr('Some photos are no longer available on this device. Please re-add them.');
        setBusy(false);
        return;
      }
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen max-w-3xl mx-auto px-6 py-16">
      <p className="uppercase tracking-[0.3em] text-xs text-[var(--muted)] mb-4">Step 1</p>
      <h1 className="serif text-4xl mb-8">Start a memoir</h1>

      {resumed && (
        <p className="mb-8 rounded-lg bg-[var(--accent)]/10 border border-[var(--accent)]/30 px-4 py-3 text-sm">
          Welcome back — your photos and story are ready. Tap “Generate my memoir” to continue.
        </p>
      )}

      <label className="block">
        <span className="text-sm font-medium">Your story prompt</span>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          maxLength={500}
          rows={3}
          placeholder="e.g. A spring trip to Kyoto with my mother"
          className="mt-2 w-full p-4 rounded-lg border border-[var(--border)] bg-white text-base"
        />
        <span className="text-xs text-[var(--muted)]">{prompt.length}/500</span>
      </label>

      <div className="mt-10">
        <p className="text-sm font-medium mb-2">Photos ({photos.length}/30, min 1)</p>
        <label className="block border-2 border-dashed border-[var(--border)] rounded-lg p-10 text-center cursor-pointer hover:bg-white">
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            disabled={busy}
            onChange={(e) => onFiles(e.target.files)}
          />
          <span className="text-sm text-[var(--muted)]">
            {busy ? 'Compressing…' : 'Click to upload (1–30 images)'}
          </span>
        </label>
        {photos.length > 0 && (
          <div className="mt-5 grid grid-cols-4 md:grid-cols-6 gap-3">
            {photos.map((p) => (
              <div key={p.photoId} className="relative group">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.previewUrl}
                  alt=""
                  className="w-full aspect-square object-cover rounded"
                />
                <button
                  type="button"
                  onClick={() => remove(p.photoId)}
                  className="absolute top-1 right-1 bg-black/60 text-white text-xs rounded-full w-6 h-6 opacity-0 group-hover:opacity-100"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {err && <p className="mt-6 text-sm text-red-600">{err}</p>}

      <div className="mt-10 flex gap-4">
        <button
          type="button"
          onClick={submit}
          disabled={busy || photos.length < 1 || !prompt.trim()}
          className="px-8 py-3 rounded-full bg-[var(--accent)] text-white text-sm tracking-wide disabled:opacity-40"
        >
          {busy ? 'Working…' : 'Generate my memoir'}
        </button>
      </div>
    </main>
  );
}
