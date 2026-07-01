import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { YujeeLandingHome } from '@/components/landing/YujeeLandingHome';
import { isLocale, type Locale } from '@/lib/i18n/routing';
import { getMarketingMessages } from '@/messages/marketing';

interface Props {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ resumeGeneration?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const m = getMarketingMessages(locale);
  return { title: m.landing.metaTitle, description: m.landing.metaDesc };
}

export default async function LandingPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { resumeGeneration } = await searchParams;
  if (!isLocale(locale)) notFound();

  return (
    <YujeeLandingHome
      locale={locale as Locale}
      resumeGeneration={resumeGeneration === '1'}
    />
  );
}
