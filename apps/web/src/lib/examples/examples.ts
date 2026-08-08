import { type Locale, localizePath } from '@/lib/i18n/routing';
import { absoluteUrl } from '@/lib/seo/site';

/**
 * The /examples showcase — one detail page per format Yujee can produce.
 *
 * SINGLE SOURCE OF TRUTH. The routes in the sitemap (see lib/seo/routes.ts), the
 * hub grid, every detail page, and the JSON-LD all derive from this array, so
 * they can never drift. Add a format here and it appears everywhere at once.
 *
 * These are illustrative SAMPLE outputs, not customer testimonials. Every string
 * describes what the product makes; nothing here claims a named person made it.
 * Inventing a customer story would be the same structured-data violation the
 * schema.ts header warns about — don't.
 *
 * Media: each `gallery` frame is a real, settled spread lifted from the product
 * showcase video (`video`). `cardImage` is the decorative brand illustration the
 * homepage already ships. Swap in richer per-format assets as they arrive.
 */

export interface ExampleContent {
  /** Page <h1> and card heading. Carries the head keyword. */
  title: string;
  /** One line under the title. Reused verbatim as the JSON-LD description, so it
   *  must read as an honest summary of the visible page. */
  tagline: string;
  metaTitle: string;
  metaDesc: string;
  /** Body prose, one entry per paragraph. */
  intro: string[];
  /** "What's inside" bullets. */
  inside: string[];
  /** Yujee features this format leans on. */
  madeWith: string[];
  /** Alt text per gallery image — same length/order as `gallery`. */
  galleryAlt: string[];
}

export interface Example {
  slug: string;
  /** Decorative brand illustration (homepage card face). */
  cardImage: string;
  /** Hover/flip-through product video. */
  video: string;
  /** Poster still for the video and the hub card face. */
  poster: string;
  /** Real, settled spreads pulled from the video. */
  gallery: string[];
  en: ExampleContent;
  zh: ExampleContent;
}

