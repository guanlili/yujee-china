import type { ExampleContent } from './types';

export const en: Record<string, ExampleContent> = {
  'travel-journal': {
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
};
