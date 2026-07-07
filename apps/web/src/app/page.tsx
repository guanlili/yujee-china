import { redirect } from 'next/navigation';
import { defaultLocale } from '@/lib/i18n/routing';

export const dynamic = 'force-dynamic';

export default function HomePage() {
  redirect(`/${defaultLocale}`);
}
