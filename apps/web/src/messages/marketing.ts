import { CREDIT_COST_PER_ALBUM } from '@/config/pricing';
import type { Locale } from '@/lib/i18n/routing';

export interface MarketingMessages {
  nav: {
    brand: string;
    pricing: string;
    login: string;
    getStarted: string;
    languageLabel: string;
  };
  landing: {
    metaTitle: string;
    metaDesc: string;
    heroTitle: string;
    heroSub: string;
    heroCta: string;
    heroTip: string;
    composerPlaceholder: string;
    composerUploadLabel: string;
    composerHints: { label: string; fill: string }[];
    featuresLabel: string;
    featuresTitle: string;
    featuresSub: string;
    features: { num: string; title: string; desc: string }[];
    casesTitle: string;
    casesMore: string;
    cases: { title: string; desc: string }[];
    ctaTitle: string;
    ctaSub: string;
    ctaButton: string;
  };
  pricing: {
    metaTitle: string;
    heading: string;
    sub: string;
    monthly: string;
    yearly: string;
    save: string;
    perMonth: string;
    free: string;
    creditsPerMonth: string;
    creditsOneTime: string;
    recommended: string;
    feat: Record<string, string>;
    plan: {
      free: { name: string; desc: string };
      pro: { name: string; desc: string };
      studio: { name: string; desc: string };
    };
    cta: { current: string; pro: string; studio: string };
    addonsTitle: string;
    addonsSub: string;
    addonsNote: string;
    addonCreditsLabel: string;
    addonBuy: string;
    faqTitle: string;
    faq: { q: string; a: string }[];
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
    pricing: 'Pricing',
    login: 'Log in',
    getStarted: 'Get started',
    languageLabel: 'English',
  },
  landing: {
    metaTitle: 'Yujee — Turn your photos into an AI-crafted memoir',
    metaDesc:
      'Yujee turns your scattered photos and stories into a magazine-style keepsake. AI lays it out, you edit in chat, export to PDF.',
    heroTitle: 'Write your story.',
    heroSub:
      'Yujee turns your scattered photos and memories into a magazine you’ll want to keep.',
    heroCta: 'Start your memoir',
    heroTip: 'Upload photos and let AI lay out a beautiful magazine.',
    composerPlaceholder: 'Describe the magazine you want, e.g. “A photo album of my trip to Bali with friends”...',
    composerUploadLabel: 'Upload photos',
    composerHints: [
      { label: 'Travel Album', fill: 'Make me a photo album of my trip to Bali last week — I have lots of beach and temple photos.' },
      { label: 'Baby Milestones', fill: 'I want a growth journal for my daughter, with photos from birth to her first birthday.' },
      { label: 'Graduation', fill: 'A high school graduation yearbook with class photos and everyone’s farewell messages.' },
      { label: 'Food Journal', fill: 'Compile my restaurant photos from the past six months into a food magazine.' },
    ],
    featuresLabel: 'How it works',
    featuresTitle: 'AI handles the busy work.',
    featuresSub: 'From chaptering to layout, all in one pass.',
    features: [
      { num: '01', title: 'Reads every photo', desc: 'AI recognizes scenes, faces, and mood — and understands the story behind each frame.' },
      { num: '02', title: 'Chapters automatically', desc: 'Groups photos by scene and theme. Each chapter gets a name worth keeping.' },
      { num: '03', title: 'Writes the story', desc: 'Warm, careful prose — like a letter you’d write to your future self.' },
      { num: '04', title: 'Edit by chatting', desc: 'Tell the AI what to change. The copy rewrites itself in seconds.' },
      { num: '05', title: 'WYSIWYG spread', desc: 'Live magazine preview. Text and photos compose as you go.' },
      { num: '06', title: 'Print-ready PDF', desc: 'One click. Hi-res PDF you can bind into a real book.' },
    ],
    casesTitle: 'Inspiration',
    casesMore: 'View more',
    cases: [
      { title: 'Travel Album', desc: 'Arrange scattered travel moments into a story with a timeline.' },
      { title: 'Baby Milestones', desc: 'From birth to first birthday, capture every milestone in photos and words.' },
      { title: 'Graduation', desc: 'Turn four years of group photos, ticket stubs, and chats into a yearbook.' },
      { title: 'Family Stories', desc: 'Digitize old photos and let AI write down your elders’ stories and family memories.' },
      { title: 'Pet Diary', desc: 'Make a dedicated photo book for your furry friend, capturing daily life and funny moments.' },
      { title: 'Food Journal', desc: 'Organize restaurant photos into a story-driven food guide.' },
    ],
    ctaTitle: 'Your story deserves a real book.',
    ctaSub: 'Free credits on signup. No card required.',
    ctaButton: 'Start your memoir',
  },
  pricing: {
    metaTitle: 'Yujee — Pricing',
    heading: 'Choose your plan',
    sub: 'Start free. Upgrade whenever your story grows.',
    monthly: 'Monthly',
    yearly: 'Yearly',
    save: 'Save 25%',
    perMonth: '/mo',
    free: 'Free',
    creditsPerMonth: 'credits / month',
    creditsOneTime: 'credits (one-time)',
    recommended: 'Most popular',
    feat: {
      'feat.unlimitedChat': 'Unlimited AI chats',
      'feat.unlimitedAi': 'Unlimited AI usage',
      'feat.standard720p': 'Standard quality 720P',
      'feat.hd1080p': 'HD quality 1080P',
      'feat.watermark': 'With watermark',
      'feat.noWatermark': 'No watermark',
      'feat.commercial': 'Commercial license',
      'feat.prioritySupport': 'Priority support',
      'feat.support3day': 'Support within 3 days',
      'feat.support1v1': 'Dedicated 1-on-1 support',
      'feat.earlyAccess': 'Early access to new features',
    },
    plan: {
      free: { name: 'Free', desc: 'For curious creators trying Yujee out.' },
      pro: { name: 'Pro', desc: 'For creators and small commercial projects.' },
      studio: { name: 'Studio', desc: 'For studios and scaling teams.' },
    },
    cta: { current: 'Current plan', pro: 'Get Pro', studio: 'Get Studio' },
    addonsTitle: 'Need more credits?',
    addonsSub: 'Top-up credit packs — buy once, use anytime.',
    addonsNote: 'Add-on credit packs are one-time purchases, valid for 12 months.',
    addonCreditsLabel: 'credits',
    addonBuy: 'Buy',
    faqTitle: 'Frequently asked questions',
    faq: [
      {
        q: 'Does the subscription auto-renew? Can I cancel?',
        a: 'Yes — subscriptions renew at the end of each billing cycle. You can cancel anytime in account settings and keep using your plan until the cycle ends.',
      },
      {
        q: 'Can I switch plans?',
        a: 'Upgrades take effect immediately and remaining credits are prorated. Downgrades take effect at the end of the current cycle.',
      },
      {
        q: 'What are credits? How are they used?',
        a: `Credits are Yujee’s generation currency. Different AI actions (vision, writing, layout, PDF) consume different amounts. Generating one full memoir costs ~${CREDIT_COST_PER_ALBUM} credits.`,
      },
      {
        q: 'Can I use the output commercially?',
        a: 'Pro and Studio include a worldwide commercial license. Free is for personal use only.',
      },
      {
        q: 'Who owns the generated content?',
        a: 'You do. Yujee does not claim any ownership over your input photos or generated memoir.',
      },
      {
        q: 'What are add-on credit packs?',
        a: 'One-time top-ups for when your monthly credits run out. Valid for 12 months from purchase.',
      },
      {
        q: 'Can I get a refund?',
        a: 'Subscription fees for the current cycle and one-time credit packs are non-refundable. Cancel renewal anytime to avoid future charges.',
      },
    ],
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
      { label: 'Pricing', href: '/pricing' },
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
    pricing: '定价',
    login: '登录',
    getStarted: '开始创作',
    languageLabel: '中文',
  },
  landing: {
    metaTitle: 'Yujee — 用 AI 把照片做成纪念册',
    metaDesc:
      'Yujee 把你散落的照片和故事，做成可以收藏的杂志风格纪念册。AI 自动排版，你用对话编辑，一键导出 PDF。',
    heroTitle: '写下你的故事。',
    heroSub: '把散落的照片和记忆，变成一本可以收藏的杂志。',
    heroCta: '开始创作',
    heroTip: '支持上传照片，AI 自动生成图文杂志。',
    composerPlaceholder: '描述你想做的杂志，比如「一本记录我和闺蜜大理旅行的影集」...',
    composerUploadLabel: '上传照片',
    composerHints: [
      { label: '旅行纪念册', fill: '帮我做一本记录上周去大理旅行的影集，我有很多洱海和古城的照片。' },
      { label: '宝宝成长记录', fill: '我想给女儿做一本成长记录，从出生到一岁的照片都有。' },
      { label: '毕业纪念', fill: '高中毕业纪念册，想放班级合照和每个人的毕业感言。' },
      { label: '美食手帐', fill: '记录我这半年探店的美食照片，做成一本美食杂志。' },
    ],
    featuresLabel: '工作流程',
    featuresTitle: 'AI 替你做完所有杂活。',
    featuresSub: '从分章节到排版，一气呵成。',
    features: [
      { num: '01', title: '看懂每张照片', desc: 'AI 识别场景、人物、氛围，理解每张照片背后的故事。' },
      { num: '02', title: '自动分章节', desc: '按场景与主题归类，每章一个有诗意的名字。' },
      { num: '03', title: '替你写故事', desc: '温柔细腻的叙事文字，像写给未来自己的一封信。' },
      { num: '04', title: '对话式编辑', desc: '一句话告诉 AI 想改什么，文案立刻重写。' },
      { num: '05', title: '所见即所得', desc: '跨页杂志预览，文字与照片实时排版。' },
      { num: '06', title: '导出印刷', desc: '一键导出高清 PDF，可直接打印装订成册。' },
    ],
    casesTitle: '灵感库',
    casesMore: '查看更多',
    cases: [
      { title: '旅行纪念册', desc: '把散落在相册里的旅途瞬间，编排成一本有时间线的旅行故事。' },
      { title: '宝宝成长记录', desc: '从出生到周岁，用照片和文字记录每一个里程碑。' },
      { title: '毕业纪念', desc: '把四年的合影、票根、聊天记录做成一本青春杂志。' },
      { title: '家庭故事', desc: '翻拍老照片，让 AI 帮你写下长辈的故事和家族记忆。' },
      { title: '宠物日记', desc: '给毛孩子做一本专属写真集，记录它的日常和表情包。' },
      { title: '美食手帐', desc: '把探店照片整理成一本有故事的美食指南。' },
    ],
    ctaTitle: '你的故事，值得一本真正的书。',
    ctaSub: '注册即赠免费积分，无需信用卡。',
    ctaButton: '开始创作',
  },
  pricing: {
    metaTitle: 'Yujee — 定价方案',
    heading: '选择适合你的方案',
    sub: '从免费开始，随时升级。',
    monthly: '月付',
    yearly: '年付',
    save: '省 25%',
    perMonth: '/月',
    free: '免费',
    creditsPerMonth: '积分 / 月',
    creditsOneTime: '积分（一次性）',
    recommended: '最受欢迎',
    feat: {
      'feat.unlimitedChat': 'AI 对话无限次',
      'feat.unlimitedAi': 'AI 无限使用',
      'feat.standard720p': '标准画质 720P',
      'feat.hd1080p': '高清画质 1080P',
      'feat.watermark': '含水印',
      'feat.noWatermark': '无水印',
      'feat.commercial': '商用授权',
      'feat.prioritySupport': '优先客服',
      'feat.support3day': '3 日内客服响应',
      'feat.support1v1': '1V1 专属客服',
      'feat.earlyAccess': '新功能优先体验',
    },
    plan: {
      free: { name: 'Free', desc: '刚开始探索的个人用户。' },
      pro: { name: 'Pro', desc: '个人创作者和小型商业项目。' },
      studio: { name: 'Studio', desc: '创意工作室和规模化团队。' },
    },
    cta: { current: '当前方案', pro: '开通 Pro', studio: '开通 Studio' },
    addonsTitle: '需要更多积分？',
    addonsSub: '购买附加积分包，随买随用。',
    addonsNote: '附加积分包为一次性购买，有效期 12 个月。',
    addonCreditsLabel: '积分',
    addonBuy: '购买',
    faqTitle: '常见问题',
    faq: [
      {
        q: '订阅会自动续费吗？如何取消？',
        a: '订阅会在每个周期结束时自动续费。你可以随时在账户设置中取消，取消后当前周期内仍可正常使用。',
      },
      {
        q: '可以更换套餐吗？',
        a: '升级即刻生效，剩余积分按比例折算。降级会在当前周期结束后生效。',
      },
      {
        q: '积分是什么？怎么消耗？',
        a: `积分是 Yujee 的核心生成单位。不同的 AI 操作（识图、写作、排版、导出）消耗不同数量的积分。生成一本完整纪念册约消耗 ${CREDIT_COST_PER_ALBUM} 积分。`,
      },
      {
        q: '可以商用吗？',
        a: 'Pro 和 Studio 包含全球商用授权，可自由用于商业用途。Free 仅限个人使用。',
      },
      {
        q: '生成的内容版权归谁？',
        a: '归你所有。Yujee 不对你的输入素材或生成结果主张任何所有权。',
      },
      {
        q: '附加积分包是什么？',
        a: '一次性购买的额外积分，自购买日起有效期 12 个月。当月度积分用完时，可以购买附加包来继续创作。',
      },
      {
        q: '可以退款吗？',
        a: '当前周期的订阅费和已购买的附加积分包不支持退款。你可以随时取消续费以避免后续扣费。',
      },
    ],
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
      { label: '定价', href: '/pricing' },
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
