import { notFound } from 'next/navigation';
import { isLocale, type Locale } from '@/lib/i18n/routing';
import { PricingView } from './PricingView';

interface Props {
  params: Promise<{ locale: string }>;
}

// Public per-book pricing page (#97): visible to anyone, including signed-out
// visitors. Only pressing "buy" requires login (handled in PricingView).
export default async function PricingPage({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <PricingView locale={locale as Locale} />;
}
