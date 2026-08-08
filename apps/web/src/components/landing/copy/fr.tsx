import { buildFaq } from './faq';
import type { Copy } from './types';

export const fr: Copy = {
  sideHome: 'Accueil',
  sideProjects: 'Mes projets',
  navExamples: 'Exemples',
  navPricing: 'Tarifs',
  navFaq: 'FAQ',
  footerStory: 'Notre histoire',
  login: 'Se connecter',
  menu: 'Menu',
  createTitle: 'Vos photos éparpillées deviennent un livre photo à lire, à toucher, à garder',
  createSub: 'Importez vos photos : l’IA les regroupe, écrit le récit et met automatiquement en page un livre photo façon magazine — gratuit pour commencer, entièrement modifiable, prêt à imprimer.',
  sampleCta: 'Voir l’exemple',
  makeSame: 'En créer un comme ça',
  samplesNote: 'Livres de démonstration réalisés par l’équipe Yujee pour montrer ce que le produit sait faire — contenu fictif, pas des créations de clients.',
  heroEyebrow: 'Livres photo et mémoires par IA · de la photo au livre relié',
  heroTitle: (
    <>
      Vos photos du quotidien deviennent
      <br />
      des mémoires qui n&apos;appartiennent qu&apos;à vous
    </>
  ),
  heroSub: 'YUJEE AI transforme vos photos, vos histoires, vos souvenirs et vos idées en un beau livre souvenir fait pour vous seul.',
  heroCta: 'Commencer à créer',
  heroExamples: 'Voir les exemples',
  trust: ['Aucune compétence en design', 'Mise en page modifiable', 'Export PDF prêt à imprimer'],
  workflowTitle: 'Comment ça marche',
  workflow: ['Regroupement automatique des photos', 'Écriture assistée par l’IA', 'Mise en page automatique façon magazine'],
  polish: 'Peaufinage du texte…',
  featuresLabel: 'Ce qu’il fait',
  featuresTitle: (
    <>
      Un créateur de livre photo par IA
      <br />
      qui fait le tri à votre place
    </>
  ),
  features: [
    {
      title: 'Mise en page automatique en livre photo',
      body:
        'Déposez une série de photos : l’IA compose automatiquement des doubles pages façon magazine — pleines pages, grilles, respiration. C’est du design de livre photo sans le travail de design, et une mise en page finie sans déplacer les images une par une.',
      icon: 'layout',
    },
    {
      title: 'Regroupement intelligent + légendes',
      body:
        'Elle repère les moments et les scènes pour regrouper vos photos toute seule, et rédige pour chaque groupe un titre et une description modifiables. Vous donnez le ton, elle écrit le premier jet.',
      icon: 'spark',
    },
    {
      title: 'Aperçu feuilletable · export PDF prêt à imprimer',
      body:
        'Feuilletez un aperçu en 3D, page après page — ce que vous voyez est ce que vous obtenez. Gardez-le en livre photo numérique, ou exportez un PDF 300 DPI prêt à imprimer et à relier quand vous voulez.',
      icon: 'book',
    },
  ],
  ctaTitle: 'Ne laissez pas ces photos au fond d’un dossier — faites-en un livre à garder',
  ctaSub: 'Créez votre premier livre photo en quelques minutes. Commencez gratuitement ; vous penserez à l’export et à l’impression quand il vous plaira vraiment.',
  start: 'Commencer gratuitement',
  faqLabel: 'FAQ',
  faqTitle: 'Vos questions sur le livre photo par IA',
  faq: buildFaq('fr', 'Voir les tarifs'),
  footerTagline: 'Vos photos deviennent un album au design soigné.',
  footerProduct: 'Produit',
  footerResources: 'Ressources',
  footerExampleTravel: 'Exemple de livre photo de voyage',
  footerExampleLifeStory: 'Exemple de livre de récit de vie',
  footerExamplesAll: 'Tous les exemples',
  footerCompany: 'À propos',
  footerAccount: 'Compte',
  footerPrivacy: 'Confidentialité',
  footerTerms: 'Conditions',
  signup: 'Inscription gratuite',
  copyright: '© 2026 Yujee · Vos souvenirs, joliment mis en page',
  samples: [
    {
      title: 'Une année en un livre',
      brief: 'Un livre photo par an, relié chaque décembre',
      body:
        'Toute une année dans un seul livre. Fêtes, voyages et instants ordinaires sont mis en page mois par mois, et l’histoire continue d’année en année.',
      bullets: ['Regroupé par mois ou par événement', 'Le livre de fin d’année en un clic', 'Même style, une collection assortie chaque année'],
      image: '/landing-redesign/cards/03-year-record.png',
      video: '/landing-redesign/cards/03-year-record.mp4',
    },
    {
      title: 'Récit de vie',
      brief: 'Vos grandes étapes, réunies en un livre de vie',
      body:
        'Déroulez les grandes étapes sur une ligne du temps : la naissance, l’école, les rencontres, les voyages. Chaque groupe reçoit un court texte modifiable, relié comme une biographie.',
      bullets: ['Regroupement automatique par étape de vie', 'Textes longs et citations par groupe', 'Parfait comme cadeau d’anniversaire ou de commémoration'],
      image: '/landing-redesign/cards/02-life-story.png',
      video: '/landing-redesign/cards/02-life-story.mp4',
    },
    {
      title: 'Voyage',
      brief: 'Un voyage, relié tout seul en carnet de voyage',
      body:
        'Regroupement automatique par date, avec les lieux et l’ordre du trajet remis dans l’ordre pour vous. Une double page par journée, avec de l’air entre les photos.',
      bullets: ['Découpage automatique par ligne du temps', 'Ajoutez des pages de carte et des notes d’itinéraire', 'Exportez un PDF à partager avec vos compagnons de route'],
      image: '/landing-redesign/cards/01-travel.png',
      video: '/landing-redesign/cards/01-travel.mp4',
    },
    {
      title: 'Portfolio',
      brief: 'Vos travaux, alignés en toute sobriété',
      body:
        'Photographie, illustration, design : alignés sur une grille avec des marges régulières, pour que le travail reste la vedette.',
      bullets: ['Grille stricte et marges uniformes', 'Titre, technique et année sur chaque page', 'Exportez un portfolio PDF prêt à envoyer'],
      image: '/landing-redesign/cards/06-portfolio.png',
      video: '/landing-redesign/cards/06-portfolio.mp4',
    },
    {
      title: 'Magazine',
      brief: 'Une mise en page de vrai magazine',
      body:
        'Plus qu’un album : couverture, sommaire, dossiers et citations sur un squelette de magazine. Votre vie devient un numéro.',
      bullets: ['Modèles de couverture, sommaire et dossier', 'Mise en page éditoriale avec titres et citations', 'Export prêt à imprimer pour un numéro papier'],
      image: '/landing-redesign/cards/05-magazine.png',
      video: '/landing-redesign/cards/05-magazine.mp4',
    },
    {
      title: 'Album de croissance',
      brief: 'Une page par mois, chaque changement',
      body:
        'Classé par mois en une ligne du temps de la croissance. Les petites notes — taille, poids, premières fois — atterrissent sur la bonne page.',
      bullets: ['Regroupement automatique par mois ou par étape', 'Ajoutez de petites fiches de repères', 'Continuez d’ajouter : l’album grandit avec le temps'],
      image: '/landing-redesign/cards/04-growth-story.png',
      video: '/landing-redesign/cards/04-growth-story.mp4',
    },
  ],
  previewChapters: [
    {
      title: 'Départ au matin',
      left: '/landing-redesign/photos/bamboo-grove-path.jpg',
      right: '/landing-redesign/photos/riverside-walk.jpg',
    },
    {
      title: 'Littoral d’été',
      left: '/landing-redesign/photos/kamakura-coastal-street.jpg',
      right: '/landing-redesign/photos/seto-inland-sea-pier.jpg',
    },
    {
      title: 'Le chemin du retour',
      left: '/landing-redesign/photos/rainy-kyoto-lane.jpg',
      right: '/landing-redesign/photos/riverside-before-fireworks.jpg',
    },
  ],
};
