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
    placeholder: pick(locale, {
      zh: '写点文案（可选）：想要的风格、主题、要避免的内容…',
      en: 'Add a note (optional): style, theme, things to avoid...',
    }),
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

  return (
    <YujeeLandingHomeClient
      locale={locale}
      composer={composer}
    />
  );
}
