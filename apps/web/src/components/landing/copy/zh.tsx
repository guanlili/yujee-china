import { buildFaq } from './faq';
import type { Copy } from './types';

export const zh: Copy = {
  sideHome: '主页',
  sideProjects: '我的项目',
  navExamples: '示例',
  navPricing: '定价',
  navFaq: '常见问题',
  footerStory: '创始故事',
  login: '登录',
  menu: '菜单',
  createTitle: '把散落的照片，做成一本能读、能摸、能留的照片书',
  createSub: '上传照片，YUJEE AI 自动分组、写文案，免费排版成一本杂志风格的照片书 —— 每一页都能改，可导出印刷级 PDF。',
  sampleCta: '查看示例',
  makeSame: '做同款',
  samplesNote: '以下样书均为遇己官方制作的演示作品（内容为虚构示例），非真实用户创作。',
  heroEyebrow: 'AI 相册创作 · 从照片到成册',
  heroTitle: (
    <>
      把随手一拍的照片，
      <br />
      整理成只属于你的回忆录
    </>
  ),
  heroSub: '你来讲故事，故事润色、排版、设计，通通交给 Yujee。',
  heroCta: '开始创作',
  heroExamples: '看看示例',
  trust: ['无需设计基础', '全程可编辑', '导出高清成品'],
  workflowTitle: '创作工作流',
  workflow: ['自动识图分组', 'AI 辅助内容撰写', '自动设计'],
  polish: '正在润色文字…',
  featuresLabel: '它能做什么',
  featuresTitle: (
    <>
      AI 照片书自动排版，
      <br />
      力气省下来给回忆
    </>
  ),
  features: [
    {
      title: '自动排版成照片书',
      body: '丢进一组照片，AI 按节奏排好跨页版式：大图、网格、留白，疏密有致，不用一张张拖。',
      icon: 'layout',
    },
    {
      title: '智能识图分组 + 配文',
      body: '识别时间与场景自动分组，为每一组生成可编辑的标题和描述。文字你来定调，初稿它先写好。',
      icon: 'spark',
    },
    {
      title: '翻书预览 · 印刷级 PDF 导出',
      body: '3D 翻书逐页预览，所见即所得。导出 300DPI 印刷级 PDF，随时打印装订成实体相册。',
      icon: 'book',
    },
  ],
  ctaTitle: '那些照片，别再躺在相册里了——做成一本纪念册',
  ctaSub: '几分钟，做出第一本。免费开始，满意了再导出打印。',
  start: '免费开始',
  faqLabel: '常见问题',
  faqTitle: '关于 AI 照片书，你想问的',
  faq: buildFaq('zh', '查看定价'),
  footerTagline: '把照片做成一本设计好的相册。',
  footerProduct: '产品',
  footerResources: '资源',
  footerExampleTravel: '旅行照片书示例',
  footerExampleLifeStory: '人生故事纪念册示例',
  footerExamplesAll: '全部作品示例',
  footerCompany: '关于',
  footerAccount: '账户',
  footerPrivacy: '隐私政策',
  footerTerms: '服务条款',
  signup: '免费注册',
  copyright: '© 2026 Yujee · 用排版，把回忆收好',
  samples: [
    {
      title: '年纪记录',
      brief: '一年一本，年底自动成册',
      body: '把一整年塞进一本。节日、出游、日常按月铺开，年底一键成册，年年续上一本。',
      bullets: ['按月 / 按事件自动归类', '年底一键生成年度册', '风格沿用，逐年成套'],
      image: '/landing-redesign/cards/03-year-record.png',
      video: '/landing-redesign/cards/03-year-record.mp4',
    },
    {
      title: '人生故事',
      brief: '把人生节点，排成一本传记',
      body: '按时间轴铺开重要节点：出生、求学、相遇、远行。每段配一篇可编辑短文，做成传记式相册。',
      bullets: ['按人生阶段自动分组', '每组可配长文与引言', '适合做生日 / 纪念礼物'],
      image: '/landing-redesign/cards/02-life-story.png',
      video: '/landing-redesign/cards/02-life-story.mp4',
    },
    {
      title: '旅行',
      brief: '一趟旅行，自动收成一本游记',
      body: '按日期自动分组，地点、天气、行程顺序都帮你理好。每一天一个跨页，照片之间留出呼吸。',
      bullets: ['按时间线自动分日分组', '可加地图页与路线标注', '导出 PDF，和旅伴一起翻看'],
      image: '/landing-redesign/cards/01-travel.png',
      video: '/landing-redesign/cards/01-travel.mp4',
    },
    {
      title: '作品集',
      brief: '让作品安静地排成一册',
      body: '摄影、插画、设计：网格对齐、统一留白，弱化装饰，让作品本身是主角。',
      bullets: ['严格网格与统一边距', '每页可附标题 / 媒介 / 年份', '导出可直接投递的 PDF 作品集'],
      image: '/landing-redesign/cards/06-portfolio.png',
      video: '/landing-redesign/cards/06-portfolio.mp4',
    },
    {
      title: '杂志',
      brief: '把内容排成一本杂志感的刊物',
      body: '不只是相册：封面、目录、专题、引言，按真正的杂志骨架排版，把生活做成一期刊物。',
      bullets: ['封面 / 目录 / 专题模板', '大标题 + 引言的编辑式排版', '导出印刷级，可做成实体刊'],
      image: '/landing-redesign/cards/05-magazine.png',
      video: '/landing-redesign/cards/05-magazine.mp4',
    },
    {
      title: '成长故事',
      brief: '一月一页，记下 TA 的变化',
      body: '按月份归档，自动生成成长时间线。身高体重、第一次的瞬间，都能落在对应的页上。',
      bullets: ['按月 / 按里程碑自动归组', '可加身高体重等小数据卡', '持续添加，相册随时间长大'],
      image: '/landing-redesign/cards/04-growth-story.png',
      video: '/landing-redesign/cards/04-growth-story.mp4',
    },
  ],
  previewChapters: [
    {
      title: '出发的清晨',
      left: '/landing-redesign/photos/bamboo-grove-path.jpg',
      right: '/landing-redesign/photos/riverside-walk.jpg',
    },
    {
      title: '夏天的海岸线',
      left: '/landing-redesign/photos/kamakura-coastal-street.jpg',
      right: '/landing-redesign/photos/seto-inland-sea-pier.jpg',
    },
    {
      title: '回程',
      left: '/landing-redesign/photos/rainy-kyoto-lane.jpg',
      right: '/landing-redesign/photos/riverside-before-fireworks.jpg',
    },
  ],
};
