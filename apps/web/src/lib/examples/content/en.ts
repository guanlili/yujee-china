import type { ExampleContent } from './types';

/** Every format leans on the same five capabilities; the list is shared so a
 *  renamed feature changes once. */
const MADE_WITH = ['AI photo grouping', 'AI-written captions', 'Magazine-style auto layout', 'Chat-based editing', '300 DPI print-ready PDF'];

export const en: Record<string, ExampleContent> = {
  'travel-journal': {
    title: 'Travel Journal',
    tagline: 'An AI travel photobook — a trip laid out as a story of place and time.',
    metaTitle: 'AI Travel Photobook Example — A Yujee AI Memoir',
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
  'life-story': {
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
  // ---- Added 2026-09-21: the four remaining homepage formats ----------------
  // Each page owns ONE format keyword (pinned in lib/seo/seo.test.ts) so the
  // six example pages never compete with each other or with the landing.
  'year-in-review': {
    title: 'Year in Review',
    tagline: 'A year in review photo book — twelve months, laid out month by month.',
    metaTitle: 'Year in Review Photo Book Example — Made with Yujee AI',
    metaDesc:
      'A year in review photo book made with Yujee: trips and ordinary days grouped by month, captioned by AI, laid out like a magazine, exported as a print PDF.',
    intro: [
      'This is a sample year in review photo book made with Yujee. We took one year of photos — spring meadows, a lake in summer, evening skies, a few weekends away — and let the AI sort them by month, draft a caption and a short chapter note for each stretch, and lay every spread out as a magazine. Nothing on these pages was placed by hand.',
      'It is the format that keeps going: make one each December and the books line up as a set on the shelf. Upload the year’s photos, let Yujee group and lay out a first draft, fix anything in chat, then export a 300 DPI PDF to print and bind — or keep it digital and share the link.',
    ],
    inside: [
      'A cover built from the year’s strongest shot',
      'Chapters grouped by month or by event',
      'AI-drafted captions and chapter notes, all editable',
      'The same style every year, so the volumes match on the shelf',
    ],
    madeWith: MADE_WITH,
    galleryAlt: [
      'Year in Review cover with a lakeside meadow under a cloudy sky',
      'Opening spread of the year in review book with two sunset photos over a lake',
      'A spread titled “The Quiet Between Moments” with a lotus pond and a horse in a meadow',
      'A closing spread titled “What We Keep” with a woman standing in a mountain meadow',
    ],
  },
  'growth-story': {
    title: 'Growth Story',
    tagline: 'A baby milestone book that keeps growing — one page a month, every first.',
    metaTitle: 'Baby Milestone Book Example — A Growth Story Made with Yujee AI',
    metaDesc:
      'A baby milestone book made with Yujee: months and firsts on a growth timeline, captions drafted by AI, laid out as a keepsake and exported as a print-ready PDF.',
    intro: [
      'This is a sample growth story — a baby photo book made with Yujee. A family’s photos from one year (a tent by the lake, a first campfire, an afternoon in the garden, baking with the grandparents) were filed by month onto a growth timeline, with the AI drafting the captions and a short note for each stage. Every word is an editable first draft.',
      'The format is built to keep adding to. Drop in a new month’s photos and Yujee lays out the next page in the same style; small data cards — height, weight, first words — land on the right page. When a year is done, export a 300 DPI PDF and print a copy for each grandparent.',
    ],
    inside: [
      'A growth timeline grouped by month or milestone',
      'Room for little data cards: height, weight, firsts',
      'AI-drafted captions and stage notes, all editable',
      'Keep adding pages — the book grows with the child',
    ],
    madeWith: MADE_WITH,
    galleryAlt: [
      'Growing Up cover with a family pitching a tent by a lake',
      'Opening spread with a family walking in the woods and children beside a campfire lantern',
      'A spread titled “The Quiet Between Moments” with a child in the garden and grandparents at the table',
      'A closing spread titled “What We Keep” with a father and daughter watering plants and a family baking together',
    ],
  },
  'photo-magazine': {
    title: 'Photo Magazine',
    tagline: 'Your photos composed like a real editorial — cover, feature spreads and pull quotes.',
    metaTitle: 'Personal Photo Magazine Example — Make Your Own with Yujee AI',
    metaDesc:
      'A photo magazine made with Yujee: your photos composed into an editorial issue — cover, feature spreads and captions laid out by AI, exported as a print PDF.',
    intro: [
      'This is a sample photo magazine made with Yujee. A set of winter portraits — snow, city streets, a red cape at night — was composed onto a magazine skeleton: a cover, a contents-style opening spread, feature pages with headlines and pull quotes. The AI chose the sequence and drafted the text; nothing was placed by hand.',
      'It is the format for photos that deserve more than a grid. Upload a shoot, a season, or a year of a hobby, and Yujee lays it out like an issue you could put on a coffee table. Edit any headline in chat, then export a 300 DPI PDF and have it printed as a real magazine — or share the flip-through link.',
    ],
    inside: [
      'A cover and contents built from your strongest shots',
      'Feature spreads with headlines and pull quotes',
      'AI-drafted editorial text, all editable',
      'Print-ready pages for a physical issue',
    ],
    madeWith: MADE_WITH,
    galleryAlt: [
      'Magazine cover with a figure in a long coat on a snowy slope',
      'Opening editorial spread with two winter fashion portraits in the snow',
      'A spread titled “The Quiet Between Moments” pairing a blue coat in the snow with a city street portrait',
      'A closing spread titled “What We Keep” with a red cape and a night street portrait',
    ],
  },
  'portfolio-book': {
    title: 'Portfolio Book',
    tagline: 'Selected work on a strict grid — a PDF portfolio you can send or print.',
    metaTitle: 'Photography Portfolio Book Example — PDF Portfolio by Yujee AI',
    metaDesc:
      'A portfolio book made with Yujee: selected photographs on a strict grid with consistent margins and a title per page, exported as a PDF portfolio you can send.',
    intro: [
      'This is a sample portfolio book made with Yujee. A photographer’s selected work — a winter fashion series — was aligned to a strict grid with uniform margins, one title per page, so the work stays the star and the layout stays out of the way. The AI handled the sequence and the spacing; the pages were not designed by hand.',
      'It is the format for anyone who needs to send work: photographers, illustrators, designers. Upload the pieces, let Yujee lay them out, rename any title in chat, then export a submittable PDF portfolio — or a 300 DPI file for a printed book to hand over in person.',
    ],
    inside: [
      'A strict grid with uniform margins on every page',
      'Title, medium and year per piece',
      'A quiet cover and closing page',
      'A submittable PDF portfolio, or a print-ready file',
    ],
    madeWith: MADE_WITH,
    galleryAlt: [
      'Portfolio cover titled “My Folder” with a figure on a snowy slope',
      'Opening portfolio spread with two winter fashion photographs',
      'A portfolio spread pairing a blue-coat snow photo with a street portrait',
      'A closing portfolio spread with a red cape and a night city portrait',
    ],
  },
};
