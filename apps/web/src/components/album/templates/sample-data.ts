import type { TemplateData } from './types';

const SAMPLE_PORTRAIT =
  'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=600&h=800&fit=crop';
const SAMPLE_LANDSCAPE =
  'https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=900&h=600&fit=crop';
const SAMPLE_SQUARE =
  'https://images.unsplash.com/photo-1500964757637-c85e8a162699?w=600&h=600&fit=crop';

// Each template ships with its own base copy: the default text shown in the
// showcase preview and used as a fallback before the agent fills a page. Copy is
// kept within each slot's maxChars so the preview shows real layout behaviour,
// not false-positive overflow (the live pipeline clamps text to maxChars; only
// this preview renders these strings raw).
export const SAMPLE_DATA: Record<string, TemplateData> = {
  'mag-01': {
    image: SAMPLE_LANDSCAPE,
    heading: 'VENUES',
    sideText: 'COLLECTED · 2026',
    caption1: 'Where the year began.',
    caption2: 'And where it stayed.',
    folio: '01',
  },
  'mag-02': {
    heading: 'CONTENTS',
    'numbers[0]': '01',
    'titles[0]': 'Beginnings',
    'descriptions[0]': 'The first quiet mornings, where the whole story took shape.',
    'numbers[1]': '02',
    'titles[1]': 'Everyday Light',
    'descriptions[1]': 'Small ordinary moments — a kitchen, a window, an afternoon.',
    'numbers[2]': '03',
    'titles[2]': 'Together',
    'descriptions[2]': 'The faces and hands we held close through the year.',
    'numbers[3]': '04',
    'titles[3]': 'Looking Back',
    'descriptions[3]': 'A pause to gather what mattered before the last page.',
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
    caption1: 'Three frames from one slow afternoon.',
    caption2: 'The market, the light, and the long walk home before dusk.',
    dateNum: '04/24',
    folio: '04',
  },
  'mag-05': {
    image: SAMPLE_LANDSCAPE,
    title: "LET'S GO RIDE\nA BIKE",
    topRight: 'Journey · 05',
    caption:
      'We rode along the river until the city thinned into fields and the afternoon turned gold.',
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
    caption1: 'The climb up to the shrine, gate after vermilion gate.',
    caption2: 'By the top the crowd had gone and it was only us.',
    caption3: 'We stayed for the quiet.',
    title: 'FUSHI\nINARI',
    folio: '07',
  },
  'mag-08': {
    image: SAMPLE_PORTRAIT,
    dateNum: '08/24',
    caption1: 'A face caught mid-laugh.',
    caption2:
      "We didn't plan the photo; it just happened, the way the best ones do — between one sentence and the next.",
    title: 'EVENT',
    subtitle: 'Summer · Volume 01',
    folio: '08',
  },
  'mag-09': {
    imageTop: SAMPLE_LANDSCAPE,
    imageMain: SAMPLE_SQUARE,
    quote: 'Memory is a kind of light.',
    caption1: 'Osaka at dusk.',
    title: 'OSAKA\nJAPAN',
    caption2: 'Neon on wet pavement.',
    caption3: 'The train ride home.',
    folio: '09',
  },
  'mag-10': {
    cells: [
      { n: '09', image: SAMPLE_SQUARE, caption: 'Low tide at dawn.' },
      { n: '10', image: SAMPLE_SQUARE, caption: 'The fish market opens.' },
      { n: '11', image: SAMPLE_SQUARE, caption: 'Coffee, then the ferry.' },
      { n: '12', image: SAMPLE_SQUARE, caption: 'Last light on the bay.' },
    ],
    folio: '10',
  },
  'mag-11': {
    image: SAMPLE_PORTRAIT,
    title: 'CHERRY\nBUCKET',
    plate: 'Plate · 11 / 30',
    caption2: 'Cherries by the door, the same as every spring.',
    folio: '11',
  },
  'mag-13': {
    image: SAMPLE_LANDSCAPE,
    title: 'YUICHI TOKUDA\nPHOTOGRAPHY',
    caption:
      'A year of small photographs — mornings, streets, the people who stayed. This is what it looked like.',
    folio: '13',
  },
  'mag-15': {
    imagePerson: SAMPLE_PORTRAIT,
    imageRoad: SAMPLE_LANDSCAPE,
    body: 'Happy Chofu — our quiet corner of the city.',
    title: 'HAPPY\nCHOFU',
    date: 'May 2026',
    folio: '15',
  },
  'mag-18': {
    imageLeft: SAMPLE_PORTRAIT,
    imageRight: SAMPLE_PORTRAIT,
    numLeft: '19',
    numRight: '20',
    captionLeft: 'The harbor side, late morning.',
    captionRight: 'The hill town, by afternoon.',
    subtitle: 'Two cities, one afternoon.',
    folio: '18',
  },
  'mag-19': {
    image: SAMPLE_SQUARE,
    intro: 'Square',
    captionLeft: 'A square of ordinary light, kept because it felt like something.',
    captionRight: 'Nothing happened here — which is exactly why we remember it.',
    quote: 'Memory is a kind of light.',
    folio: '19',
  },
  'mag-20': {
    image1: SAMPLE_LANDSCAPE,
  },
  p01: {
    image: SAMPLE_PORTRAIT,
    title: '黄昏的港口\n以及之后',
    body: '一段关于光线与时间的短记:那年我们如何把寻常的日子,过成了一本书。',
    category: 'nº 01 · Portrait',
    vol: '01',
    date: 'MAY 26',
  },
};
