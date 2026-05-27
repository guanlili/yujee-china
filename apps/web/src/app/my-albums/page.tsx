import Link from 'next/link';
import { albumService } from '@/services/album/album-service';
import { requireAuth } from '@/lib/auth/require-auth';

export const dynamic = 'force-dynamic';

export default async function MyAlbumsPage() {
  const user = await requireAuth(new Request('http://local/'));
  const albums = await albumService.listByUser(user.id);

  return (
    <main className="min-h-screen max-w-4xl mx-auto px-6 py-16">
      <h1 className="serif text-4xl mb-10">My albums</h1>
      {albums.length === 0 && (
        <div className="text-[var(--muted)]">
          <p>No albums yet.</p>
          <Link href="/create" className="underline">Start your first one</Link>
        </div>
      )}
      <ul className="space-y-4">
        {albums.map((a) => (
          <li key={a.id} className="border border-[var(--border)] rounded-lg p-5 bg-white">
            <Link href={`/album/${a.id}`} className="flex justify-between items-center">
              <div>
                <p className="serif text-2xl">{a.title}</p>
                <p className="text-xs text-[var(--muted)] mt-1">
                  {a.photoCount} photos · {a.pageCount} pages · {a.status}
                </p>
              </div>
              <span className="text-sm">→</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
