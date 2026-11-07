import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { JsonLd } from '@/components/seo/JsonLd';
import { YujeeLandingHome } from '@/components/landing/YujeeLandingHome';
import { isLocale, locales, type Locale } from '@/lib/i18n/routing';
import { publicPageMetadata } from '@/lib/seo/metadata';
import { landingJsonLd } from '@/lib/seo/schema';
import { getMarketingMessages } from '@/messages/marketing';

interface Props {
  params: Promise<{ locale: string }>;
}

// 落地页是纯营销内容,按 locale 预生成即可。
// 这里**不要**读 searchParams:读过它整页就退回动态渲染(cache-control 变
// no-store、每次请求都要跑一遍 SSR)。resumeGeneration=1 只是登录回跳的
// 客户端提示,交给 HeroComposer 在浏览器里读 URL,页面本身保持静态。
export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const m = getMarketingMessages(locale);
  return publicPageMetadata('/', locale, m.landing.metaTitle, m.landing.metaDesc);
}

export default async function LandingPage({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return (
    <>
      <JsonLd data={landingJsonLd(locale)} />
      <YujeeLandingHome locale={locale as Locale} />
    </>
  );
}
