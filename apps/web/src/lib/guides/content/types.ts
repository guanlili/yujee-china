/**
 * One guide's prose, in one locale.
 *
 * Same shape as the story page's sections (h + paras rendered as text nodes),
 * so markdown and HTML in these strings would ship to the reader literally.
 * guides.test.ts asserts that.
 */
export interface GuideSection {
  h: string;
  paras: string[];
}

export interface GuideContent {
  /** The H1. Carries the target query in natural language. */
  title: string;
  /** Hub card summary. One or two sentences. */
  excerpt: string;
  /** ≤65 chars — past that Google truncates and the keyword never renders. */
  metaTitle: string;
  /** ≤165 chars, same reason. */
  metaDesc: string;
  /** Opening paragraph, above the first section heading. */
  lede: string;
  sections: GuideSection[];
  /**
   * Optional question-and-answer block, rendered visibly AND as FAQPage JSON-LD.
   *
   * This is the GEO lever. An AI engine quotes a passage, not a page, and the
   * passage it can quote most confidently is a question paired with a complete
   * answer — which is exactly what FAQPage states in a machine-readable form.
   * Articles written to be cited by ChatGPT / Perplexity / AI Overviews carry
   * one; a narrative how-to does not need it.
   *
   * Answers must be self-contained: they get read with no page around them.
   * They must also be VISIBLE on the page — FAQPage markup describing content a
   * human cannot see is a structured-data violation, so the two never diverge.
   */
  faq?: GuideFaqEntry[];
}

export interface GuideFaqEntry {
  /** Phrased the way someone actually asks it, ending in a question mark. */
  q: string;
  /** 2-4 sentences, complete on its own, plain prose. */
  a: string;
}
