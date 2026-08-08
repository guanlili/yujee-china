import { buildFaq } from './faq';
import type { Copy } from './types';

export const en: Copy = {
  sideHome: 'Home',
  sideProjects: 'My projects',
  navExamples: 'Examples',
  navPricing: 'Pricing',
  navFaq: 'FAQ',
  footerStory: 'Our story',
  login: 'Log in',
  menu: 'Menu',
  createTitle: 'Turn your scattered photos into a photo book you can read, touch, and keep',
  createSub: 'Upload your photos and the AI groups them, writes the story, and automatically lays out a magazine-style photo book — free to start, fully editable, ready to print.',
  sampleCta: 'See example',
  makeSame: 'Make one like this',
  samplesNote: 'Demo books made by the Yujee team to show what the product can do — fictional content, not customer work.',
  heroEyebrow: 'AI photobooks & memoir books · from shots to bound book',
  heroTitle: (
    <>
      Turn your everyday snapshots
      <br />
      into a memoir that&apos;s yours alone
    </>
  ),
  heroSub: 'YUJEE AI turns your photos, stories, memories and ideas into a beautiful memory book made just for you.',
  heroCta: 'Start creating',
  heroExamples: 'See examples',
  trust: ['No design skills needed', 'Fully editable layout', 'Print-ready PDF export'],
  workflowTitle: 'How it works',
  workflow: ['Automatic photo grouping', 'AI-assisted story writing', 'Automatic magazine-style layout'],
  polish: 'Polishing the text…',
  featuresLabel: 'What it does',
  featuresTitle: (
    <>
      An AI photo book maker
      <br />
      that does the sorting for you
    </>
  ),
  features: [
    {
      title: 'Auto-layout into a photo book',
      body:
        'Drop in a set of photos and the AI automatically lays out magazine-style spreads — full bleeds, grids, white space. It is photobook design without the design work, and a finished photo book layout without dragging pictures one by one.',
      icon: 'layout',
    },
    {
      title: 'Smart photo grouping + captions',
      body:
        'It detects time and scenes to group your photos automatically, and drafts an editable title and description for each. You set the tone; it writes the first draft.',
      icon: 'spark',
    },
    {
      title: 'Flip-book preview · print-ready PDF export',
      body:
        'Flip through a 3D preview, page by page — what you see is what you get. Keep it as a digital photobook, or export a 300 DPI print-ready PDF you can print and bind anytime.',
      icon: 'book',
    },
  ],
  ctaTitle: "Don't leave those photos in a folder — make them a keepsake book",
  ctaSub: 'Make your first photo book in minutes. Start free; think about export and print once you love it.',
  start: 'Start free',
  faqLabel: 'FAQ',
  faqTitle: 'AI photo book questions, answered',
  faq: buildFaq('en', 'See pricing'),
  footerTagline: 'Turn your photos into a beautifully designed album.',
  footerProduct: 'Product',
  footerResources: 'Resources',
  footerExampleTravel: 'Travel photo book example',
  footerExampleLifeStory: 'Life story book example',
  footerExamplesAll: 'All memoir examples',
  footerCompany: 'About',
  footerAccount: 'Account',
  footerPrivacy: 'Privacy',
  footerTerms: 'Terms',
  signup: 'Sign up free',
  copyright: '© 2026 Yujee · Memories, beautifully laid out',
  samples: [
    {
      title: 'Year in a book',
      brief: 'One photo book a year, bound each December',
      body:
        'Pack a whole year into one book. Holidays, trips, and everyday moments are laid out by month and continued year after year.',
      bullets: ['Grouped by month or event', 'One click for the year-end book', 'Same style, a matching set each year'],
      image: '/landing-redesign/cards/03-year-record.png',
      video: '/landing-redesign/cards/03-year-record.mp4',
    },
    {
      title: 'Life story',
      brief: 'Your milestones, into a life story book',
      body:
        'Lay milestones along a timeline: birth, school, people, and journeys. Each group gets editable short essays, bound like a biography.',
      bullets: ['Auto-grouped by life stage', 'Long-form text and pull quotes per group', 'Great as a birthday or memorial gift'],
      image: '/landing-redesign/cards/02-life-story.png',
      video: '/landing-redesign/cards/02-life-story.mp4',
    },
    {
      title: 'Travel',
      brief: 'A trip, auto-bound into a travel photo book',
      body:
        'Auto-grouped by date, with places and order sorted for you. One spread per day, with room to breathe between photos.',
      bullets: ['Auto-split by timeline', 'Add map pages and route notes', 'Export a PDF to share with travel mates'],
      image: '/landing-redesign/cards/01-travel.png',
      video: '/landing-redesign/cards/01-travel.mp4',
    },
    {
      title: 'Portfolio',
      brief: 'Your work, lined up quietly',
      body:
        'Photography, illustration, design: aligned to a grid with consistent margins so the work stays the star.',
      bullets: ['Strict grid and uniform margins', 'Title, medium, and year per page', 'Export a submittable PDF portfolio'],
      image: '/landing-redesign/cards/06-portfolio.png',
      video: '/landing-redesign/cards/06-portfolio.mp4',
    },
    {
      title: 'Magazine',
      brief: 'Lay content out like a real magazine',
      body:
        'More than an album: cover, contents, features, and pull quotes on a magazine skeleton. Turn life into an issue.',
      bullets: ['Cover, contents, and feature templates', 'Editorial layout with headlines and quotes', 'Print-ready export for a physical issue'],
      image: '/landing-redesign/cards/05-magazine.png',
      video: '/landing-redesign/cards/05-magazine.mp4',
    },
    {
      title: 'Growth story',
      brief: 'A page a month, every change',
      body:
        'Filed by month into a growth timeline. Quick notes like height, weight, and firsts land on the right page.',
      bullets: ['Auto-grouped by month or milestone', 'Add little data cards', 'Keep adding; the album grows over time'],
      image: '/landing-redesign/cards/04-growth-story.png',
      video: '/landing-redesign/cards/04-growth-story.mp4',
    },
  ],
  previewChapters: [
    {
      title: 'Morning departure',
      left: '/landing-redesign/photos/bamboo-grove-path.jpg',
      right: '/landing-redesign/photos/riverside-walk.jpg',
    },
    {
      title: 'Summer Coastline',
      left: '/landing-redesign/photos/kamakura-coastal-street.jpg',
      right: '/landing-redesign/photos/seto-inland-sea-pier.jpg',
    },
    {
      title: 'The way back',
      left: '/landing-redesign/photos/rainy-kyoto-lane.jpg',
      right: '/landing-redesign/photos/riverside-before-fireworks.jpg',
    },
  ],
};
