import { permanentRedirect } from 'next/navigation';
import { defaultLocale } from '@/lib/i18n/routing';

export const dynamic = 'force-dynamic';

// Normally dead code — middleware 308s `/` before this renders. Kept as a
// fallback with the same permanent semantics so the two paths never disagree.
export default function HomePage() {
  permanentRedirect(`/${defaultLocale}`);
}
