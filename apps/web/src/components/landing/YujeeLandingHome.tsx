import { EXAMPLES, exampleContent } from '@/lib/examples/examples';
import { getMessages } from '@/lib/i18n/messages';
import { pick } from '@/lib/i18n/pick';
import type { Locale } from '@/lib/i18n/routing';
import { getMarketingMessages } from '@/messages/marketing';
import { HeroComposer } from './HeroComposer';
import { YujeeLandingHomeClient } from './YujeeLandingHomeClient';

type Props = {
  locale: Locale;
  resumeGeneration?: boolean;
};

export function YujeeLandingHome({ locale, resumeGeneration = false }: Props) {
  const marketing = getMarketingMessages(locale);
  const createMessages = getMessages(locale).dashboard.create;
  const composerCopy = {
    placeholder: '',
    submit: pick(locale, { zh: '提交', en: 'Submit' }),
  };

  const composer = (
    <HeroComposer
      locale={locale}
      placeholder={composerCopy.placeholder}
      uploadLabel={marketing.landing.composerUploadLabel}
      hints={marketing.landing.composerHints}
      createMessages={createMessages}
      resumeGeneration={resumeGeneration}
      variant="redesign"
      submitLabel={composerCopy.submit}
    />
  );

  // The six-book strip under the composer. Built here, not in the client, so
  // the browser bundle carries six titles instead of five locales of prose.
  const heroSamples = EXAMPLES.map((example) => ({
    slug: example.slug,
    href: `/${locale}/examples/${example.slug}`,
    poster: example.poster,
    title: exampleContent(example, locale).title,
  }));

  return (
    <YujeeLandingHomeClient
      locale={locale}
      composer={composer}
      heroSamples={heroSamples}
    />
  );
}
