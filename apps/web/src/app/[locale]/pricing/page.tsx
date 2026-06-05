import { redirect } from 'next/navigation';
import { isLocale } from '@/lib/i18n/routing';

interface Props {
  params: Promise<{ locale: string }>;
}

// Per-book billing (#97) merged /pricing into /credits. Keep this route as a
// permanent redirect so old links and the marketing footer still resolve.
export default async function PricingRedirect({ params }: Props) {
  const { locale } = await params;
  redirect(`/${isLocale(locale) ? locale : 'en'}/credits`);
}
