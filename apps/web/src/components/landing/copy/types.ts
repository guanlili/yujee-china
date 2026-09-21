import type { ReactNode } from 'react';

export type Sample = {
  /** The /examples page this card opens — must be a slug in lib/examples/examples.ts. */
  slug: string;
  title: string;
  brief: string;
  body: string;
  bullets: string[];
  image: string;
  video: string;
};

export type PreviewChapter = {
  title: string;
  left: string;
  right: string;
};

export type Copy = {
  sideHome: string;
  sideProjects: string;
  navExamples: string;
  navGuides: string;
  navPricing: string;
  navFaq: string;
  footerStory: string;
  login: string;
  menu: string;
  createTitle: string;
  createSub: string;
  sampleCta: string;
  makeSame: string;
  samplesNote: string;
  heroEyebrow: string;
  heroTitle: ReactNode;
  heroSub: string;
  heroCta: string;
  heroExamples: string;
  /** Heading over the six-book strip under the hero composer. */
  heroSamplesTitle: string;
  /** Link text to the /examples hub, used by the strip and the sample grid. */
  heroSamplesMore: string;
  trust: string[];
  workflowTitle: string;
  workflow: string[];
  polish: string;
  featuresLabel: string;
  featuresTitle: ReactNode;
  features: { title: string; body: string; icon: 'layout' | 'spark' | 'book' }[];
  ctaTitle: string;
  ctaSub: string;
  start: string;
  faqLabel: string;
  faqTitle: string;
  faq: { q: string; a: ReactNode }[];
  footerTagline: string;
  footerProduct: string;
  footerResources: string;
  footerExampleTravel: string;
  footerExampleLifeStory: string;
  footerExamplesAll: string;
  footerGuides: string;
  footerCompany: string;
  footerAccount: string;
  footerPrivacy: string;
  footerTerms: string;
  signup: string;
  copyright: string;
  samples: Sample[];
  previewChapters: PreviewChapter[];
};
