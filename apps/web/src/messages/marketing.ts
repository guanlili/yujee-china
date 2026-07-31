import type { Locale } from '@/lib/i18n/routing';

export interface MarketingMessages {
  nav: {
    brand: string;
    home: string;
    myProjects: string;
    howItWorks: string;
    pricing: string;
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
    ctaLabel: string;
    disclaimer: string;
  };
  footer: {
    tagline: string;
    productHead: string;
    productItems: { label: string; href: string }[];
    legalHead: string;
    legalItems: { label: string; href: string }[];
    copy: string;
  };
}

const en: MarketingMessages = {
  nav: {
    brand: 'Yujee',
    home: 'Home',
    myProjects: 'My Projects',
    howItWorks: 'How it works',
    pricing: 'Pricing',
    menuToggle: 'Toggle navigation menu',
    login: 'Log in',
    getStarted: 'Get started',
    languageLabel: 'English',
  },
  landing: {
    metaTitle: 'Yujee — Turn your photos into an AI-crafted memoir',
    metaDesc:
      'Yujee turns your scattered photos and stories into a magazine-style keepsake. AI lays it out, you edit in chat, export to PDF.',
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
        body: 'Yujee ("we") values your privacy. This Privacy Policy explains how we collect, use, disclose, and protect your information when you use yujeeai.com.',
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
    effective: 'Effective Date: May 27, 2026',
    sections: [
      {
        h: '1. Acceptance of Terms',
        body: 'By accessing or using Yujee (yujeeai.com), you agree to be bound by these Terms of Service. If you do not agree, do not use the service.',
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
        h: '5. Intellectual Property',
        body: 'You retain ownership of the photos and text you input. As between you and Yujee, the generated memoir output belongs to you — you may use, reproduce, and distribute it freely. We process your content solely to provide the service.',
      },
      {
        h: '6. Credits and Payments',
        body: 'Generating a memoir consumes credits. Credits are obtained through one-time credit packs — there is no subscription. Except as required by law, paid fees and credit packs are non-refundable. We may change prices and billing models at any time; changes do not affect credits you have already purchased.',
      },
      {
        h: '7. Disclaimer',
        body: 'The service is provided "as is" and "as available", without warranties of any kind. We do not warrant that Yujee will be uninterrupted, secure, or error-free.',
      },
      {
        h: '8. Limitation of Liability',
        body: 'To the maximum extent permitted by law, Yujee shall not be liable for any indirect, incidental, special, consequential, or punitive damages — including lost profits, data loss, or loss of goodwill.',
      },
      {
        h: '9. Changes to Terms',
        body: 'We may modify these Terms at any time; the updated version takes effect on posting. Continued use after changes constitutes acceptance.',
      },
      {
        h: '10. Contact',
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
          'Yujee was built entirely by me working with Claude Code, learning and shipping at the same time. The systems architecture I picked up years ago doing system integration still holds up. Ask me again later.',
          'For two months I barely slept, and put out the first demo I considered usable. In July, 20 early users sent feedback, and I kept going.',
          'Doing the whole thing alone is not easy. But I wanted to get this one thing right, badly.',
          'What Yujee is today is still a very small version. It may not change anything for you right away. I still want to put this stubbornness into it.',
        ],
      },
    ],
    closing: 'And I hope you get to hold on to your own tree of life, and find the self that sits deepest inside you.',
    dateline: 'yvaine, July 31, 2026',
    ctaLabel: 'Start your own book',
    disclaimer:
      'Yujee is not a medical product and is not a replacement for therapy. If you are in danger right now, please reach out to a doctor or a crisis line first.',
  },
  footer: {
    tagline: 'Turn scattered photos into a magazine worth keeping.',
    productHead: 'Product',
    productItems: [
      { label: 'Create a memoir', href: '#homepage-composer' },
      { label: 'Pricing', href: '#pricing' },
      { label: 'Our story', href: '/story' },
    ],
    legalHead: 'Legal',
    legalItems: [
      { label: 'Privacy', href: '/privacy' },
      { label: 'Terms', href: '/terms' },
    ],
    copy: '© 2026 Yujee. All rights reserved.',
  },
};

