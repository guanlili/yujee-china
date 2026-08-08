import { buildFaq } from './faq';
import type { Copy } from './types';

export const ja: Copy = {
  sideHome: 'ホーム',
  sideProjects: 'マイプロジェクト',
  navExamples: '作例',
  navPricing: '料金',
  navFaq: 'よくある質問',
  footerStory: '創業ストーリー',
  login: 'ログイン',
  menu: 'メニュー',
  createTitle: 'ばらばらの写真を、読めて、手にとれて、ずっと残せるフォトブックに',
  createSub: '写真をアップロードすると、AI がグループ分けして文章を書き、雑誌のようなフォトブックに自動で組み上げます。無料ではじめられて、どのページも編集でき、そのまま印刷できます。',
  sampleCta: '作例を見る',
  makeSame: '同じように作る',
  samplesNote: 'こちらのサンプルは、Yujee チームが製品の機能をお見せするためにつくったデモです（内容はフィクションで、お客様の作品ではありません）。',
  heroEyebrow: 'AI フォトブック・思い出の本 · 撮った写真から、一冊の本へ',
  heroTitle: (
    <>
      何気ない日々のスナップを、
      <br />
      あなただけの思い出の本に
    </>
  ),
  heroSub: '写真も物語も思い出もアイデアも、YUJEE AI があなただけの美しい一冊に仕上げます。',
  heroCta: 'つくりはじめる',
  heroExamples: '作例を見る',
  trust: ['デザインの知識は不要', 'どのページも編集できる', '印刷用 PDF を書き出せる'],
  workflowTitle: '制作の流れ',
  workflow: ['写真を自動でグループ分け', 'AI が文章づくりをお手伝い', '雑誌のようなレイアウトを自動生成'],
  polish: '文章を整えています…',
  featuresLabel: 'できること',
  featuresTitle: (
    <>
      写真の仕分けまでやってくれる
      <br />
      AI フォトブックメーカー
    </>
  ),
  features: [
    {
      title: '自動でフォトブックに組版',
      body:
        '写真をまとめて入れるだけで、AI が雑誌のような見開きを自動で組みます。断ち落としの大判、グリッド、余白まで。デザイン作業のいらないフォトブックデザインで、写真を一枚ずつドラッグする必要はありません。',
      icon: 'layout',
    },
    {
      title: '写真の自動グループ分け + 文章の下書き',
      body:
        '撮影時刻とシーンを見分けて写真を自動でまとめ、それぞれに編集できるタイトルと説明を下書きします。トーンはあなたが決め、最初の一稿は AI が書きます。',
      icon: 'spark',
    },
    {
      title: 'めくって確認 · 印刷用 PDF 書き出し',
      body:
        '3D のページめくりで一枚ずつ確認できます。見たままが仕上がりです。デジタルのフォトブックとして残すのも、300 DPI の印刷用 PDF に書き出して、いつでも印刷・製本するのも自由です。',
      icon: 'book',
    },
  ],
  ctaTitle: '写真をフォルダに眠らせたままにせず、一冊の本にしましょう',
  ctaSub: '最初の一冊は数分でできます。まずは無料ではじめて、気に入ってから書き出しや印刷を考えてください。',
  start: '無料ではじめる',
  faqLabel: 'よくある質問',
  faqTitle: 'AI フォトブックのよくある質問',
  faq: buildFaq('ja', '料金を見る'),
  footerTagline: '写真を、きちんとデザインされたアルバムに。',
  footerProduct: '製品',
  footerResources: '資料',
  footerExampleTravel: '旅のフォトブックの作例',
  footerExampleLifeStory: '人生の物語の作例',
  footerExamplesAll: 'すべての作例',
  footerCompany: 'Yujee について',
  footerAccount: 'アカウント',
  footerPrivacy: 'プライバシー',
  footerTerms: '利用規約',
  signup: '無料で登録',
  copyright: '© 2026 Yujee · 思い出を、美しいレイアウトで',
  samples: [
    {
      title: '一年の記録',
      brief: '一年に一冊、12 月に製本',
      body:
        '一年まるごとを一冊に。祝日も、旅行も、何気ない一日も、月ごとに並べて、毎年つづけていけます。',
      bullets: ['月ごと・出来事ごとに自動でまとめ', '年末の一冊はワンクリック', '同じ体裁で、年ごとに揃うシリーズに'],
      image: '/landing-redesign/cards/03-year-record.png',
      video: '/landing-redesign/cards/03-year-record.mp4',
    },
    {
      title: '人生の物語',
      brief: '節目をつないで、一冊の人生の本に',
      body:
        '誕生、学び、出会い、旅。人生の節目を時間軸に沿って並べます。グループごとに編集できるエッセイがつき、伝記のように仕上がります。',
      bullets: ['人生の段階ごとに自動でグループ分け', 'グループごとに長文と引用を添えられる', '誕生日や記念日の贈り物にも'],
      image: '/landing-redesign/cards/02-life-story.png',
      video: '/landing-redesign/cards/02-life-story.mp4',
    },
    {
      title: '旅',
      brief: '一度の旅が、そのまま旅のフォトブックに',
      body:
        '日付ごとに自動でまとめ、場所も順序も整えます。一日ひと見開き、写真のあいだにはゆとりを残して。',
      bullets: ['時間軸に沿って日ごとに自動分割', '地図ページやルートのメモも追加できる', 'PDF に書き出して旅の仲間と共有'],
      image: '/landing-redesign/cards/01-travel.png',
      video: '/landing-redesign/cards/01-travel.mp4',
    },
    {
      title: 'ポートフォリオ',
      brief: '作品を、静かに並べる',
      body:
        '写真、イラスト、デザイン。グリッドに揃え、余白をそろえて、主役はあくまで作品のままに。',
      bullets: ['厳密なグリッドと統一された余白', 'ページごとにタイトル・技法・制作年', '提出できる PDF ポートフォリオを書き出し'],
      image: '/landing-redesign/cards/06-portfolio.png',
      video: '/landing-redesign/cards/06-portfolio.mp4',
    },
    {
      title: '雑誌',
      brief: '本物の雑誌のように誌面を組む',
      body:
        'アルバムの一歩先へ。表紙、目次、特集、引用まで、雑誌の骨組みで組みます。暮らしを一冊の号に。',
      bullets: ['表紙・目次・特集のテンプレート', '大見出しと引用を効かせた編集的レイアウト', '印刷用に書き出して実物の一冊に'],
      image: '/landing-redesign/cards/05-magazine.png',
      video: '/landing-redesign/cards/05-magazine.mp4',
    },
    {
      title: '成長の物語',
      brief: 'ひと月ひとページ、変わっていく姿を',
      body:
        '月ごとに整理して、成長の時間軸を自動でつくります。身長や体重、はじめての瞬間も、ぴったりのページに収まります。',
      bullets: ['月ごと・節目ごとに自動でグループ分け', '身長や体重の小さなデータカードも追加', '足していくほど、アルバムも育っていく'],
      image: '/landing-redesign/cards/04-growth-story.png',
      video: '/landing-redesign/cards/04-growth-story.mp4',
    },
  ],
  previewChapters: [
    {
      title: '出発の朝',
      left: '/landing-redesign/photos/bamboo-grove-path.jpg',
      right: '/landing-redesign/photos/riverside-walk.jpg',
    },
    {
      title: '夏の海岸線',
      left: '/landing-redesign/photos/kamakura-coastal-street.jpg',
      right: '/landing-redesign/photos/seto-inland-sea-pier.jpg',
    },
    {
      title: '帰り道',
      left: '/landing-redesign/photos/rainy-kyoto-lane.jpg',
      right: '/landing-redesign/photos/riverside-before-fireworks.jpg',
    },
  ],
};
