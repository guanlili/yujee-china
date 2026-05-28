import type { TemplateData } from './types';

const SAMPLE_PORTRAIT =
  'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=600&h=800&fit=crop';
const SAMPLE_LANDSCAPE =
  'https://images.unsplash.com/photo-1505765050516-f72dcac9c60a?w=900&h=600&fit=crop';
const SAMPLE_SQUARE =
  'https://images.unsplash.com/photo-1500964757637-c85e8a162699?w=600&h=600&fit=crop';

const LOREM_CAPTION =
  'In the early morning light the harbor felt unchanged — a place returning to itself between tides, between travelers, between the small moments worth recording.';
const LOREM_BODY =
  '一段关于光线与时间的简短记录。我们坐在窗边,看着雨水画过玻璃,像在写一封不会寄出的信。';
const LOREM_PARAGRAPH =
  'A long-form paragraph that fills the column with text, showing how the design holds up under realistic copy length and varied punctuation marks.';

export const SAMPLE_DATA: Record<string, TemplateData> = {
  'mag-01': {
    image: SAMPLE_LANDSCAPE,
    heading: 'VENUES',
    sideText: 'COLLECTED · 2026',
    caption1: LOREM_CAPTION,
    caption2: LOREM_CAPTION,
    folio: '01',
  },
  'mag-02': {
    items: [
      { n: '01', title: 'OPENING', body: LOREM_CAPTION },
      { n: '02', title: 'JOURNEY', body: LOREM_CAPTION },
      { n: '03', title: 'PORTRAIT', body: LOREM_CAPTION },
      { n: '04', title: 'CLOSING', body: LOREM_CAPTION },
    ],
    folio: '02',
  },
  'mag-03': {
    image: SAMPLE_PORTRAIT,
    category: 'Portrait',
    location: '京都 · 03 / 30',
    caption: '一张人物肖像,光从右上方进入,温柔地停在面颊上。',
    folio: '03',
  },
  'mag-04': {
    image1: SAMPLE_LANDSCAPE,
    image2: SAMPLE_PORTRAIT,
    image3: SAMPLE_SQUARE,
    caption1: LOREM_CAPTION,
    caption2: LOREM_CAPTION,
    dateNum: '04/24',
    folio: '04',
  },
  'mag-05': {
    image: SAMPLE_LANDSCAPE,
    title: "LET'S GO RIDE\nA BIKE",
    topRight: 'Journey · 05',
    caption: LOREM_PARAGRAPH,
    folio: '05',
  },
  'mag-06': {
    image: SAMPLE_PORTRAIT,
    category: 'Landscape',
    folio: '06',
  },
  'mag-07': {
    imageTop: SAMPLE_LANDSCAPE,
    imageMain: SAMPLE_PORTRAIT,
    caption1: LOREM_CAPTION,
    caption2: LOREM_CAPTION,
    caption3: LOREM_CAPTION,
    title: 'FUSHI\nINARI',
    folio: '07',
  },
  'mag-08': {
    image: SAMPLE_PORTRAIT,
    dateNum: '08/24',
    caption1: LOREM_CAPTION,
    caption2: LOREM_CAPTION,
    title: 'EVENT',
    subtitle: 'Summer · Volume 01',
    folio: '08',
  },
  'mag-09': {
    imageTop: SAMPLE_LANDSCAPE,
    imageMain: SAMPLE_SQUARE,
    quote: 'Memory is a kind of light.',
    caption1: LOREM_CAPTION,
    title: 'OSAKA\nJAPAN',
    caption2: LOREM_CAPTION,
    caption3: LOREM_CAPTION,
    folio: '09',
  },
  'mag-10': {
    cells: [
      { n: '09', image: SAMPLE_SQUARE, caption: LOREM_CAPTION },
      { n: '10', image: SAMPLE_SQUARE, caption: LOREM_CAPTION },
      { n: '11', image: SAMPLE_SQUARE, caption: LOREM_CAPTION },
      { n: '12', image: SAMPLE_SQUARE, caption: LOREM_CAPTION },
    ],
    folio: '10',
  },
  'mag-11': {
    image: SAMPLE_PORTRAIT,
    title: 'CHERRY\nBUCKET',
    plate: 'Plate · 11 / 30',
    caption2: LOREM_CAPTION,
    folio: '11',
  },
  'mag-12': {
    imageTop: SAMPLE_SQUARE,
    imageBottom: SAMPLE_PORTRAIT,
    num1: '13',
    num2: '14',
    folio: '12',
  },
  'mag-13': {
    image: SAMPLE_LANDSCAPE,
    title: 'YUICHI TOKUDA\nPHOTOGRAPHY',
    intro: LOREM_CAPTION,
    caption1: LOREM_CAPTION,
    caption2: LOREM_CAPTION,
    issue: 'Issue · 13',
    credit: 'Photographs by Y.T.',
    folio: '13',
  },
  'mag-14': {
    bigNum: '11',
    bigNumTotal: '33',
    body: LOREM_CAPTION,
    subtitleQuote: 'A quiet field at dusk.',
    bracketQuote: LOREM_CAPTION,
    footnote: 'Footnote · captured between trains.',
    folio: '14',
  },
  'mag-15': {
    imagePerson: SAMPLE_PORTRAIT,
    imageRoad: SAMPLE_LANDSCAPE,
    body: LOREM_CAPTION,
    title: 'HAPPY\nCHOFU',
    date: 'May 2026',
    folio: '15',
  },
  'mag-16': {
    imageTiny: SAMPLE_PORTRAIT,
    imagePerson: SAMPLE_LANDSCAPE,
    imageHarbor: SAMPLE_LANDSCAPE,
    caption1: LOREM_CAPTION,
    caption2: LOREM_CAPTION,
    caption3: LOREM_CAPTION,
    quote: 'A quiet field at dusk.',
    folio: '16',
  },
  'mag-17': {
    image: SAMPLE_PORTRAIT,
    name1: 'HELENA CHANG',
    name2: 'KENJI OKABE',
    folio: '17',
  },
  'mag-18': {
    imageLeft: SAMPLE_PORTRAIT,
    imageRight: SAMPLE_PORTRAIT,
    numLeft: '19',
    numRight: '20',
    captionLeft: LOREM_CAPTION,
    captionRight: LOREM_CAPTION,
    subtitle: 'Two cities, one afternoon.',
    folio: '18',
  },
  'mag-19': {
    image: SAMPLE_LANDSCAPE,
    intro: LOREM_CAPTION,
    captionLeft: LOREM_CAPTION,
    captionRight: LOREM_CAPTION,
    quote: 'Memory is a kind of light.',
    folio: '19',
  },
  'mag-20': {
    boxText: LOREM_CAPTION,
    title: 'MASASHI WAKUI\nAT NIGHT',
    plate: 'Portfolio · 20 / 30',
    folio: '20',
  },
  p01: {
    image: SAMPLE_PORTRAIT,
    title: '黄昏的港口\n以及之后',
    body: LOREM_BODY,
    category: 'nº 01 · Portrait',
    vol: '01',
    date: 'MAY 26',
  },
};
