import type { ExampleContent } from './types';

/** The four formats added 2026-09-21 share the same five capabilities (same
 *  wording as travel-journal); the two older entries keep their own lists. */
const MADE_WITH = [
  'Regroupement des photos par IA',
  'Légendes rédigées par l’IA',
  'Mise en page automatique façon magazine',
  'Retouches par le chat',
  'PDF 300 DPI prêt à imprimer',
];

export const fr: Record<string, ExampleContent> = {
  'travel-journal': {
    title: 'Carnet de voyage',
    tagline: 'Un voyage mis en page comme une histoire de lieux et d’instants.',
    metaTitle: 'Exemple de livre photo de voyage — un album souvenir Yujee créé par IA',
    metaDesc:
      'Découvrez comment Yujee transforme les photos éparpillées de tout un voyage en un livre photo façon magazine : regroupées par lieu, légendées par l’IA, exportées en PDF prêt à imprimer.',
    intro: [
      'Voici un exemple d’album souvenir de voyage réalisé avec Yujee. Nous avons pris les photos d’un seul voyage — paysages, rues, portraits et les instants calmes entre deux — et laissé l’IA les regrouper par lieu et par moment, rédiger les légendes et les titres de chapitre, puis mettre chaque double page en scène comme un magazine que l’on tient en main. Rien ici n’a été conçu à la main.',
      'Prenez-le comme référence pour votre propre livre photo de voyage. Une semaine à Kyoto ou une année d’escapades de week-end, le déroulé reste le même : importez vos photos, laissez Yujee trier et composer un premier brouillon, modifiez ce que vous voulez par le chat, puis exportez un PDF 300 DPI à imprimer et à relier.',
    ],
    inside: [
      'Une couverture et une page de titre bâties sur votre plus belle photo',
      'Des chapitres regroupés par lieu et par journée',
      'Des légendes et de courts textes de chapitre rédigés par l’IA, tous modifiables',
      'Des paysages en pleine page à côté de détails plus discrets',
    ],
    madeWith: [
      'Regroupement des photos par IA',
      'Légendes rédigées par l’IA',
      'Mise en page automatique façon magazine',
      'Retouches par le chat',
      'PDF 300 DPI prêt à imprimer',
    ],
    galleryAlt: [
      'Couverture du Carnet de voyage avec une photo de drapeaux de prières au bord d’un lac',
      'Une double page de voyage associant un portrait et un paysage de montagne',
      'Une double page de voyage intitulée « Le calme entre les instants » avec une photo de rayons de lumière',
      'Une double page de voyage montrant des chevaux sur un champ de neige à côté d’un portrait',
    ],
  },
  'life-story': {
    title: 'Récit de vie',
    tagline: 'Une vie racontée le long d’une ligne du temps — les grandes étapes et les jours ordinaires entre elles.',
    // This page owns the memoir/biography demand. Deliberately NOT the bare
    // terms "best memoir" or "biography": those SERPs are book recommendations
    // and celebrity lookups (Goodreads, Wikipedia, IMDb) — reader and
    // reference intent, not "I want to make one". "memoir book" and
    // "biography book" are the make-intent forms of the same demand.
    metaTitle: 'Exemple de récit de vie et de livre biographique — créateur de mémoires IA Yujee',
    metaDesc:
      'Un livre de mémoires réalisé avec Yujee : les grandes étapes et les moments du quotidien déroulés sur une ligne du temps, mis en page par l’IA. Créez votre propre livre biographique et exportez un PDF prêt à imprimer.',
    intro: [
      'Voici un exemple de livre de mémoires réalisé avec Yujee. Il rassemble les moments dont une vie est réellement faite — une table près de la fenêtre, un après-midi à la maison, ces petits coins de nature morte au milieu desquels on vit — et les dispose le long d’une ligne du temps toute douce. L’IA a rédigé un premier jet des titres de chapitre et des légendes ; chaque mot reste modifiable.',
      'C’est un format qui ne cesse de grandir. Ajoutez un chapitre chaque année, ou numérisez de vieilles photos et laissez Yujee les enfiler en une seule histoire continue, puis exportez un PDF 300 DPI à imprimer et à conserver. C’est la façon la plus simple d’écrire sa propre biographie sans avoir à écrire un mot d’abord : l’IA rédige, vous corrigez.',
    ],
    inside: [
      'Une ligne du temps qui va des premières années jusqu’à aujourd’hui',
      'Des chapitres pour les grandes étapes, les maisons et les coins du quotidien',
      'Des titres et des légendes rédigés par l’IA que vous pouvez réécrire',
      'La place qu’il faut pour ajouter un nouveau chapitre chaque année',
    ],
    madeWith: [
      'Regroupement des photos par IA',
      'Textes de chapitre rédigés par l’IA',
      'Mise en page automatique façon magazine',
      'Retouches par le chat',
      'PDF 300 DPI prêt à imprimer',
    ],
    galleryAlt: [
      'Une double page de récit de vie intitulée « Table d’après-midi » avec des photos d’intérieur',
      'Une double page associant « Table d’après-midi » à une photo de vase en nature morte',
      'Une double page « Coin décoratif / Nature morte » avec des branches dans un vase',
      'Une double page « Coin décoratif / Salon personnel » montrant une pièce pleine de vie',
    ],
  },
  // ---- Added 2026-09-21: the four remaining homepage formats ----------------
  'year-in-review': {
    title: 'Rétrospective de l’année',
    tagline: 'Un livre photo de l’année — douze mois, mis en page mois par mois.',
    metaTitle: 'Exemple de livre photo de l’année — créé avec Yujee AI',
    metaDesc:
      'Un livre photo de l’année réalisé avec Yujee : voyages et jours ordinaires regroupés par mois, légendés par l’IA, mis en page façon magazine, en PDF à imprimer.',
    intro: [
      'Voici un exemple de livre photo de l’année réalisé avec Yujee. Nous avons pris les photos d’une année entière — des prairies au printemps, un lac en été, des ciels du soir, quelques week-ends ailleurs — et laissé l’IA les trier par mois, rédiger une légende et une courte note de chapitre pour chaque période, puis composer chaque double page comme un magazine. Rien sur ces pages n’a été placé à la main.',
      'C’est un format qui continue : faites-en un chaque décembre et les livres s’alignent en collection sur l’étagère. Importez les photos de l’année, laissez Yujee les regrouper et composer un premier brouillon, corrigez ce que vous voulez par le chat, puis exportez un PDF 300 DPI à imprimer et à relier — ou gardez-le en numérique et partagez le lien.',
    ],
    inside: [
      'Une couverture bâtie sur la plus belle photo de l’année',
      'Des chapitres regroupés par mois ou par événement',
      'Des légendes et des notes de chapitre rédigées par l’IA, toutes modifiables',
      'Le même style chaque année, pour que les volumes s’accordent sur l’étagère',
    ],
    madeWith: MADE_WITH,
    galleryAlt: [
      'Couverture de la Rétrospective de l’année avec une prairie au bord d’un lac sous un ciel nuageux',
      'Double page d’ouverture du livre photo de l’année avec deux couchers de soleil sur un lac',
      'Une double page intitulée « The Quiet Between Moments » avec un étang de lotus et un cheval dans une prairie',
      'Une double page de clôture intitulée « What We Keep » avec une femme debout dans une prairie de montagne',
    ],
  },
  'growth-story': {
    title: 'Bébé grandit',
    tagline: 'Un album de bébé qui ne cesse de grandir — une page par mois, et chaque première fois.',
    metaTitle: 'Exemple d’album de bébé et des premières fois — Yujee AI',
    metaDesc:
      'Un album de bébé réalisé avec Yujee : mois et premières fois sur une ligne de croissance, légendes rédigées par l’IA, mis en page en souvenir, en PDF à imprimer.',
    intro: [
      'Voici un exemple d’histoire de croissance — un album de bébé réalisé avec Yujee. Les photos d’une famille sur une année (une tente au bord du lac, un premier feu de camp, un après-midi au jardin, des gâteaux avec les grands-parents) ont été classées par mois sur une ligne de croissance, l’IA rédigeant les légendes et une courte note pour chaque étape. Chaque mot est un premier jet modifiable.',
      'Le format est conçu pour être complété sans fin. Déposez les photos d’un nouveau mois et Yujee compose la page suivante dans le même style ; les petites fiches de données — taille, poids, premiers mots — se posent sur la bonne page. Une année terminée, exportez un PDF 300 DPI et imprimez un exemplaire pour chaque grand-parent.',
    ],
    inside: [
      'Une ligne de croissance regroupée par mois ou par étape',
      'De la place pour de petites fiches : taille, poids, premières fois',
      'Des légendes et des notes d’étape rédigées par l’IA, toutes modifiables',
      'Ajoutez des pages au fil du temps — l’album grandit avec l’enfant',
    ],
    madeWith: MADE_WITH,
    galleryAlt: [
      'Couverture de l’album de croissance avec une famille qui monte une tente au bord d’un lac',
      'Double page d’ouverture avec une famille en promenade dans les bois et des enfants près d’une lanterne de camping',
      'Une double page intitulée « The Quiet Between Moments » avec un enfant au jardin et les grands-parents à table',
      'Une double page de clôture intitulée « What We Keep » avec un père et sa fille arrosant des plantes et une famille qui fait des gâteaux ensemble',
    ],
  },
  'photo-magazine': {
    title: 'Magazine photo',
    tagline: 'Vos photos composées comme un vrai magazine — couverture, doubles pages de reportage et citations en exergue.',
    metaTitle: 'Exemple de magazine photo personnalisé — à créer avec Yujee AI',
    metaDesc:
      'Un magazine photo réalisé avec Yujee : vos photos composées en numéro éditorial — couverture, doubles pages et légendes mises en page par l’IA, en PDF à imprimer.',
    intro: [
      'Voici un exemple de magazine photo réalisé avec Yujee. Une série de portraits d’hiver — neige, rues de la ville, une cape rouge la nuit — a été composée sur le squelette d’un magazine : une couverture, une double page d’ouverture façon sommaire, des pages de reportage avec titres et citations en exergue. L’IA a choisi l’ordre et rédigé les textes ; rien n’a été placé à la main.',
      'C’est le format des photos qui méritent mieux qu’une grille. Importez une séance, une saison ou une année de votre passion, et Yujee la met en page comme un numéro à poser sur la table basse. Modifiez n’importe quel titre par le chat, puis exportez un PDF 300 DPI et faites-le imprimer comme un vrai magazine — ou partagez le lien pour le feuilleter.',
    ],
    inside: [
      'Une couverture et un sommaire bâtis sur vos plus belles photos',
      'Des doubles pages de reportage avec titres et citations en exergue',
      'Des textes éditoriaux rédigés par l’IA, tous modifiables',
      'Des pages prêtes à imprimer pour un numéro papier',
    ],
    madeWith: MADE_WITH,
    galleryAlt: [
      'Couverture de magazine avec une silhouette en long manteau sur une pente enneigée',
      'Double page éditoriale d’ouverture avec deux portraits de mode d’hiver dans la neige',
      'Une double page intitulée « The Quiet Between Moments » associant un manteau bleu dans la neige et un portrait dans une rue de la ville',
      'Une double page de clôture intitulée « What We Keep » avec une cape rouge et un portrait de rue de nuit',
    ],
  },
  'portfolio-book': {
    title: 'Portfolio',
    tagline: 'Une sélection de travaux sur une grille stricte — un portfolio PDF à envoyer ou à imprimer.',
    metaTitle: 'Exemple de portfolio photo — un portfolio PDF créé avec Yujee AI',
    metaDesc:
      'Un portfolio réalisé avec Yujee : photographies choisies sur une grille stricte, marges régulières et un titre par page, exporté en portfolio PDF prêt à envoyer.',
    intro: [
      'Voici un exemple de portfolio réalisé avec Yujee. Les travaux choisis d’un photographe — une série de mode d’hiver — ont été alignés sur une grille stricte aux marges régulières, un titre par page, pour que l’œuvre reste la vedette et que la mise en page s’efface. L’IA s’est chargée de l’ordre et des espacements ; les pages n’ont pas été conçues à la main.',
      'C’est le format de tous ceux qui doivent envoyer leur travail : photographes, illustrateurs, designers. Importez les pièces, laissez Yujee les mettre en page, renommez n’importe quel titre par le chat, puis exportez un portfolio PDF prêt à soumettre — ou un fichier 300 DPI pour un livre imprimé à remettre en main propre.',
    ],
    inside: [
      'Une grille stricte aux marges régulières sur chaque page',
      'Titre, technique et année pour chaque pièce',
      'Une couverture et une page de fin sobres',
      'Un portfolio PDF à soumettre, ou un fichier prêt à imprimer',
    ],
    madeWith: MADE_WITH,
    galleryAlt: [
      'Couverture du portfolio intitulée « My Folder » avec une silhouette sur une pente enneigée',
      'Double page d’ouverture du portfolio avec deux photographies de mode d’hiver',
      'Une double page du portfolio associant une photo de manteau bleu dans la neige et un portrait de rue',
      'Une double page de clôture du portfolio avec une cape rouge et un portrait de ville de nuit',
    ],
  },
};
