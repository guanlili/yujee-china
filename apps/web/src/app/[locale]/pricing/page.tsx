import { notFound, redirect } from 'next/navigation';
import { isLocale } from '@/lib/i18n/routing';

interface Props {
  params: Promise<{ locale: string }>;
}

// Pricing moved inline onto the Home pages (#pricing block). This route now just
// redirects to the home anchor so old links keep working.
export default async function PricingPage({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  redirect(`/${locale}#pricing`);
}
