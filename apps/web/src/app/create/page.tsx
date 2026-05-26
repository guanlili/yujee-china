'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { compressFile, type CompressedPhoto } from '@/lib/photo/compress';

export default function CreatePage() {
  const router = useRouter();
  const [photos, setPhotos] = useState<CompressedPhoto[]>([]);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onFiles = async (files: FileList | null) => {
    if (!files) return;
    setBusy(true);
    setErr(null);
    try {
      const next: CompressedPhoto[] = [];
      let i = photos.length;
      for (const f of Array.from(files)) {
        if (photos.length + next.length >= 30) break;
        i += 1;
        const photo = await compressFile(f, `p${i}`);
        next.push(photo);
      }
      setPhotos((prev) => [...prev, ...next]);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = (photoId: string) => setPhotos((prev) => prev.filter((p) => p.photoId !== photoId));

  const submit = async () => {
    if (photos.length < 3) {
      setErr('Need at least 3 photos.');
      return;
    }
    if (!prompt.trim()) {
      setErr('Tell us a short story prompt.');
      return;
    }
    setBusy(true);
    setErr(null);
    const requestId = crypto.randomUUID();
    try {
      const res = await fetch('/api/v1/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId,
          prompt: prompt.trim(),
          language: /[一-龥]/.test(prompt) ? 'zh' : 'en',
          photos: photos.map((p) => ({
            photoId: p.photoId,
            base64: p.base64,
            width: p.width,
            height: p.height,
          })),
        }),
      });
      const json = await res.json();
      if (!json.ok) {
        setErr(json.error?.message ?? 'Submit failed');
        setBusy(false);
        return;
      }
      try {
        sessionStorage.setItem(
          `photos:${json.data.albumId}`,
          JSON.stringify(photos),
        );
      } catch {}
      router.push(`/album/${json.data.albumId}?job=${json.data.requestId}`);
    } catch (e) {
      setErr(String(e));
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen max-w-3xl mx-auto px-6 py-16">
      <p className="uppercase tracking-[0.3em] text-xs text-[var(--color-fg-muted)] mb-4">Step 1</p>
      <h1 className="serif text-4xl mb-8">Start a memoir</h1>

      <label className="block">
        <span className="text-sm font-medium">Your story prompt</span>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          maxLength={500}
          rows={3}
          placeholder="e.g. A spring trip to Kyoto with my mother"
          className="mt-2 w-full p-4 rounded-lg border border-[var(--color-border)] bg-white text-base"
        />
        <span className="text-xs text-[var(--color-fg-muted)]">{prompt.length}/500</span>
      </label>

      <div className="mt-10">
        <p className="text-sm font-medium mb-2">Photos ({photos.length}/30, min 3)</p>
        <label className="block border-2 border-dashed border-[var(--color-border)] rounded-lg p-10 text-center cursor-pointer hover:bg-white">
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            disabled={busy}
            onChange={(e) => onFiles(e.target.files)}
          />
          <span className="text-sm text-[var(--color-fg-muted)]">
            {busy ? 'Compressing…' : 'Click to upload (3–30 images)'}
          </span>
        </label>
        {photos.length > 0 && (
          <div className="mt-5 grid grid-cols-4 md:grid-cols-6 gap-3">
            {photos.map((p) => (
              <div key={p.photoId} className="relative group">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.base64} alt={p.photoId} className="w-full aspect-square object-cover rounded" />
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
          disabled={busy || photos.length < 3 || !prompt.trim()}
          className="px-8 py-3 rounded-full bg-[var(--color-accent)] text-white text-sm tracking-wide disabled:opacity-40"
        >
          {busy ? 'Working…' : 'Generate my memoir'}
        </button>
      </div>
    </main>
  );
}