export const EXAMPLES: readonly Example[] = [
  {
    slug: 'travel-journal',
    cardImage: '/landing-redesign/cards/01-travel.png',
    video: '/landing-redesign/cards/01-travel.mp4',
    poster: '/examples/travel-journal/spread-01.jpg',
    gallery: [
      '/examples/travel-journal/spread-01.jpg',
      '/examples/travel-journal/spread-02.jpg',
      '/examples/travel-journal/spread-03.jpg',
      '/examples/travel-journal/spread-04.jpg',
    ],
    en: {
      title: 'Travel Journal',
      tagline: 'A trip laid out as a story of place and time.',
      metaTitle: 'Travel Photo Book Example — A Yujee AI Memoir',
      metaDesc:
        'See how Yujee turns a whole trip of scattered photos into a magazine-style travel photobook — grouped by place, captioned by AI, exported as a print-ready PDF.',
      intro: [
        'This is an example of a travel memoir made with Yujee. We took a single trip’s photos — landscapes, streets, portraits, and the quiet moments in between — and let the AI group them by place and time, draft the captions and chapter titles, and lay every spread out as a magazine you can hold. Nothing here was designed by hand.',
        'Use it as a reference for your own travel photobook. Whether it’s a week in Kyoto or a year of weekend escapes, the flow is the same: upload your photos, let Yujee sort and lay out a first draft, edit anything in chat, then export a 300 DPI PDF to print and bind.',
      ],
      inside: [
        'A cover and title page built from your strongest shot',
        'Chapters grouped by place and by day',
        'AI-drafted captions and short chapter text, all editable',
        'Full-bleed landscapes next to quiet detail shots',
      ],
      madeWith: [
        'AI photo grouping',
        'AI-written captions',
        'Magazine-style auto layout',
        'Chat-based editing',
        '300 DPI print-ready PDF',
      ],
      galleryAlt: [
        'Travel Journal cover page with a lakeside prayer-flag photo',
        'A two-page travel spread pairing a portrait with a mountain landscape',
        'A travel spread titled “The Quiet Between Moments” with a light-ray photo',
        'A travel spread of horses on a snowfield beside a portrait',
      ],
    },
    zh: {
      title: '旅行手记',
      tagline: '一趟旅行，按地点和时间排成一段故事。',
      metaTitle: '旅行照片书示例 —— Yujee AI 纪念册',
      metaDesc:
        '看 Yujee 如何把一整趟旅行散落的照片，做成杂志风格的旅行照片书：按地点分章、AI 配文、导出可印刷 PDF。',
      intro: [
        '这是一本用 Yujee 做的旅行纪念册示例。我们把一趟旅行的照片——风景、街道、人像，还有路上那些安静的瞬间——交给 AI 按地点和时间分组，起草配文和章节标题，再把每个跨页排成一本能拿在手里的杂志。这里没有一页是手动设计的。',
        '把它当成你自己旅行的参考。无论是京都的一周，还是一整年的周末出游，流程都一样：上传照片，让 Yujee 自动分组、排出初稿，用对话随手修改，最后导出 300DPI 的印刷级 PDF，拿去打印装订。',
      ],
      inside: [
        '封面和标题页取自你最出彩的一张',
        '按地点、按天分章',
        'AI 起草的配文和章节短文，都能改',
        '满版风景，搭配安静的细节特写',
      ],
      madeWith: [
        'AI 照片分组',
        'AI 自动配文',
        '杂志风格自动排版',
        '对话式编辑',
        '300DPI 印刷级 PDF',
      ],
      galleryAlt: [
        '旅行手记封面页，一张湖边经幡的照片',
        '一个旅行跨页，人像搭配雪山风景',
        '标题为「路上安静的瞬间」的旅行跨页，配一张光束照片',
        '雪原上马群搭配人像的旅行跨页',
      ],
    },
  },
  {
    slug: 'life-story',
    cardImage: '/landing-redesign/cards/02-life-story.png',
    video: '/landing-redesign/cards/02-life-story.mp4',
    poster: '/examples/life-story/spread-01.jpg',
    gallery: [
      '/examples/life-story/spread-01.jpg',
      '/examples/life-story/spread-02.jpg',
      '/examples/life-story/spread-03.jpg',
      '/examples/life-story/spread-04.jpg',
    ],
    en: {
      title: 'Life Story',
      tagline: 'A life told along a timeline — milestones and the ordinary days between.',
      // This page owns the memoir/biography demand. Deliberately NOT the bare
      // terms "best memoir" or "biography": those SERPs are book recommendations
      // and celebrity lookups (Goodreads, Wikipedia, IMDb) — reader and
      // reference intent, not "I want to make one". "memoir book" and
      // "biography book" are the make-intent forms of the same demand.
      metaTitle: 'Life Story & Biography Book Example — Yujee AI Memoir Maker',
      metaDesc:
        'A life-story memoir book made with Yujee: milestones and everyday moments along a timeline, laid out by AI. Make your own biography book and export a print PDF.',
      intro: [
        'This is an example of a life-story memoir book made with Yujee. It gathers the moments a life is actually made of — a table by the window, an afternoon at home, the small still-life corners we live around — and arranges them along a gentle timeline. The AI wrote a first draft of the chapter titles and captions; every word stays editable.',
        'It’s a format that keeps growing. Add a chapter each year, or digitize old photos and let Yujee thread them into one continuous story, then export a 300 DPI PDF to print and keep. It’s the simplest way to write your own biography without writing a word first — the AI drafts, you edit.',
      ],
      inside: [
        'A timeline that runs from the early days to now',
        'Chapters for milestones, homes, and everyday corners',
        'AI-drafted titles and captions you can rewrite',
        'Room to add a new chapter every year',
      ],
      madeWith: [
        'AI photo grouping',
        'AI-written chapter text',
        'Magazine-style auto layout',
        'Chat-based editing',
        '300 DPI print-ready PDF',
      ],
      galleryAlt: [
        'A life-story spread titled “Afternoon Table” with home interior photos',
        'A spread pairing “Afternoon Table” with a “Still Life” vase photo',
        'A “Decorative Corner / Still Life” spread with branches in a vase',
        'A “Decorative Corner / Personal Lounge” spread of a lived-in room',
      ],
    },
    zh: {
      title: '人生故事',
      tagline: '沿时间线讲述的一生——里程碑，和之间那些平常的日子。',
      metaTitle: '人生故事·个人传记纪念册示例 —— Yujee AI 纪念册',
      metaDesc:
        '一本用 Yujee 做的人生故事纪念册示例：把里程碑和日常瞬间沿时间线铺开，AI 排成收藏级杂志，导出可印刷 PDF。也可以照着给自己做一本个人传记。',
      intro: [
        '这是一本用 Yujee 做的人生故事纪念册示例。它收集的是一段人生真正由之构成的瞬间——窗边的一张桌子、在家的一个下午、我们日日相处的那些安静角落——沿着一条舒缓的时间线铺开。章节标题和配文都是 AI 起草的初稿，每个字都能改。',
        '这是一种会一直生长的形式：每年添一章，或者翻拍老照片，让 Yujee 把它们串成一段连续的故事，再导出 300DPI 的 PDF 打印保存。想给自己或家里长辈写一本传记，这是最省力的起点——AI 起草，你来改。',
      ],
      inside: [
        '一条从早年一路到当下的时间线',
        '为里程碑、家、日常角落分章',
        'AI 起草、你可重写的标题与配文',
        '每年都能再加一章的余地',
      ],
      madeWith: [
        'AI 照片分组',
        'AI 撰写章节文字',
        '杂志风格自动排版',
        '对话式编辑',
        '300DPI 印刷级 PDF',
      ],
      galleryAlt: [
        '标题为「午后餐桌」的人生故事跨页，配家居室内照片',
        '「午后餐桌」搭配「静物」花瓶照片的跨页',
        '「装饰角落 / 静物」跨页，花瓶里插着枝条',
        '「装饰角落 / 私人休憩」跨页，一间有生活气息的房间',
      ],
    },
  },
];

