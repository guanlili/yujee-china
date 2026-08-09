import type { ExampleContent } from './types';

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
};
