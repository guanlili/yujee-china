import type { InterviewCase } from '../interview';

export const fr: Record<InterviewCase, readonly [string, string, string]> = {
  timeAndPlace: [
    'J’ai regroupé ces photos pour vous.',
    'J’aimerais en savoir un peu plus : qui vous accompagnait ce jour-là ?',
    'Des personnes, des moments ou des émotions particulières à glisser dans ce livre ?',
  ],
  timeOnly: [
    'Ces photos dégagent quelque chose de très beau.',
    'Où ont-elles été prises, et avec qui étiez-vous ?',
    'Racontez-moi le souvenir ou l’ambiance que vous aimeriez garder.',
  ],
  placeOnly: [
    'J’ai parcouru ces photos.',
    'À peu près quand ont-elles été prises, et avec qui étiez-vous ?',
    'Une histoire ou une émotion que vous tenez particulièrement à garder ?',
  ],
  neither: [
    'J’aimerais comprendre ces photos un peu mieux.',
    'À peu près quand, où et avec qui ont-elles été prises ?',
    'Ce qui s’est passé, ce que vous avez ressenti — dites-moi ce que vous voulez.',
  ],
};
