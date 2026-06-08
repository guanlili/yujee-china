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
  landing: {
    metaTitle: string;
    metaDesc: string;
    // Hero (title split into three parts; the highlight gets the brand gradient)
    heroTitlePre: string;
    heroTitleHighlight: string;
    heroTitlePost: string;
    heroSub: string;
    composerPlaceholder: string;
    composerUploadLabel: string;
    composerHints: { label: string; fill: string }[];
    // How it works · three steps
    howTitle: string;
    howSteps: { num: string; title: string; desc: string }[];
    // What you get
    whatYouGetTitle: string;
    whatYouGetSub: string;
    whatYouGetPlaceholder: string;
    whatYouGetItems: { title: string; desc: string }[];
    // Demo video
    demoTitle: string;
    demoSub: string;
    demoPlaceholder: string;
    // Inspiration marquee (kept)
    casesTitle: string;
    casesMore: string;
    cases: { title: string; desc: string }[];
    // FAQ
    faqTitle: string;
    faq: { q: string; a: string }[];
    // End CTA
    ctaTitle: string;
    ctaSub: string;
    ctaButton: string;
    ctaNote: string;
  };
  privacy: {
    metaTitle: string;
    title: string;
    effective: string;
    sections: { h: string; body: string }[];
    contactLine: string;
  };
  terms: {
    metaTitle: string;
    title: string;
    effective: string;
    sections: { h: string; body: string }[];
    contactLine: string;
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
    heroTitlePre: 'Turn your scattered photos into a magazine you can ',
    heroTitleHighlight: 'read, touch, and keep',
    heroTitlePost: '',
    heroSub:
      'YUJEE AI turns your photos, stories, memories and ideas into a beautiful magazine, made just for you.',
    composerPlaceholder: 'Describe the magazine you want, e.g. “A photo album of my trip to Bali with friends”...',
    composerUploadLabel: 'Upload photos',
    composerHints: [
      { label: 'Travel Album', fill: 'Make me a photo album of my trip to Bali last week — I have lots of beach and temple photos.' },
      { label: 'Baby Milestones', fill: 'I want a growth journal for my daughter, with photos from birth to her first birthday.' },
      { label: 'Graduation', fill: 'A high school graduation yearbook with class photos and everyone’s farewell messages.' },
      { label: 'Food Journal', fill: 'Compile my restaurant photos from the past six months into a food magazine.' },
    ],
    howTitle: 'Three steps to your own magazine',
    howSteps: [
      { num: '01', title: 'Choose photos', desc: 'Pick the photos worth keeping — a few or a few hundred. Just drag them in.' },
      { num: '02', title: 'AI lays out, writes & tells the story', desc: 'It reads your photos, auto-chapters them, writes copy and builds magazine-grade spreads.' },
      { num: '03', title: 'You polish & adjust', desc: 'One sentence to AI rewrites copy, swaps photos or tweaks layout. Then export.' },
    ],
    whatYouGetTitle: 'Not just an album — a real magazine',
    whatYouGetSub: 'From cover to inside pages, every detail looks like a pro editor made it.',
    whatYouGetPlaceholder: 'Product preview · image coming',
    whatYouGetItems: [
      { title: 'Magazine-grade spreads', desc: 'Whitespace, image ratios and spread rhythm — refined and easy on the eye.' },
      { title: 'Copy with warmth', desc: 'Heartfelt titles and body text for every memory — not just stacked pictures.' },
      { title: 'Edit by chatting', desc: 'No tools to learn — just say it to swap photos, change text or layout.' },
      { title: 'Export & keep', desc: 'Crisp PDF or share link — print it as a real magazine anytime.' },
    ],
    demoTitle: 'See how Yujee turns photos into a magazine',
    demoSub: 'The whole flow in 90 seconds.',
    demoPlaceholder: 'Demo video · coming',
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
    faqTitle: 'FAQ',
    faq: [
      { q: 'How much is one magazine?', a: 'Pay per book: 1 book is $3, and it gets cheaper the more you buy — as low as $2.25 / book. No subscription, no monthly fee.' },
      { q: 'Do I keep it forever?', a: 'Yes. Pay once and it’s yours forever — reopen, export and download the magazine anytime.' },
      { q: 'Can I print a physical copy?', a: 'Yes. Export a high-resolution PDF and send it to a print shop or print it yourself as a real magazine.' },
      { q: 'Do the books I buy expire?', a: 'Never. The books you buy stay valid for good — make them whenever you like, nothing resets or expires.' },
    ],
    ctaTitle: 'Your magazine is waiting.',
    ctaSub: 'Start with a single photo. We’ll take it from there.',
    ctaButton: 'Make your first one free →',
    ctaNote: 'Free to start — see the finished magazine before you decide to buy.',
  },
  privacy: {
    metaTitle: 'Yujee — Privacy Policy',
    title: 'Privacy Policy',
    effective: 'Effective Date: May 27, 2026',
    sections: [
      {
        h: '1. Introduction',
        body: 'Yujee ("we") values your privacy. This Privacy Policy explains how we collect, use, disclose, and protect your information when you use yujeeai.com.',
      },
      {
        h: '2. Information We Collect',
        body: 'We collect: (a) account information (email, name) when you register; (b) usage data about how you interact with Yujee; (c) text and prompts you submit to generate memoirs; (d) the layout JSON and PDF metadata you produce. We do **not** store the original photos you upload — they stay in your browser and are sent only as compressed previews to our AI provider for layout planning.',
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
        body: 'You retain ownership of the photos and text you input. Subject to these Terms, we grant you a worldwide license to use, reproduce, and distribute the generated memoir output.',
      },
      {
        h: '6. Credits and Payments',
        body: 'Some features require credits. Credits are obtained via subscription or one-time top-up packs. Except as required by law, paid fees and credit packs are non-refundable. We may change prices and billing models at any time, with notice for active subscriptions.',
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
  footer: {
    tagline: 'Turn scattered photos into a magazine worth keeping.',
    productHead: 'Product',
    productItems: [
      { label: 'Create a memoir', href: '#homepage-composer' },
      { label: 'Pricing', href: '#pricing' },
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
    heroTitlePre: '你散落的照片，变成一本能',
    heroTitleHighlight: '阅读、触摸、收藏',
    heroTitlePost: '的杂志',
    heroSub: 'YUJEE AI 将你的照片、故事、记忆和想法，转化为一本专属于你的精美杂志。',
    composerPlaceholder: '描述你想做的杂志，比如「一本记录我和闺蜜大理旅行的影集」...',
    composerUploadLabel: '上传照片',
    composerHints: [
      { label: '旅行纪念册', fill: '帮我做一本记录上周去大理旅行的影集，我有很多洱海和古城的照片。' },
      { label: '宝宝成长记录', fill: '我想给女儿做一本成长记录，从出生到一岁的照片都有。' },
      { label: '毕业纪念', fill: '高中毕业纪念册，想放班级合照和每个人的毕业感言。' },
      { label: '美食手帐', fill: '记录我这半年探店的美食照片，做成一本美食杂志。' },
    ],
    howTitle: '三步，做出一本你的杂志',
    howSteps: [
      { num: '01', title: '选择照片', desc: '挑出想收藏的照片，几张到几百张都行，拖进来就好。' },
      { num: '02', title: 'AI 排版、写文案、编故事', desc: '读懂照片，自动分章、配文、做杂志级跨页排版，一气呵成。' },
      { num: '03', title: '你来润色调整', desc: '跟 AI 说一句话就能改文案、换图、调布局，满意了就导出。' },
    ],
    whatYouGetTitle: '不只是相册，是一本真正的杂志',
    whatYouGetSub: '从封面到内页，每一处细节都像专业编辑亲手做过。',
    whatYouGetPlaceholder: '产品界面预览 · 待补图',
    whatYouGetItems: [
      { title: '杂志级跨页排版', desc: '留白、图文比例、跨页节奏，专业又耐看。' },
      { title: '有温度的文案', desc: '为每段记忆写出贴心的标题与正文，而不是堆砌图片。' },
      { title: '对话式随手改', desc: '不用学任何工具，说句话就能换图、改字、调版式。' },
      { title: '导出即可收藏', desc: '高清 PDF 或分享链接，随时打印成实体杂志。' },
    ],
    demoTitle: '看 Yujee 如何把照片变成杂志',
    demoSub: '90 秒，看完整个流程。',
    demoPlaceholder: '演示视频 · 待补',
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
    faqTitle: '常见问题',
    faq: [
      { q: '做一本杂志多少钱？', a: '按本付费：1 本 $3，买得越多越便宜，最低 $2.25 / 本。没有订阅、没有月费。' },
      { q: '买了之后可以永久保存吗？', a: '可以。一次付费永久拥有，随时都能重新打开、导出、下载这本杂志。' },
      { q: '导出的杂志能打印成实体吗？', a: '可以。支持高清 PDF 导出，可直接送印刷厂或自助打印成一本实体杂志。' },
      { q: '买的本数会过期吗？', a: '不会。购买的本数长期有效，什么时候想做都可以，不清零、不过期。' },
    ],
    ctaTitle: '你的杂志，正在等你。',
    ctaSub: '从一张照片开始，剩下的交给我们。',
    ctaButton: '免费生成第一本 →',
    ctaNote: '免费开始 —— 先看到成品，再决定要不要买。',
  },
  privacy: {
    metaTitle: 'Yujee — 隐私政策',
    title: '隐私政策',
    effective: '生效日期：2026 年 5 月 27 日',
    sections: [
      {
        h: '1. 引言',
        body: 'Yujee（"我们"）重视您的隐私。本政策说明我们在您使用 yujeeai.com 时如何收集、使用、披露和保护您的信息。',
      },
      {
        h: '2. 我们收集的信息',
        body: '我们收集：（a）账户信息（邮箱、用户名）；（b）使用数据；（c）你提交的文字和提示词；（d）生成的排版 JSON 和 PDF 元数据。我们**不**保存你上传的原始照片 —— 原图始终留在你的浏览器，只把压缩后的预览作为特征送给 AI 服务用于排版规划。',
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
        body: '你保留对自己上传的照片和文字的所有权。在你遵守本条款的前提下，我们授予你对生成纪念册的全球范围使用、复制和分发权利。',
      },
      {
        h: '6. 积分与支付',
        body: '部分功能需要消耗积分。积分通过订阅或一次性购买获得。除法律另有规定外，已付费用和积分包不可退款。我们保留随时更改价格和计费方式的权利；变更会提前通知正在生效的订阅用户。',
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
  footer: {
    tagline: '把散落的照片，变成一本可以收藏的杂志。',
    productHead: '产品',
    productItems: [
      { label: '创建纪念册', href: '#homepage-composer' },
      { label: '定价', href: '#pricing' },
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
