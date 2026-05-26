import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 py-20 text-center">
      <p className="uppercase tracking-[0.3em] text-xs text-[var(--color-fg-muted)] mb-6">
        Yujee · 遇己
      </p>
      <h1 className="serif text-5xl md:text-6xl leading-tight max-w-3xl">
        Turn your photos into a printable memoir.
      </h1>
      <p className="mt-6 max-w-xl text-[var(--color-fg-muted)] text-lg leading-relaxed">
        Upload 3–30 photos and a few sentences. Our AI lays them out as a magazine-style album you
        can edit and export as a PDF.
      </p>

      <div className="mt-10 flex gap-4">
        <Link
          href="/create"
          className="px-7 py-3 rounded-full bg-[var(--color-accent)] text-white text-sm tracking-wide hover:opacity-90 transition"
        >
          Start a memoir
        </Link>
        <Link
          href="/my-albums"
          className="px-7 py-3 rounded-full border border-[var(--color-border)] text-sm tracking-wide hover:bg-white transition"
        >
          My albums
        </Link>
      </div>

      <p className="mt-16 text-xs text-[var(--color-fg-muted)]">
        Your originals never leave your browser. We only store the layout JSON.
      </p>
    </main>
  );
}