export const EXAMPLE_SLUGS: readonly string[] = EXAMPLES.map((e) => e.slug);

export function getExample(slug: string): Example | undefined {
  return EXAMPLES.find((e) => e.slug === slug);
}

export function exampleContent(example: Example, locale: Locale): ExampleContent {
  return locale === 'zh' ? example.zh : example.en;
}

/* ---------- JSON-LD builders (mirror the visible page) ---------- */

interface BreadcrumbItem {
  '@type': 'ListItem';
  position: number;
  name: string;
  item: string;
}

export interface BreadcrumbListSchema {
  '@context': 'https://schema.org';
  '@type': 'BreadcrumbList';
  itemListElement: BreadcrumbItem[];
}

function breadcrumb(trail: { name: string; route: string }[], locale: Locale): BreadcrumbListSchema {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((step, i) => ({
      '@type': 'ListItem' as const,
      position: i + 1,
      name: step.name,
      item: absoluteUrl(localizePath(step.route, locale)),
    })),
  };
}

/** Home → Examples. `examplesLabel` comes from the marketing messages. */
export function examplesHubBreadcrumb(locale: Locale, homeLabel: string, examplesLabel: string) {
  return breadcrumb(
    [
      { name: homeLabel, route: '/' },
      { name: examplesLabel, route: '/examples' },
    ],
    locale,
  );
}

/** Home → Examples → <title>. */
export function exampleBreadcrumb(
  example: Example,
  locale: Locale,
  homeLabel: string,
  examplesLabel: string,
) {
  return breadcrumb(
    [
      { name: homeLabel, route: '/' },
      { name: examplesLabel, route: '/examples' },
      { name: exampleContent(example, locale).title, route: `/examples/${example.slug}` },
    ],
    locale,
  );
}

export interface CreativeWorkSchema {
  '@context': 'https://schema.org';
  '@type': 'CreativeWork';
  name: string;
  description: string;
  url: string;
  image: string[];
  genre: string;
  inLanguage: Locale;
  creator: { '@type': 'Organization'; name: string; url: string };
  isPartOf: { '@type': 'CollectionPage'; name: string; url: string };
}

export function exampleCreativeWork(
  example: Example,
  locale: Locale,
  examplesLabel: string,
): CreativeWorkSchema {
  const c = exampleContent(example, locale);
  return {
    '@context': 'https://schema.org',
    '@type': 'CreativeWork',
    name: c.title,
    description: c.tagline,
    url: absoluteUrl(localizePath(`/examples/${example.slug}`, locale)),
    image: example.gallery.map((src) => absoluteUrl(src)),
    genre: 'Photo book',
    inLanguage: locale,
    creator: { '@type': 'Organization', name: 'Yujee', url: absoluteUrl(localizePath('/', locale)) },
    isPartOf: {
      '@type': 'CollectionPage',
      name: examplesLabel,
      url: absoluteUrl(localizePath('/examples', locale)),
    },
  };
}

export interface ItemListSchema {
  '@context': 'https://schema.org';
  '@type': 'ItemList';
  itemListElement: {
    '@type': 'ListItem';
    position: number;
    url: string;
    name: string;
  }[];
}

export function examplesItemList(locale: Locale): ItemListSchema {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: EXAMPLES.map((example, i) => ({
      '@type': 'ListItem' as const,
      position: i + 1,
      url: absoluteUrl(localizePath(`/examples/${example.slug}`, locale)),
      name: exampleContent(example, locale).title,
    })),
  };
}
