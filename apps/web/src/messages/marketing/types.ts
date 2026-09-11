export interface MarketingMessages {
  nav: {
    brand: string;
    home: string;
    myProjects: string;
    howItWorks: string;
    examples: string;
    guides: string;
    pricing: string;
    about: string;
    menuToggle: string;
    login: string;
    getStarted: string;
    languageLabel: string;
  };
  // Only the keys the live landing actually consumes (page metadata + the
  // HeroComposer strings + InspirationMarquee copy). The rendered landing body
  // copy lives in YujeeLandingHomeClient — keep a single source, don't re-add
  // parallel copy here.
  landing: {
    metaTitle: string;
    metaDesc: string;
    composerUploadLabel: string;
    composerHints: { label: string; fill: string }[];
    casesTitle: string;
    casesMore: string;
    cases: { title: string; desc: string }[];
  };
  privacy: {
    metaTitle: string;
    metaDesc: string;
    title: string;
    effective: string;
    sections: { h: string; body: string }[];
    contactLine: string;
  };
  terms: {
    metaTitle: string;
    metaDesc: string;
    title: string;
    effective: string;
    sections: { h: string; body: string }[];
    contactLine: string;
  };
  // The founder story. Long-form prose, so unlike privacy/terms it carries
  // structure: an opening, per-section paragraphs, an optional pull quote, and
  // one bulleted list. Plain text only — the page renders these as text nodes,
  // so markdown emphasis would ship literally. Prose is deliberately duplicated
  // per locale rather than translated key-by-key: the Chinese is the original
  // voice and the English is a rewrite, not a translation.
  story: {
    metaTitle: string;
    metaDesc: string;
    title: string;
    lede: string[];
    sections: { h: string; paras: string[]; pull?: string; bullets?: string[] }[];
    closing: string;
    dateline: string;
    /** Byline under the title: author, date, reading time. */
    byline: { author: string; date: string; readingTime: string };
    tocHead: string;
    ctaLabel: string;
    disclaimer: string;
  };
  // An open list of groups rather than fixed product/about/legal keys, so a new
  // group is one entry here instead of a type change plus a JSX change.
  //
  // The heading a link sits under is the cheapest signal about what the page is:
  // a founder story filed under "Product" reads to a crawler as a feature page.
  // Anchor text carries the query too — "Our story" contains nothing anyone
  // searches for.
  //
  // Every href must resolve. Locale-relative paths get the /{locale} prefix;
  // `#anchor` targets a section on the landing page; `mailto:` is passed
  // through untouched. Deliberately absent: a reciprocal "friend links" block —
  // Google treats link exchanges at scale as a link scheme, and there is no real
  // partner to exchange with yet.
  // Chrome for the /examples hub + detail pages. The per-example CONTENT
  // (titles, prose, captions) lives in lib/examples/examples.ts, not here.
  examples: {
    metaTitle: string;
    metaDesc: string;
    kicker: string;
    hubTitle: string;
    hubIntro: string;
    moreComing: string;
    insideHead: string;
    madeWithHead: string;
    galleryHead: string;
    flipThrough: string;
    makeSame: string;
    breadcrumbHome: string;
    breadcrumbExamples: string;
    openLabel: string;
  };
  /**
   * The /guides CHROME only — headings, breadcrumbs, CTA. Article prose lives in
   * lib/guides/content/<locale>.ts, because articles are translated one at a
   * time while this chrome must exist in all five locales at once (the hub is a
   * five-locale route even when every article on it is English-only).
   */
  guides: {
    metaTitle: string;
    metaDesc: string;
    hubTitle: string;
    hubIntro: string;
    breadcrumbHome: string;
    breadcrumbGuides: string;
    readLabel: string;
    updatedLabel: string;
    /** Shown when the reader's locale has no translation of an article yet. */
    englishOnlyNote: string;
    faqHead: string;
    /** Heading over the sibling-article links at the foot of an article. */
    relatedHead: string;
    ctaHead: string;
    ctaBody: string;
    ctaButton: string;
  };
  /**
   * The standalone /pricing page.
   *
   * Deliberately NOT the home #pricing block's copy: that one sells three
   * cards, this one answers the questions a buyer asks before paying — how
   * many credits is MY book, what if the generation fails, is printing
   * included, can I have my money back. Every number is a {token} so the page
   * can only ever render what config/pricing.ts says.
   */
  pricingPage: {
    metaTitle: string;
    metaDesc: string;
    title: string;
    lede: string;
    freeLine: string;
    packsHead: string;
    packsCreditsLabel: string;
    packsPerPhoto: string;
    workedHead: string;
    worked: { h: string; body: string }[];
    capLine: string;
    includedHead: string;
    included: string[];
    notIncludedHead: string;
    notIncludedBody: string;
    notIncludedLink: string;
    failureHead: string;
    failureBody: string;
    refundHead: string;
    refundBody: string;
    noExpiryHead: string;
    noExpiryBody: string;
    faqHead: string;
    faq: { q: string; a: string }[];
    ctaHead: string;
    ctaBody: string;
    ctaButton: string;
    /** Secondary link to the home #pricing block, the only checkout surface. */
    buyLink: string;
  };
  footer: {
    tagline: string;
    groups: { head: string; items: { label: string; href: string }[] }[];
    copy: string;
  };
}
