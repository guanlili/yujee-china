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
