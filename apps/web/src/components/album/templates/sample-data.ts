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
    title: 'VENUES',
    label: 'COLLECTED · 2026',
    explain1: 'Where the year began.',
    explain2: 'And where it stayed.',
    folio: '01',
  },
  'mag-02': {
    title: 'CONTENTS',
    'number[0]': '01',
    'title[0]': 'Beginnings',
    'description[0]': 'The first quiet mornings, where the whole story took shape.',
    'number[1]': '02',
    'title[1]': 'Everyday Light',
    'description[1]': 'Small ordinary moments — a kitchen, a window, an afternoon.',
    'number[2]': '03',
    'title[2]': 'Together',
    'description[2]': 'The faces and hands we held close through the year.',
    'number[3]': '04',
    'title[3]': 'Looking Back',
    'description[3]': 'A pause to gather what mattered before the last page.',
    folio: '02',
  },
  'mag-03': {
    image: SAMPLE_PORTRAIT,
    label: '京都 · 03 / 30',
    folio: '03',
  },
  'mag-04': {
    image1: SAMPLE_LANDSCAPE,
    image2: SAMPLE_PORTRAIT,
    image3: SAMPLE_SQUARE,
    explain1: 'Three frames from one slow afternoon.',
    explain2: 'The market, the light, and the long walk home before dusk.',
    date: '04/24',
    folio: '04',
  },
  'mag-05': {
    image: SAMPLE_LANDSCAPE,
    title: "LET'S GO RIDE\nA BIKE",
    label: 'Journey · 05',
    explain:
      'We rode along the river until the city thinned into fields and the afternoon turned gold.',
    folio: '05',
  },
  'mag-06': {
    image: SAMPLE_PORTRAIT,
    folio: '06',
  },
  'mag-07': {
    image1: SAMPLE_LANDSCAPE,
    image2: SAMPLE_PORTRAIT,
    explain1: 'The climb up to the shrine, gate after vermilion gate.',
    explain2: 'By the top the crowd had gone and it was only us.',
    title: 'FUSHI\nINARI',
    folio: '07',
  },
  'mag-08': {
    image: SAMPLE_PORTRAIT,
    date: '08/24',
    explain1: 'A face caught mid-laugh.',
    explain2:
      "We didn't plan the photo; it just happened, the way the best ones do — between one sentence and the next.",
    title: 'EVENT',
    folio: '08',
  },
  'mag-09': {
    image1: SAMPLE_LANDSCAPE,
    image2: SAMPLE_SQUARE,
    body: 'Memory is a kind of light.',
    explain1: 'Osaka at dusk.',
    title: 'OSAKA\nJAPAN',
    explain2: 'Neon on wet pavement.',
    explain3: 'The train ride home.',
    folio: '09',
  },
  'mag-10': {
    'image[0]': SAMPLE_SQUARE,
    'explain[0]': 'Low tide at dawn.',
    'image[1]': SAMPLE_SQUARE,
    'explain[1]': 'The fish market opens.',
    'image[2]': SAMPLE_SQUARE,
    'explain[2]': 'Coffee, then the ferry.',
    'image[3]': SAMPLE_SQUARE,
    'explain[3]': 'Last light on the bay.',
    folio: '10',
  },
  'mag-11': {
    image: SAMPLE_PORTRAIT,
    title: 'CHERRY\nBUCKET',
    label: 'Plate · 11 / 30',
    explain: 'Cherries by the door, the same as every spring.',
    folio: '11',
  },
  'mag-13': {
    image: SAMPLE_LANDSCAPE,
    title: 'YUICHI TOKUDA\nPHOTOGRAPHY',
    explain:
      'A year of small photographs — mornings, streets, the people who stayed. This is what it looked like.',
    folio: '13',
  },
  'mag-15': {
    image1: SAMPLE_PORTRAIT,
    image2: SAMPLE_LANDSCAPE,
    body: 'Happy Chofu — our quiet corner of the city.',
    title: 'HAPPY\nCHOFU',
    date: 'May 2026',
    folio: '15',
  },
  'mag-18': {
    image1: SAMPLE_PORTRAIT,
    image2: SAMPLE_PORTRAIT,
    explain1: 'The harbor side, late morning.',
    explain2: 'The hill town, by afternoon.',
    folio: '18',
  },
  'mag-19': {
    image: SAMPLE_SQUARE,
    title: 'Square',
    explain1: 'A square of ordinary light, kept because it felt like something.',
    explain2: 'Nothing happened here — which is exactly why we remember it.',
    folio: '19',
  },
  'mag-20': {
    image: SAMPLE_LANDSCAPE,
  },
  p01: {
    image: SAMPLE_PORTRAIT,
    title: '黄昏的港口\n以及之后',
    body: '一段关于光线与时间的短记:那年我们如何把寻常的日子,过成了一本书。',
    label1: 'nº 01 · Portrait',
    label2: '01',
    date: 'MAY 26',
  },
};