const zh: MarketingMessages = {
  nav: {
    brand: 'Yujee',
    home: '主页',
    myProjects: '我的项目',
    howItWorks: '玩法',
    pricing: '定价',
    menuToggle: '打开导航菜单',
    login: '登录',
    getStarted: '开始创作',
    languageLabel: '中文',
  },
  landing: {
    metaTitle: 'Yujee — 用 AI 把照片做成纪念册',
    metaDesc:
      'Yujee 把你散落的照片和故事，做成可以收藏的杂志风格纪念册。AI 自动排版，你用对话编辑，一键导出 PDF。',
    composerUploadLabel: '上传照片',
    composerHints: [
      { label: '旅行纪念册', fill: '帮我做一本记录上周去大理旅行的影集，我有很多洱海和古城的照片。' },
      { label: '宝宝成长记录', fill: '我想给女儿做一本成长记录，从出生到一岁的照片都有。' },
      { label: '毕业纪念', fill: '高中毕业纪念册，想放班级合照和每个人的毕业感言。' },
      { label: '美食手帐', fill: '记录我这半年探店的美食照片，做成一本美食杂志。' },
    ],
    casesTitle: '灵感库',
    casesMore: '查看更多',
    cases: [
      { title: '毕业纪念', desc: '把四年的合影、票根、聊天记录做成一本青春杂志。' },
      { title: '婚礼纪念', desc: '把誓言、祝福和每个动人的细节，整理成一册婚礼记忆。' },
      { title: '宝宝成长记录', desc: '从出生到周岁，用照片和文字记录每一个里程碑。' },
      { title: '旅行纪念册', desc: '把散落在相册里的旅途瞬间，编排成一本有时间线的旅行故事。' },
      { title: '闺蜜旅行', desc: '把阳光、玩笑和周末出游照片，做成一本明亮的友情特刊。' },
      { title: '宠物日记', desc: '给毛孩子做一本专属写真集，记录它的日常和表情包。' },
      { title: '人生回忆录', desc: '翻拍老照片，把家族故事和长辈记忆好好保存下来。' },
      { title: '美食手札', desc: '把探店照片整理成一本有故事的美食指南。' },
      { title: '爱情日记', desc: '收藏约会、手写小纸条和日常里的温柔瞬间。' },
    ],
  },
  privacy: {
    metaTitle: 'Yujee — 隐私政策',
    metaDesc:
      'Yujee 如何处理你的照片和个人数据：原图不会上传，只发送压缩预览给 AI 用于排版，相册只有你自己可见。',
    title: '隐私政策',
    effective: '生效日期：2026 年 5 月 27 日',
    sections: [
      {
        h: '1. 引言',
        body: 'Yujee（"我们"）重视您的隐私。本政策说明我们在您使用 yujeeai.com 时如何收集、使用、披露和保护您的信息。',
      },
      {
        h: '2. 我们收集的信息',
        body: '我们收集：（a）账户信息（邮箱、用户名）；（b）使用数据；（c）你提交的文字和提示词；（d）你生成的作品数据 —— 排版数据、导出的成品 PDF 和封面缩略图，存储在我们的云端，供你随时重新打开和下载。我们不保存你上传的原始照片：原图始终留在你的浏览器，只把压缩后的预览发送给 AI 服务用于排版规划。请注意，你放入册子的照片会包含在导出保存的 PDF 成品中。',
      },
      {
        h: '3. 我们如何使用这些信息',
        body: '用于提供和改进服务、处理支付与积分、发送服务相关通知、分析使用趋势、检测和防止欺诈与滥用。',
      },
      {
        h: '4. 信息共享',
        body: '我们不出售你的个人信息。仅与代我们运营服务的服务商共享必要数据（云托管、支付处理、邮件发送、AI 推理），以及在法律要求时披露。',
      },
      {
        h: '5. 数据安全',
        body: '我们采取合理的技术与组织措施来保护你的数据。但任何互联网传输或电子存储都不是 100% 安全的，我们无法保证绝对安全。',
      },
      {
        h: '6. 你的权利',
        body: '根据你所在司法管辖区的法律，你可能有权访问、更正、删除或限制处理你的个人数据。请联系我们行使这些权利。',
      },
      {
        h: '7. 儿童隐私',
        body: 'Yujee 不面向未满 13 岁（或你所在司法管辖区规定的其他年龄）的儿童。如发现误收儿童数据，我们将尽快删除。',
      },
      {
        h: '8. 政策变更',
        body: '我们可能不时更新本政策。重大变更将在产品内或通过邮件通知。',
      },
      {
        h: '9. 联系',
        body: '',
      },
    ],
    contactLine: '如有疑问，请发邮件至 privacy@yujeeai.com。',
  },
  terms: {
    metaTitle: 'Yujee — 服务条款',
    metaDesc:
      '使用 Yujee 把照片做成 AI 排版纪念册时你所同意的条款：账户、积分、导出，以及你对自己内容保留的权利。',
    title: '服务条款',
    effective: '生效日期：2026 年 5 月 27 日',
    sections: [
      {
        h: '1. 接受条款',
        body: '访问或使用 Yujee（yujeeai.com）即表示你同意受本服务条款约束。如不同意，请勿使用本服务。',
      },
      {
        h: '2. 服务描述',
        body: 'Yujee 是 AI 驱动的纪念册生成服务。你提供照片和文字，我们做杂志风格排版并支持导出 PDF。我们不保证特定的创作结果。',
      },
      {
        h: '3. 用户账户',
        body: '你需对账户凭据的保密性和账户下的所有活动负责。注册时须提供准确、完整的信息。',
      },
      {
        h: '4. 使用规范',
        body: '你同意不使用 Yujee 生成非法、有害、诽谤、淫秽或侵犯他人权利的内容；不干扰服务、滥用速率限制或试图未经授权访问。',
      },
      {
        h: '5. 知识产权',
        body: '你保留对自己上传的照片和文字的所有权。生成的纪念册成品归你所有，你可以自由使用、复制和分发；我们仅为提供服务而处理你的内容。',
      },
      {
        h: '6. 积分与支付',
        body: '生成纪念册会消耗积分。积分通过一次性积分包购买获得，无订阅、无月费。除法律另有规定外，已付费用和积分包不可退款。我们保留随时调整价格和计费方式的权利；调整不影响你已购买的积分。',
      },
      {
        h: '7. 免责声明',
        body: '服务按"现状"和"可用"基础提供，不附带任何明示或暗示保证。我们不保证服务不间断、安全或无错误。',
      },
      {
        h: '8. 责任限制',
        body: '在法律允许的最大范围内，Yujee 不对任何间接、附带、特殊、后果性或惩罚性损害承担责任 —— 包括但不限于利润损失、数据丢失或商誉受损。',
      },
      {
        h: '9. 条款变更',
        body: '我们可随时修改本条款，修改后的版本自发布起生效。变更后继续使用服务视为接受修改。',
      },
      {
        h: '10. 联系',
        body: '',
      },
    ],
    contactLine: '如有疑问，请发邮件至 support@yujeeai.com。',
  },
  story: {
    metaTitle: '创始故事 — 我为什么做 Yujee',
    metaDesc:
      '我曾被抑郁困住十几年，后来成了占星咨询师，又花一年把 AI 调教成咨询师。这是我看到的问题，以及 Yujee 为什么选择把人生做成一本书。',
    title: '从抑郁里爬出来之后，我做了一个只为自己的工具',
    lede: [
      '我叫 yvaine。',
      '做过十几年的抑郁症患者，做过软件产品设计师，做过占星咨询师，现在在做 Yujee。',
      'Yujee 是一个帮人认识自己、并且把自己做成一本书的工具。',
      '下面是它为什么存在。',
    ],
    sections: [
      {
        h: '十几年的黑暗',
        paras: [
          '我曾经有很严重的抑郁和双相情感障碍。',
          '从小学到成年，因为家庭的原因，我一直是那种自闭、孤僻、自卑的问题小孩。',
          '阳光是大学毕业以后才慢慢照进来的。',
          '毕业后我转行做了软件产品设计，第一次尝到用逻辑加设计去解决问题的乐趣。但那几年我始终想不明白一件事：人活着到底是为了什么。',
        ],
        pull: '十几年暗无天日，无数次走到过结束自己的那个路口。',
      },
      {
        h: '占星给了我一个支点',
        paras: [
          '心理咨询和治疗我做过不少，对我几乎没用。',
          '后来开始接触命理，占星、八字、紫微都问过，没有一个人能回答我那个问题。好奇心逼着我自己去学占星，边学边用，一不小心成了占星咨询师。',
          '在深入学的过程中，我慢慢搞明白了自己的抑郁从哪来，也跟那个又穷又惨的童年和解了。',
          '我不打算在这里推销占星。真正让我受益的是它给了我一个支点，一个能站在外面看自己的角度。北交点这类东西对我的意义就在这。',
          '后来我用占星加心理学的方法帮身边的人，效果比想象中好一些。有了支点，一个人是能撬动自己的生命的。',
        ],
      },
      {
        h: '那个 13 岁的女孩',
        paras: [
          '我遇到过一个 13 岁的女孩。父母常年在外，她被留在老家，不肯再去上学。',
          '我特别想帮她。我自己就是那样长大的。',
          '但我没有接下这个案子。把一个人从泥里拉出来要耗掉大量的时间和精力，那时候我工作太忙，生活也有压力，我做不到。',
          '这件事我记了很久。世界上像她一样的小孩，大部分请不起咨询师，也不好意思对着一个真人开口。',
        ],
      },
      {
        h: '我去做了一个 AI 咨询师',
        paras: [
          '那两年 ChatGPT 和 Claude 出现。我发现 AI 经过专业调教是可以做初中级占星咨询师的，同时具备心理咨询和占星的能力，而我在软件设计上积累的东西刚好能派上用场。',
          '2024 年我通过社交平台认识了做 AI 塔罗的 CC。2025 年我加入了他们的团队，花了整整一年，把 AI 调教成一个价格足够低、能长期陪伴、不带个人色彩的咨询师。',
          '它做出来了。',
          '但高强度地看了一年 AI 咨询师和用户怎么相处，我看到了另一件事。',
          '美好的想象会让大脑分泌多巴胺，可是没有落地，没有往前走，到头来还是竹篮打水。那种巨大的虚无反而更疼。',
          '所以必须落地。',
        ],
        pull: '咨询不是答案，也不是终点。如果一个人长期找不到自己，咨询可能只是另一味毒药，一味让人慢慢上瘾的毒药。',
      },
      {
        h: '为什么是做一本书',
        paras: [
          '我翻了很多心理治疗的资料。艺术疗法和表达性写作对抑郁、迷茫这类状态有明确作用：动手写、动手画，能把人从反复空转的念头里拽出来，重新落回身体和手上。',
          '说人话就是，表达和创造能缓解痛苦，而且对重新建立自我很有用。',
          '在海量的咨询里我还看到，很多人跟不喜欢的人待在一起，做不喜欢的工作，长期痛苦迷茫，根子上是不认识真实的自己。想要什么，讨厌什么，擅长什么，看重什么，都说不清楚。',
          '这种认识不会靠某天的灵光一闪出现。它需要打磨，发现，推翻，再验证，来回很多轮。',
          '而在表达创造这件事上，我想不出比做一本只属于自己的书更有吸引力的形式。',
          '它让你的人生变得可以被看见。也让若干年后的你翻开它，发现原来自己一路走来，有过那么多有意义的瞬间。美好的，成长的，或者痛苦的。',
          '这些亲身活过的东西，是生命这棵树上最贵的果实。',
        ],
      },
      {
        h: 'Yujee 是什么',
        paras: [
          '2026 年，那股躁动我按不住了。',
          '我要做一个真正为自己的产品。不看留存，不做钩子，只做一件事：让人认识自己，然后把它留下来。',
          'Yujee 由此诞生。在中文里它是遇见自己，也是驾驭自己。',
          '它的做法很具体：把你散落的照片和文字，变成一本能翻开的书。你在挑选和排列自己人生的过程里，会重新看见自己是谁。',
          '今天的 Yujee 能做的事：',
        ],
        bullets: [
          '自动整理照片，同类的会被归到一起',
          '自动排版成书，不用手动拖拽',
          '辅助写作，把零碎的片段连成完整的故事',
          '一键分享，把做好的书给重要的人',
        ],
      },
      {
        h: '一个人做的',
        paras: [
          'Yujee 是我全程用 Claude Code 做出来的，一边学一边干。早年做系统集成攒下的架构知识现在还够用，以后就不知道了。',
          '那两个月我基本没怎么睡，发出了第一个自己认为能用的 demo。7 月，20 个种子用户给了反馈，我接着改。',
          '一个人把全套做完不容易。但我实在太想太想，把找自己这件事做好。',
          '现在的 Yujee 还只是一个很小的版本。它未必立刻改变什么，我还是想把这份执着放进去。',
        ],
      },
    ],
    closing: '也祝你，能握住自己那棵生命树，找到心里最深的那个自己。',
    dateline: 'yvaine 2026.07.31',
    ctaLabel: '开始做自己的书',
    disclaimer:
      'Yujee 不是医疗产品，也不能替代心理治疗。如果你正处在危险的状态里，请先联系专业医生或者心理援助热线。',
  },
  footer: {
    tagline: '把散落的照片，变成一本可以收藏的杂志。',
    productHead: '产品',
    productItems: [
      { label: '创建纪念册', href: '#homepage-composer' },
      { label: '定价', href: '#pricing' },
      { label: '创始故事', href: '/story' },
    ],
    legalHead: '法律',
    legalItems: [
      { label: '隐私政策', href: '/privacy' },
      { label: '服务条款', href: '/terms' },
    ],
    copy: '© 2026 Yujee. 保留所有权利。',
  },
};

const dict: Record<Locale, MarketingMessages> = { en, zh };

export function getMarketingMessages(locale: Locale): MarketingMessages {
  return dict[locale];
}
