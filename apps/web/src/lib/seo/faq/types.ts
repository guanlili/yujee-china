/**
 * The landing FAQ, as plain prose.
 *
 * SINGLE SOURCE OF TRUTH. The landing page renders these strings and the
 * FAQPage JSON-LD serialises them, so the structured data can never drift from
 * what a visitor actually reads — which is exactly what Google penalises.
 *
 * The last answer is rendered on the page with an inline link to the pricing
 * section; the link is presentation, so it lives in the component and the prose
 * here stays markup-free (JSON-LD answers must be text).
 */
export interface FaqEntry {
  q: string;
  a: string;
}
