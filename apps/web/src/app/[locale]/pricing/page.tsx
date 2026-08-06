import { notFound, permanentRedirect } from 'next/navigation';
import { isLocale } from '@/lib/i18n/routing';

interface Props {
  params: Promise<{ locale: string }>;
}

// Pricing moved inline onto the Home pages (#pricing block). This route now just
// redirects to the home anchor so old links keep working. The move is permanent,
// so the redirect must say so (308) — a 307 leaves /pricing lingering in search
// indexes as a duplicate of the home page.
export default async function PricingPage({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  permanentRedirect(`/${locale}#pricing`);
}
