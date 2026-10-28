import { SUPPORT_EMAIL } from '@/config/social';
import type { MarketingMessages } from './types';

export const en: MarketingMessages = {
  nav: {
    brand: 'Yujee',
    home: 'Home',
    myProjects: 'My Projects',
    howItWorks: 'How it works',
    examples: 'Examples',
    guides: 'Guides',
    pricing: 'Pricing',
    about: 'About',
    menuToggle: 'Toggle navigation menu',
    login: 'Log in',
    getStarted: 'Get started',
    languageLabel: 'English',
  },
  landing: {
    // "AI Photobook Generator" leads as of 2026-09: it is the generator-intent
    // term, and the one-word "photobook" spelling the earlier copy never
    // carried. "Free" and the two-word "photo book" both stay in the tail —
    // the free grant is real (FREE_PLAN_CREDITS covers a whole book), and
    // "photo book layout" is the winnable half of that demand (bare "free
    // photo book maker" is Shutterfly/Canva territory). Both spellings on one
    // title is the point, not an oversight.
    //
    // "Memoir" also stays, for the reason the pre-2026-09 comment gave: it is
    // the higher-intent term and the one this site can actually rank for. It
    // survived the rewrite only because the budget had room — no guard covers
    // it, so a future edit can still drop it silently.
    //
    // "AI travel photobook" is deliberately absent — it belongs to
    // /examples/travel-journal, and seo.test.ts fails if it shows up here.
    metaTitle: 'AI Photobook Generator — Free Photo Book & Memoir Maker | Yujee',
    metaDesc:
      'Turn your photos into a story-driven photobook. Free photo book layout with AI photo storytelling — it groups, captions, and lays out every page for you.',
    composerUploadLabel: 'Upload photos',
    composerHints: [
      { label: 'Travel Album', fill: 'Make me a photo album of my trip to Bali last week — I have lots of beach and temple photos.' },
      { label: 'Baby Milestones', fill: 'I want a growth journal for my daughter, with photos from birth to her first birthday.' },
      { label: 'Graduation', fill: 'A high school graduation yearbook with class photos and everyone’s farewell messages.' },
      { label: 'Food Journal', fill: 'Compile my restaurant photos from the past six months into a food magazine.' },
    ],
    casesTitle: 'Inspiration',
    casesMore: 'View more',
    cases: [
      { title: 'Graduation', desc: 'Turn four years of group photos, ticket stubs, and chats into a yearbook.' },
      { title: 'Wedding Memory', desc: 'Save vows, blessings, and every beautiful detail from the day you said yes.' },
      { title: 'Baby Milestones', desc: 'From birth to first birthday, capture every milestone in photos and words.' },
      { title: 'Travel Memoir', desc: 'Arrange scattered travel moments into a story with a timeline.' },
      { title: 'Girls Trip', desc: 'Turn sun, jokes, and weekend photos into a bright friendship issue.' },
      { title: 'Pet Diary', desc: 'Make a dedicated photo book for your furry friend, capturing daily life and funny moments.' },
      { title: 'Life Memories', desc: 'Digitize old photos and preserve family stories that deserve to last.' },
      { title: 'Food Notes', desc: 'Organize restaurant photos into a story-driven food guide.' },
      { title: 'Love Diary', desc: 'Collect quiet dates, small notes, and everyday romance in one keepsake.' },
    ],
  },
  privacy: {
    metaTitle: 'Yujee — Privacy Policy',
    metaDesc:
      'How Yujee handles your photos and personal data. Original photos are never uploaded — only compressed previews go to the AI for layout planning, and your albums stay private to you.',
    title: 'Privacy Policy',
    effective: 'Effective Date: May 27, 2026',
    sections: [
      {
        h: '1. Introduction',
        body: 'Yujee ("we") values your privacy. This Privacy Policy explains how we collect, use, disclose, and protect your information when you use outman.press.',
      },
      {
        h: '2. Information We Collect',
        body: 'We collect: (a) account information (email, name) when you register; (b) usage data about how you interact with Yujee; (c) text and prompts you submit to generate memoirs; (d) the memoirs you produce — layout data, exported PDF files, and cover thumbnails — stored on our cloud storage so you can reopen and download them anytime. We do not store the original photos you upload: they stay in your browser, and only compressed previews are sent to our AI provider for layout planning. Note that photos you place in a memoir are embedded in the PDF you export and save.',
      },
      {
        h: '3. How We Use Your Information',
        body: 'We use the information to provide and improve Yujee, to process payments and manage credits, to send service-related notifications, to monitor usage trends, and to detect or prevent fraud and abuse.',
      },
      {
        h: '4. Information Sharing',
        body: 'We do not sell your personal information. We share data only with service providers operating the product on our behalf (cloud hosting, payment processing, email delivery, AI inference) and when required by law.',
      },
      {
        h: '5. Data Security',
        body: 'We apply reasonable technical and organizational measures to protect your data. No internet transmission or electronic storage is 100% secure; we cannot guarantee absolute security.',
      },
      {
        h: '6. Your Rights',
        body: 'Depending on your jurisdiction, you may access, correct, delete, or restrict the processing of your personal data. Contact us to exercise these rights.',
      },
      {
        h: '7. Children’s Privacy',
        body: 'Yujee is not directed to children under 13 (or the equivalent age in your jurisdiction). If we learn we collected personal data from a child, we will delete it promptly.',
      },
      {
        h: '8. Changes to this Policy',
        body: 'We may update this Privacy Policy at any time. Material changes will be announced in-product or by email.',
      },
      {
        h: '9. Contact',
        body: '',
      },
    ],
    contactLine: 'Questions? Email privacy@yujeeai.com.',
  },
  terms: {
    metaTitle: 'Yujee — Terms of Service',
    metaDesc:
      'The terms you agree to when using Yujee to turn your photos into an AI-laid-out memoir: accounts, credits, exports, and the rights you keep over your own content.',
    title: 'Terms of Service',
    effective: 'Effective Date: August 8, 2026',
    sections: [
      {
        h: '1. Acceptance of Terms',
        body: 'By accessing or using Yujee (outman.press), you agree to be bound by these Terms of Service. If you do not agree, do not use the service.',
      },
      {
        h: '2. Description of Service',
        body: 'Yujee is an AI-powered memoir generator. You provide photos and prompts; we lay out a magazine-style memoir and let you export it as a PDF. We do not guarantee a specific creative outcome.',
      },
      {
        h: '3. User Accounts',
        body: 'You are responsible for the confidentiality of your account credentials and for all activity that happens under your account. You must provide accurate registration details.',
      },
      {
        h: '4. Acceptable Use',
        body: 'You agree not to use Yujee to generate content that is illegal, harmful, defamatory, obscene, or that infringes the rights of others; nor to disrupt the service, abuse rate limits, or attempt unauthorized access.',
      },
      {
        h: '5. Breach and Account Termination',
        body:
          'If you breach these Terms, in particular Section 4, or if we have reasonable grounds to believe your use of Yujee is unlawful, infringing, fraudulent, or harmful to other users or to the security of the service, we may take one or more of the following measures, depending on the severity of the breach:\n' +
          '• warn you and ask you to fix the problem within a stated period;\n' +
          '• restrict or disable specific features, such as generation, export, or sharing;\n' +
          '• remove or disable access to the content concerned and any share links to it;\n' +
          '• suspend your account;\n' +
          '• terminate your account and refuse further service.\n' +
          '\n' +
          'For serious breaches, for repeated breaches after a warning, or where the law or a competent authority requires it, we may suspend or terminate immediately without prior notice. Except where urgency or the law requires otherwise, we will make reasonable efforts to tell you the reason when we act or shortly afterwards. If you believe a decision was wrong, you may appeal to the contact address at the end of these Terms and we will review it again.\n' +
          '\n' +
          'If your account is terminated because you breached these Terms, unused credits are not refunded, and we are not liable for any loss arising from the termination. Nothing here limits our right to pursue other remedies available at law. You may stop using Yujee or ask us to delete your account at any time; after deletion your data is handled as described in the Privacy Policy. Sections 6, 8, 9, and 11, together with any provision that by its nature should survive, remain in effect after termination.',
      },
      {
        h: '6. Intellectual Property',
        body: 'You retain ownership of the photos and text you input. As between you and Yujee, the generated memoir output belongs to you — you may use, reproduce, and distribute it freely. We process your content solely to provide the service.',
      },
      {
        h: '7. Credits and Payments',
        body:
          'Generating a memoir consumes credits on a per-photo basis: one credit covers one photo. When you start a generation we place a hold on the corresponding credits; they are debited once the layout succeeds, and the hold is released with no charge if the generation fails. Credits are obtained through one-time credit packs — there is no subscription and no monthly fee, and credits currently have no expiry date. Current prices and pack sizes are those shown on the pricing page.\n' +
          '\n' +
          'Once credits have been debited for a successful layout they are not refundable, including where you are unhappy with the result. Except as required by law, fees paid and credit packs purchased are non-refundable. Where you purchased through a third-party payment provider, that provider’s own refund rules also apply, and nothing in this section affects consumer rights that the law of your country or region does not permit us to exclude.\n' +
          '\n' +
          'We may change prices, pack sizes, and billing models at any time. Changes take effect for new purchases when published and do not affect credits you have already purchased.',
      },
      {
        h: '8. Disclaimer',
        body: 'The service is provided "as is" and "as available", without warranties of any kind. We do not warrant that Yujee will be uninterrupted, secure, or error-free.',
      },
      {
        h: '9. Limitation of Liability',
        body: 'To the maximum extent permitted by law, Yujee shall not be liable for any indirect, incidental, special, consequential, or punitive damages — including lost profits, data loss, or loss of goodwill.',
      },
      {
        h: '10. Changes to Terms',
        body: 'We may modify these Terms at any time; the updated version takes effect on posting. Continued use after changes constitutes acceptance.',
      },
      {
        h: '11. Governing Law and Disputes',
        body:
          'These Terms — their formation, validity, and interpretation, and any dispute arising out of or relating to them — are governed by the laws of the People’s Republic of China (excluding the Hong Kong and Macao Special Administrative Regions and Taiwan).\n' +
          '\n' +
          'If a dispute arises, the parties will first try to resolve it through good-faith negotiation. If negotiation does not succeed, either party may bring proceedings before a court of competent jurisdiction at the place where the operator of Yujee is located.\n' +
          '\n' +
          'If the law of your country or region grants you consumer rights that cannot be excluded, this section does not affect those rights.',
      },
      {
        h: '12. Contact',
        body: '',
      },
    ],
    contactLine: 'Questions? Email support@yujeeai.com.',
  },
  story: {
    metaTitle: 'Our Story — Why I built Yujee',
    metaDesc:
      'I lived with depression for more than a decade, worked as an astrology counselor, then spent a year building an AI counselor. Here is what I learned, and why Yujee turns your life into a book instead.',
    title: 'After Getting Out of Depression, I Built a Tool Just for Myself',
    lede: [
      'My name is yvaine.',
      'I lived with depression for more than a decade. I have worked as a software product designer, then as an astrology counselor. Now I build Yujee.',
      'Yujee is a tool that helps you understand yourself, and turn that into a book.',
      'Here is why it exists.',
    ],
    sections: [
      {
        h: 'More than ten years in the dark',
        paras: [
          'I had severe depression and bipolar disorder.',
          'From primary school into adulthood, because of things at home, I was the withdrawn kid, the isolated one, the one with no confidence.',
          'The light only started coming in after I finished college.',
          'After graduation I moved into software product design, and for the first time I felt the pleasure of solving something with logic and design together. But one question stayed with me the whole time. What is a person actually living for.',
        ],
        pull: 'More than ten years without daylight. I stood at that edge more times than I can count.',
      },
      {
        h: 'Astrology gave me somewhere to stand',
        paras: [
          'I had done plenty of therapy and counseling. Almost none of it worked on me.',
          'Later I got into divination. I asked astrologers, BaZi readers, Zi Wei readers. Not one of them could answer that question.',
          'Curiosity pushed me to go learn astrology myself. I learned it while using it, and somewhere along the way I became an astrology counselor.',
          'The deeper I went, the more I understood where my own depression came from. I made peace with a childhood that was poor and miserable.',
          'I am not here to sell you astrology. What actually helped me was that it gave me somewhere to stand, an angle from which I could look at myself from the outside. The North Node is what that means to me.',
          'Later I used astrology and psychology together to help people around me, and it worked better than I expected. Give a person somewhere to stand, and they can move their own life.',
        ],
      },
      {
        h: 'The 13-year-old girl',
        paras: [
          'I met a 13-year-old girl. Her parents had worked far from home for years, she had been left behind with relatives, and she had stopped going to school.',
          'I wanted to help her. I grew up the same way.',
          'I did not take the case. Pulling someone out of that takes an enormous amount of time and energy. I was buried in work, I had my own bills, and I could not do it.',
          'That one stayed with me. Most kids like her cannot afford a counselor, and cannot bring themselves to open up to a real person anyway.',
        ],
      },
      {
        h: 'I built an AI counselor',
        paras: [
          'Those were the years ChatGPT and Claude arrived. I found that with careful tuning, an AI could work as a junior to intermediate astrology counselor, with both counseling and astrology skills. Everything I had learned in software design finally had somewhere to go.',
          'In 2024 I met CC, who was building AI tarot, through social media. In 2025 I joined the team and spent a full year tuning an AI into a counselor that was cheap enough, patient enough to stay for the long run, and free of personal bias.',
          'We shipped it.',
          'But after watching closely for a year how people and that AI counselor treated each other, I saw something else.',
          'A beautiful imagined future gives the brain its dopamine. But if nothing lands, if nothing moves forward, you end up carrying water in a basket. The emptiness after that hurts more than before.',
          'So it has to land somewhere.',
        ],
        pull: 'Counseling is not the answer, and it is not the destination. When someone stays lost long enough, counseling can turn into another drug. The kind you slowly get hooked on.',
      },
      {
        h: 'Why a book',
        paras: [
          'I went through a lot of research on psychological treatment. Art therapy and expressive writing have a clear effect on depression and on feeling lost. Writing and drawing with your hands pull you out of the loop your thoughts keep spinning in, and put you back into your body.',
          'In plain words, making things helps with pain, and it does real work for rebuilding a sense of self.',
          'Across all those consultations I saw something else. A lot of people stay with someone they do not like, doing work they do not like, lost and hurting for years, and underneath it they do not know who they actually are. What they want, what they cannot stand, what they are good at, what they value. None of it is clear to them.',
          'That kind of knowing does not arrive in a flash one afternoon. It takes rounds of shaping, finding, tearing down, and testing again.',
          'And when it comes to making something, I cannot think of anything more compelling than a book that belongs only to you.',
          'It makes your life visible. And years from now you open it and find that along the way there were so many moments that mattered. Good ones, ones you grew from, ones that hurt.',
          'What you actually lived through is the most valuable fruit on the tree of your life.',
        ],
      },
      {
        h: 'What Yujee is',
        paras: [
          'By 2026 I could not sit on it anymore.',
          'I wanted to build a product that was genuinely for the person using it. No retention games, no hooks. One job. Help someone know themselves, and keep it.',
          'That is where Yujee came from. In Chinese it means meeting yourself, and also steering yourself.',
          'The way it works is concrete. It turns your scattered photos and words into a book you can open. And in the act of choosing and arranging your own life, you see who you are again.',
          'What Yujee does today:',
        ],
        bullets: [
          'Sorts your photos automatically and groups the similar ones',
          'Lays out the book for you, no dragging things around',
          'Helps you write, turning fragments into a story that holds together',
          'Shares in one click, so the people who matter can read it',
        ],
      },
      {
        h: 'Built by one person',
        paras: [
          'I built Yujee on my own, learning and shipping at the same time. The systems architecture I picked up years ago doing system integration still holds up. Ask me again later.',
          'For two months I barely slept, and put out the first demo I considered usable. In July, 20 early users sent feedback, and I kept going.',
          'Doing the whole thing alone is not easy, and plenty about it is still rough. Some of that is me not being good enough. Some of it just has not come up the queue yet. But I wanted to get this one thing right, badly.',
          'What Yujee is today is still a very small version. It may not change anything for you right away. I still want to put this stubbornness into it.',
          `If something feels off while you use it, or there is something you wish it did, come tell me in the Discord. Email ${SUPPORT_EMAIL} or DM me on X works too. I read all of it.`,
        ],
      },
    ],
    closing: 'And I hope you get to hold on to your own tree of life, and find the self that sits deepest inside you.',
    dateline: 'yvaine, July 31, 2026',
    byline: { author: 'yvaine', date: 'July 31, 2026', readingTime: '8 min read' },
    tocHead: 'Contents',
    ctaLabel: 'Start your own book',
    disclaimer:
      'Yujee is not a medical product and is not a replacement for therapy. If you are in danger right now, please reach out to a doctor or a crisis line first.',
  },
  examples: {
    metaTitle: 'Photo Book & Memoir Examples — Made with Yujee AI',
    metaDesc:
      'Real formats you can make with Yujee: travel journals, life stories, and more — each one grouped, captioned, and laid out by AI from a pile of photos, then exported as a print-ready PDF.',
    kicker: 'Examples',
    hubTitle: 'Examples',
    hubIntro:
      'Real formats you can make with Yujee. Each one started as a pile of photos and a few words — the AI grouped them, drafted the captions, and laid out every spread. Open one to see the flow, then make your own.',
    moreComing: 'More formats — pets, weddings, and love stories — are on the way.',
    insideHead: 'What’s inside',
    madeWithHead: 'Made with',
    galleryHead: 'Inside the book',
    flipThrough: 'Flip through',
    makeSame: 'Make one like this',
    breadcrumbHome: 'Home',
    breadcrumbExamples: 'Examples',
    openLabel: 'See example',
  },
  guides: {
    metaTitle: 'Photo Book Guides — How to Make One | Yujee',
    metaDesc:
      'Practical guides to making a photo book or memoir: digitising old prints, choosing which photos belong, writing captions, and getting a print-ready file.',
    hubTitle: 'Guides',
    hubIntro:
      'How to get photos out of a box and into something worth keeping. Practical steps, written for people doing this for the first time.',
    breadcrumbHome: 'Home',
    breadcrumbGuides: 'Guides',
    readLabel: 'Read guide',
    updatedLabel: 'Updated',
    englishOnlyNote: 'This guide is only available in English for now.',
    faqHead: 'Common questions',
    relatedHead: 'Read next',
    ctaHead: 'Let Yujee do the layout',
    ctaBody:
      'Upload your photos, describe what was going on, and get a print-ready PDF with the pages designed and the captions drafted for you to correct.',
    ctaButton: 'Start for free',
  },
  pricingPage: {
    metaTitle: 'Pricing — What an AI Photo Book Costs | Yujee',
    metaDesc:
      'One credit is one photo. Buy credits once, no subscription, no expiry. See what a real book costs, what happens if a generation fails, and what printing adds.',
    title: 'What a photo book actually costs',
    lede:
      'One credit is {photos} photo. There is no subscription and nothing renews — you buy a pack of credits once and spend them when you make a book.',
    freeLine: 'You get {credits} credits free when you sign up. That is a whole first book.',
    packsHead: 'Credit packs',
    packsCreditsLabel: 'credits',
    packsPerPhoto: 'per photo',
    workedHead: 'What that means for a real book',
    worked: [
      {
        h: 'A weekend trip',
        body: 'Around 24 photos. Your free credits cover most of it, and the {packSmall} pack finishes it with credits to spare.',
      },
      {
        h: 'A year in review',
        body: 'Around 60 photos, one book for the whole year. The {packMid} pack covers it and leaves you enough for a second short book.',
      },
      {
        h: "A parent's life story",
        body: 'Around 90 photos spanning decades — close to the per-book limit. The {packLarge} pack covers it and still leaves more than half the credits unspent.',
      },
    ],
    capLine:
      'One book takes up to {max} photos. Past that, make it two volumes — it reads better anyway, and nothing is lost.',
    includedHead: 'What the credits buy',
    included: [
      'A 300 DPI print-ready PDF, no watermark, yours to keep',
      'Layout across 40+ magazine templates — you never drag a photo into a slot',
      'Captions and chapter text drafted from your photos and notes, then edited by chatting',
      'Your original photos never leave your browser; only compressed previews go to the AI',
    ],
    notIncludedHead: 'What they do not buy: printing',
    notIncludedBody:
      'You get a file, not a shipment. Printing is separate and you arrange it wherever you like — a standard hardcover runs roughly 20 to 70 US dollars depending on page count, paper and binding. We broke the whole thing down:',
    notIncludedLink: 'How much does a photo book cost to print?',
    failureHead: 'If a generation fails, you are not charged',
    failureBody:
      'Credits are held when a layout starts and debited only when it succeeds. If the generation fails, the hold is released and the credits go back to your balance.',
    refundHead: 'Refunds',
    refundBody:
      'Credit packs are a one-time purchase of a digital product and are non-refundable except where the law requires otherwise. Once credits have been spent on a book that came out, they are spent — including if you are unhappy with the result. If you paid through a payment provider, their own refund rules apply as well.',
    noExpiryHead: 'No subscription, no expiry',
    noExpiryBody:
      'Nothing renews and nothing is charged again. Credits sit in your account until you use them — they currently have no expiry date.',
    faqHead: 'Common questions',
    faq: [
      {
        q: 'Is there a free version?',
        a: 'Yes. Signing up gives you enough credits for a full first book, and you can export the print-ready PDF from it. There is no trial clock and no card required.',
      },
      {
        q: 'How many credits does one book take?',
        a: 'Exactly as many as it has photos: one credit covers {photos} photo. A 30-photo book costs 30 credits. The page count follows from the layout, so a small set usually lands somewhere around {pages} pages.',
      },
      {
        q: 'Do I pay again to re-export or edit?',
        a: 'No. Credits are charged once, when the layout succeeds. Editing the book by chat, re-exporting the PDF and re-downloading it cost nothing.',
      },
      {
        q: 'Can I print the PDF anywhere?',
        a: 'Yes. It is a standard 300 DPI print-ready PDF with no watermark and no lock-in — take it to any print shop or online printer, or keep it digital.',
      },
      {
        q: 'What happens to my credits if I stop using Yujee?',
        a: 'They stay on your account. Credits currently have no expiry date, and there is no subscription to cancel.',
      },
    ],
    ctaHead: 'Start with the free credits',
    ctaBody:
      'Upload a folder of photos and see a laid-out book before you decide whether to buy anything.',
    ctaButton: 'Make a book',
    buyLink: 'Buy credits',
  },
  footer: {
    tagline: 'Turn scattered photos into a magazine worth keeping.',
    groups: [
      {
        head: 'Product',
        items: [
          { label: 'Create a photo book', href: '#homepage-composer' },
          { label: 'How it works', href: '#features' },
          { label: 'What you get', href: '#outputs' },
          { label: 'Pricing', href: '/pricing' },
        ],
      },
      {
        head: 'Photo Books',
        items: [
          { label: 'AI travel photobook example', href: '/examples/travel-journal' },
          { label: 'Life story book example', href: '/examples/life-story' },
          { label: 'All memoir examples', href: '/examples' },
          { label: 'Photo book guides', href: '/guides' },
        ],
      },
      {
        head: 'Support',
        items: [
          { label: 'FAQ', href: '#faq' },
          { label: 'Contact us', href: `mailto:${SUPPORT_EMAIL}` },
        ],
      },
      {
        head: 'About',
        items: [{ label: 'Our story', href: '/about/story' }],
      },
      {
        head: 'Legal',
        items: [
          { label: 'Privacy', href: '/privacy' },
          { label: 'Terms', href: '/terms' },
        ],
      },
    ],
    copy: '© 2026 Yujee. All rights reserved.',
  },
};
