import { SUPPORT_EMAIL } from '@/config/social';
import type { MarketingMessages } from './types';

export const fr: MarketingMessages = {
  nav: {
    brand: 'Yujee',
    home: 'Accueil',
    myProjects: 'Mes projets',
    howItWorks: 'Comment ça marche',
    examples: 'Exemples',
    guides: 'Guides',
    pricing: 'Tarifs',
    about: 'À propos',
    menuToggle: 'Ouvrir ou fermer le menu de navigation',
    login: 'Se connecter',
    getStarted: 'Commencer',
    languageLabel: 'Français',
  },
  landing: {
    // "Free" leads because the free grant is real (FREE_PLAN_CREDITS covers a
    // whole book) and because "layout" is the winnable half of that demand —
    // bare "free photo book maker" is Shutterfly/Canva territory. "Memoir"
    // stays: it is the higher-intent term and the one this site can rank for.
    metaTitle: 'Livre photo et mémoires par IA, gratuit — mise en page auto vers PDF | Yujee',
    metaDesc:
      'Mise en page de livre photo gratuite en ligne — l’IA de Yujee regroupe vos photos, écrit le récit et compose un livre façon magazine. Modifiez par le chat, exportez un PDF prêt à imprimer.',
    composerUploadLabel: 'Importer des photos',
    composerHints: [
      { label: 'Album de voyage', fill: 'Fais-moi un album photo de mon voyage à Bali la semaine dernière — j’ai plein de photos de plages et de temples.' },
      { label: 'Bébé mois par mois', fill: 'Je voudrais un carnet de croissance pour ma fille, avec les photos de sa naissance à son premier anniversaire.' },
      { label: 'Remise de diplôme', fill: 'Un album de fin d’année de lycée avec les photos de classe et les mots d’adieu de tout le monde.' },
      { label: 'Carnet gourmand', fill: 'Rassemble mes photos de restaurants des six derniers mois en un magazine culinaire.' },
    ],
    casesTitle: 'Inspiration',
    casesMore: 'Voir plus',
    cases: [
      { title: 'Remise de diplôme', desc: 'Quatre années de photos de groupe, de tickets gardés et de discussions, réunies en un album de promo.' },
      { title: 'Souvenir de mariage', desc: 'Gardez les vœux, les mots des proches et chaque détail du jour où vous avez dit oui.' },
      { title: 'Bébé mois par mois', desc: 'De la naissance au premier anniversaire, chaque étape en photos et en mots.' },
      { title: 'Carnet de voyage', desc: 'Des moments de voyage éparpillés, remis en histoire sur une ligne du temps.' },
      { title: 'Week-end entre amies', desc: 'Le soleil, les fous rires et les photos du week-end, transformés en un numéro plein de lumière.' },
      { title: 'Journal d’animal', desc: 'Un livre photo rien que pour votre compagnon à poils, entre quotidien et grands moments de bêtise.' },
      { title: 'Souvenirs de famille', desc: 'Numérisez les vieilles photos et gardez les histoires de famille qui méritent de durer.' },
      { title: 'Carnet de saveurs', desc: 'Vos photos de restaurants classées en un guide gourmand qui raconte quelque chose.' },
      { title: 'Journal amoureux', desc: 'Les rendez-vous tranquilles, les petits mots et la romance ordinaire, réunis dans un seul livre.' },
    ],
  },
  privacy: {
    metaTitle: 'Yujee — Politique de confidentialité',
    metaDesc:
      'Comment Yujee traite vos photos et vos données personnelles. Vos photos originales ne sont jamais envoyées — seuls des aperçus compressés partent vers l’IA pour préparer la mise en page, et vos albums restent privés.',
    title: 'Politique de confidentialité',
    effective: 'Date d’entrée en vigueur : 27 mai 2026',
    sections: [
      {
        h: '1. Introduction',
        body: 'Yujee (« nous ») attache de l’importance à votre vie privée. La présente politique de confidentialité explique comment nous collectons, utilisons, divulguons et protégeons vos informations lorsque vous utilisez outman.press.',
      },
      {
        h: '2. Informations que nous collectons',
        body: 'Nous collectons : (a) les informations de compte (e-mail, nom) lors de votre inscription ; (b) des données d’usage sur la façon dont vous interagissez avec Yujee ; (c) les textes et consignes que vous soumettez pour générer un livre ; (d) les livres que vous produisez — données de mise en page, fichiers PDF exportés et vignettes de couverture — conservés sur notre stockage cloud afin que vous puissiez les rouvrir et les télécharger à tout moment. Nous ne conservons pas les photos originales que vous importez : elles restent dans votre navigateur, et seuls des aperçus compressés sont transmis à notre prestataire d’IA pour préparer la mise en page. Notez que les photos placées dans un livre sont intégrées au PDF que vous exportez et enregistrez.',
      },
      {
        h: '3. Comment nous utilisons vos informations',
        body: 'Nous utilisons ces informations pour fournir et améliorer Yujee, traiter les paiements et gérer les crédits, envoyer les notifications liées au service, suivre les tendances d’utilisation, et détecter ou prévenir la fraude et les abus.',
      },
      {
        h: '4. Partage des informations',
        body: 'Nous ne vendons pas vos informations personnelles. Nous ne partageons vos données qu’avec les prestataires qui font fonctionner le produit pour notre compte (hébergement cloud, traitement des paiements, envoi d’e-mails, inférence IA) et lorsque la loi l’exige.',
      },
      {
        h: '5. Sécurité des données',
        body: 'Nous appliquons des mesures techniques et organisationnelles raisonnables pour protéger vos données. Aucune transmission par Internet ni aucun stockage électronique n’est sûr à 100 % ; nous ne pouvons pas garantir une sécurité absolue.',
      },
      {
        h: '6. Vos droits',
        body: 'Selon votre juridiction, vous pouvez accéder à vos données personnelles, les rectifier, les supprimer ou en limiter le traitement. Contactez-nous pour exercer ces droits.',
      },
      {
        h: '7. Vie privée des enfants',
        body: 'Yujee ne s’adresse pas aux enfants de moins de 13 ans (ou l’âge équivalent dans votre juridiction). Si nous apprenons que nous avons collecté les données personnelles d’un enfant, nous les supprimerons sans délai.',
      },
      {
        h: '8. Modifications de la présente politique',
        body: 'Nous pouvons mettre à jour la présente politique de confidentialité à tout moment. Les changements importants seront annoncés dans le produit ou par e-mail.',
      },
      {
        h: '9. Contact',
        body: '',
      },
    ],
    contactLine: 'Une question ? Écrivez-nous à privacy@yujeeai.com.',
  },
  terms: {
    metaTitle: 'Yujee — Conditions d’utilisation',
    metaDesc:
      'Les conditions que vous acceptez en utilisant Yujee pour transformer vos photos en un livre mis en page par l’IA : comptes, crédits, exports, et les droits que vous conservez sur vos propres contenus.',
    title: 'Conditions d’utilisation',
    effective: 'Date d’entrée en vigueur : 8 août 2026',
    sections: [
      {
        h: '1. Acceptation des conditions',
        body: 'En accédant à Yujee (outman.press) ou en l’utilisant, vous acceptez d’être lié par les présentes conditions d’utilisation. Si vous ne les acceptez pas, n’utilisez pas le service.',
      },
      {
        h: '2. Description du service',
        body: 'Yujee est un générateur de livres souvenirs propulsé par l’IA. Vous fournissez des photos et des consignes ; nous mettons en page un livre façon magazine que vous pouvez exporter en PDF. Nous ne garantissons aucun résultat créatif particulier.',
      },
      {
        h: '3. Comptes utilisateurs',
        body: 'Vous êtes responsable de la confidentialité de vos identifiants et de toute activité effectuée depuis votre compte. Vous devez fournir des informations d’inscription exactes.',
      },
      {
        h: '4. Usage acceptable',
        body: 'Vous vous engagez à ne pas utiliser Yujee pour produire des contenus illégaux, nuisibles, diffamatoires, obscènes ou portant atteinte aux droits d’autrui ; ni à perturber le service, à contourner les limites d’usage ou à tenter un accès non autorisé.',
      },
      {
        h: '5. Manquement et résiliation du compte',
        body:
          'Si vous manquez aux présentes conditions, en particulier à la section 4, ou si nous avons des motifs raisonnables de penser que votre usage de Yujee est illicite, contrefaisant, frauduleux ou nuisible aux autres utilisateurs ou à la sécurité du service, nous pouvons prendre une ou plusieurs des mesures suivantes, selon la gravité du manquement :\n' +
          '• vous avertir et vous demander de corriger le problème dans un délai indiqué ;\n' +
          '• restreindre ou désactiver certaines fonctionnalités, comme la génération, l’export ou le partage ;\n' +
          '• retirer les contenus concernés ou en bloquer l’accès, ainsi que tout lien de partage vers ceux-ci ;\n' +
          '• suspendre votre compte ;\n' +
          '• résilier votre compte et refuser de continuer à vous fournir le service.\n' +
          '\n' +
          'En cas de manquement grave, de manquements répétés après avertissement, ou lorsque la loi ou une autorité compétente l’exige, nous pouvons suspendre ou résilier immédiatement, sans préavis. Sauf urgence ou obligation légale contraire, nous nous efforcerons raisonnablement de vous indiquer le motif au moment où nous agissons ou peu après. Si vous estimez qu’une décision est erronée, vous pouvez la contester à l’adresse de contact figurant à la fin des présentes conditions et nous la réexaminerons.\n' +
          '\n' +
          'Si votre compte est résilié pour manquement aux présentes conditions, les crédits non utilisés ne sont pas remboursés et nous ne sommes pas responsables des pertes résultant de la résiliation. Rien ici ne limite notre droit d’exercer les autres recours prévus par la loi. Vous pouvez cesser d’utiliser Yujee ou demander la suppression de votre compte à tout moment ; après suppression, vos données sont traitées comme décrit dans la politique de confidentialité. Les sections 6, 8, 9 et 11, ainsi que toute stipulation qui par nature doit survivre, restent en vigueur après la résiliation.',
      },
      {
        h: '6. Propriété intellectuelle',
        body: 'Vous conservez la propriété des photos et des textes que vous fournissez. Entre vous et Yujee, le livre généré vous appartient — vous pouvez l’utiliser, le reproduire et le diffuser librement. Nous traitons vos contenus uniquement pour fournir le service.',
      },
      {
        h: '7. Crédits et paiements',
        body:
          'Créer un livre consomme des crédits photo par photo : un crédit couvre une photo. Lorsque vous lancez une génération, nous réservons les crédits correspondants ; ils sont débités une fois la mise en page réussie, et la réservation est libérée sans frais si la génération échoue. Les crédits s’obtiennent par packs à l’unité — sans abonnement ni frais mensuels, et les crédits n’ont pour l’instant aucune date d’expiration. Les prix et les tailles de packs en vigueur sont ceux affichés sur la page des tarifs.\n' +
          '\n' +
          'Une fois les crédits débités pour une mise en page réussie, ils ne sont pas remboursables, y compris si le résultat ne vous plaît pas. Sauf obligation légale, les sommes versées et les packs de crédits achetés ne sont pas remboursables. Si vous avez acheté via un prestataire de paiement tiers, les règles de remboursement de ce prestataire s’appliquent également, et rien dans cette section n’affecte les droits des consommateurs que la loi de votre pays ou de votre région ne nous permet pas d’écarter.\n' +
          '\n' +
          'Nous pouvons modifier à tout moment les prix, les tailles de packs et les modèles de facturation. Les changements s’appliquent aux nouveaux achats dès leur publication et n’affectent pas les crédits déjà achetés.',
      },
      {
        h: '8. Exclusion de garanties',
        body: 'Le service est fourni « en l’état » et « selon disponibilité », sans garantie d’aucune sorte. Nous ne garantissons pas que Yujee sera ininterrompu, sûr ou exempt d’erreurs.',
      },
      {
        h: '9. Limitation de responsabilité',
        body: 'Dans toute la mesure permise par la loi, Yujee ne saurait être tenu responsable des dommages indirects, accessoires, spéciaux, consécutifs ou punitifs — y compris la perte de bénéfices, la perte de données ou l’atteinte à la réputation.',
      },
      {
        h: '10. Modification des conditions',
        body: 'Nous pouvons modifier les présentes conditions à tout moment ; la version mise à jour prend effet dès sa publication. Continuer à utiliser le service après un changement vaut acceptation.',
      },
      {
        h: '11. Droit applicable et litiges',
        body:
          'Les présentes conditions — leur formation, leur validité et leur interprétation, ainsi que tout litige qui en découle ou s’y rapporte — sont régies par le droit de la République populaire de Chine (à l’exclusion des régions administratives spéciales de Hong Kong et de Macao et de Taïwan).\n' +
          '\n' +
          'En cas de litige, les parties chercheront d’abord à le résoudre par une négociation de bonne foi. Si la négociation n’aboutit pas, chaque partie peut saisir un tribunal compétent du lieu où se trouve l’exploitant de Yujee.\n' +
          '\n' +
          'Si la loi de votre pays ou de votre région vous accorde des droits de consommateur auxquels il ne peut être dérogé, la présente section n’affecte pas ces droits.',
      },
      {
        h: '12. Contact',
        body: '',
      },
    ],
    contactLine: 'Une question ? Écrivez-nous à support@yujeeai.com.',
  },
  story: {
    metaTitle: 'Notre histoire — pourquoi j’ai créé Yujee',
    metaDesc:
      'J’ai vécu plus de dix ans avec la dépression, j’ai été conseillère en astrologie, puis j’ai passé un an à construire un conseiller IA. Voici ce que j’en ai appris, et pourquoi Yujee transforme plutôt votre vie en livre.',
    title: 'Une fois sortie de la dépression, je me suis fabriqué un outil rien que pour moi',
    lede: [
      'Je m’appelle yvaine.',
      'J’ai vécu plus de dix ans avec la dépression. J’ai été conceptrice de produits logiciels, puis conseillère en astrologie. Aujourd’hui je construis Yujee.',
      'Yujee est un outil qui vous aide à vous comprendre, et à en faire un livre.',
      'Voici pourquoi il existe.',
    ],
    sections: [
      {
        h: 'Plus de dix ans dans le noir',
        paras: [
          'J’ai souffert d’une dépression sévère et de troubles bipolaires.',
          'De l’école primaire à l’âge adulte, à cause de ce qui se passait à la maison, j’étais l’enfant repliée sur elle-même, celle qu’on laissait de côté, celle qui n’avait aucune confiance en elle.',
          'La lumière n’a commencé à entrer qu’après la fin de mes études.',
          'Après le diplôme je suis passée à la conception de produits logiciels, et j’ai senti pour la première fois le plaisir de résoudre quelque chose avec de la logique et du design à la fois. Mais une question ne m’a jamais lâchée. Pour quoi est-ce qu’on vit, au fond.',
        ],
        pull: 'Plus de dix ans sans lumière du jour. Je me suis tenue au bord de ce précipice plus de fois que je ne peux compter.',
      },
      {
        h: 'L’astrologie m’a donné un point d’appui',
        paras: [
          'J’avais fait beaucoup de thérapie et d’accompagnement. Presque rien n’a marché sur moi.',
          'Plus tard je me suis tournée vers la divination. J’ai interrogé des astrologues, des lecteurs de BaZi, des lecteurs de Zi Wei. Aucun n’a su répondre à cette question.',
          'La curiosité m’a poussée à apprendre l’astrologie moi-même. Je l’ai apprise en la pratiquant, et sans trop savoir comment je suis devenue conseillère en astrologie.',
          'Plus j’avançais, mieux je comprenais d’où venait ma propre dépression. Je me suis réconciliée avec une enfance pauvre et malheureuse.',
          'Je ne suis pas là pour vous vendre de l’astrologie. Ce qui m’a vraiment aidée, c’est qu’elle m’a donné un point d’appui, un angle depuis lequel je pouvais me regarder de l’extérieur. Le Nœud Nord, pour moi, c’est exactement ça.',
          'Ensuite j’ai mêlé astrologie et psychologie pour aider les gens autour de moi, et ça a marché mieux que je ne l’imaginais. Donnez à quelqu’un un point d’appui, et il peut soulever sa propre vie.',
        ],
      },
      {
        h: 'La fille de 13 ans',
        paras: [
          'J’ai rencontré une fille de 13 ans. Ses parents travaillaient loin depuis des années, elle avait été laissée à des proches, et elle avait arrêté d’aller à l’école.',
          'Je voulais l’aider. J’avais grandi exactement comme elle.',
          'Je n’ai pas pris le dossier. Sortir quelqu’un de là demande énormément de temps et d’énergie. J’étais noyée sous le travail, j’avais mes propres factures, et je n’en étais pas capable.',
          'Cette histoire ne m’a plus quittée. La plupart des enfants comme elle n’ont pas les moyens de payer un thérapeute, et de toute façon n’arrivent pas à s’ouvrir devant une vraie personne.',
        ],
      },
      {
        h: 'J’ai construit un conseiller IA',
        paras: [
          'C’étaient les années où ChatGPT et Claude sont arrivés. J’ai découvert qu’avec un réglage soigneux, une IA pouvait tenir le rôle d’une conseillère en astrologie de niveau junior à intermédiaire, avec les compétences d’accompagnement et d’astrologie à la fois. Tout ce que j’avais appris en conception logicielle avait enfin un endroit où aller.',
          'En 2024 j’ai rencontré CC, qui construisait un tarot par IA, via les réseaux sociaux. En 2025 j’ai rejoint l’équipe et j’ai passé une année entière à régler une IA pour en faire une conseillère assez peu chère, assez patiente pour rester sur la durée, et sans parti pris personnel.',
          'On l’a lancée.',
          'Mais après avoir observé de près, pendant un an, la façon dont les gens et cette conseillère IA se traitaient l’un l’autre, j’ai vu autre chose.',
          'Un bel avenir imaginé donne au cerveau sa dose de dopamine. Mais si rien ne se concrétise, si rien n’avance, on finit par porter de l’eau dans un panier. Le vide qui suit fait plus mal qu’avant.',
          'Donc il faut que ça se concrétise quelque part.',
        ],
        pull: 'L’accompagnement n’est pas la réponse, et ce n’est pas la destination. Quand quelqu’un reste perdu assez longtemps, l’accompagnement peut devenir une autre drogue. Le genre dont on devient lentement dépendant.',
      },
      {
        h: 'Pourquoi un livre',
        paras: [
          'J’ai épluché beaucoup de recherches sur les traitements psychologiques. L’art-thérapie et l’écriture expressive ont un effet net sur la dépression et sur le sentiment d’être perdu. Écrire et dessiner de ses mains vous tire hors de la boucle où vos pensées tournent en rond, et vous ramène dans votre corps.',
          'En clair : fabriquer des choses soulage la douleur, et ça travaille vraiment à reconstruire le sentiment de soi.',
          'Au fil de toutes ces consultations j’ai vu autre chose encore. Beaucoup de gens restent avec quelqu’un qu’ils n’aiment pas, font un travail qu’ils n’aiment pas, souffrent et se perdent pendant des années, et au fond ils ne savent pas qui ils sont vraiment. Ce qu’ils veulent, ce qu’ils ne supportent pas, ce dans quoi ils sont bons, ce à quoi ils tiennent. Rien de tout cela n’est clair pour eux.',
          'Ce genre de savoir n’arrive pas dans un éclair, un après-midi. Il demande des tours et des tours de façonnage, de découverte, de démolition, puis de vérification.',
          'Et en matière de création, je ne vois rien de plus fort qu’un livre qui n’appartient qu’à vous.',
          'Il rend votre vie visible. Et des années plus tard vous l’ouvrez et découvrez qu’en chemin il y a eu tant de moments qui comptaient. Des beaux, des moments où vous avez grandi, des moments qui ont fait mal.',
          'Ce que vous avez réellement vécu est le fruit le plus précieux sur l’arbre de votre vie.',
        ],
      },
      {
        h: 'Ce qu’est Yujee',
        paras: [
          'En 2026 je ne pouvais plus rester assise dessus.',
          'Je voulais construire un produit qui soit vraiment pour la personne qui l’utilise. Pas de jeux de rétention, pas d’hameçons. Une seule mission. Aider quelqu’un à se connaître, et à le garder.',
          'C’est de là que vient Yujee. En chinois, cela veut dire se rencontrer soi-même, et aussi se piloter soi-même.',
          'La façon dont il fonctionne est très concrète. Il transforme vos photos et vos mots éparpillés en un livre que vous pouvez ouvrir. Et dans ce geste de choisir et d’ordonner votre propre vie, vous vous voyez à nouveau.',
          'Ce que Yujee fait aujourd’hui :',
        ],
        bullets: [
          'Trie vos photos automatiquement et regroupe celles qui se ressemblent',
          'Met le livre en page à votre place, sans rien déplacer à la main',
          'Vous aide à écrire, en reliant les fragments en une histoire qui tient debout',
          'Se partage en un clic, pour que les gens qui comptent puissent le lire',
        ],
      },
      {
        h: 'Construit par une seule personne',
        paras: [
          'Yujee, je l’ai construit toute seule, en apprenant et en livrant en même temps. L’architecture système que j’ai attrapée il y a des années en faisant de l’intégration tient encore. On verra plus tard.',
          'Pendant deux mois je n’ai presque pas dormi, et j’ai sorti la première démo que je considérais utilisable. En juillet, 20 utilisateurs de la première heure m’ont envoyé leurs retours, et j’ai continué.',
          'Tout faire seule n’est pas facile, et il reste beaucoup de choses mal finies. Certaines parce que je n’en suis pas encore capable. D’autres parce que leur tour n’est pas venu. Mais je voulais réussir cette chose-là, terriblement.',
          'Yujee aujourd’hui reste une toute petite version. Elle ne changera peut-être rien pour vous tout de suite. Je veux quand même y mettre cet entêtement.',
          `Si quelque chose vous gêne à l’usage, ou s’il vous manque une fonctionnalité, venez me le dire sur le Discord. Un mail à ${SUPPORT_EMAIL} ou un message privé sur X marchent aussi. Je lis tout.`,
        ],
      },
    ],
    closing: 'Et j’espère que vous saurez tenir votre propre arbre de vie, et trouver celui ou celle qui vit tout au fond de vous.',
    dateline: 'yvaine, 31 juillet 2026',
    byline: { author: 'yvaine', date: '31 juillet 2026', readingTime: '8 min de lecture' },
    tocHead: 'Sommaire',
    ctaLabel: 'Commencez votre livre',
    disclaimer:
      'Yujee n’est pas un produit médical et ne remplace pas une psychothérapie. Si vous êtes en danger en ce moment, contactez d’abord un médecin ou une ligne d’écoute d’urgence.',
  },
  examples: {
    metaTitle: 'Exemples de livres photo et de mémoires — créés avec Yujee AI',
    metaDesc:
      'Des formats bien réels que vous pouvez créer avec Yujee : carnets de voyage, récits de vie, et plus encore — chacun regroupé, légendé et mis en page par l’IA à partir d’un tas de photos, puis exporté en PDF prêt à imprimer.',
    kicker: 'Exemples',
    hubTitle: 'Exemples',
    hubIntro:
      'Des formats bien réels que vous pouvez créer avec Yujee. Chacun est parti d’un tas de photos et de quelques mots — l’IA les a regroupées, a rédigé les légendes et mis en page chaque double page. Ouvrez-en un pour voir le déroulé, puis créez le vôtre.',
    moreComing: 'D’autres formats — animaux, mariages, histoires d’amour — arrivent bientôt.',
    insideHead: 'Ce qu’il y a dedans',
    madeWithHead: 'Créé avec',
    galleryHead: 'À l’intérieur du livre',
    flipThrough: 'Feuilleter',
    makeSame: 'En créer un comme ça',
    breadcrumbHome: 'Accueil',
    breadcrumbExamples: 'Exemples',
    openLabel: 'Voir l’exemple',
  },
  guides: {
    metaTitle: 'Guides du livre photo — Comment en faire un | Yujee',
    metaDesc:
      'Des guides pratiques pour créer un livre photo ou un récit de vie : numériser les tirages anciens, choisir les photos, écrire les légendes et obtenir un fichier prêt à imprimer.',
    hubTitle: 'Guides',
    hubIntro:
      'Comment sortir les photos du carton pour en faire un objet qui se garde. Des étapes concrètes, écrites pour ceux qui s’y mettent pour la première fois.',
    breadcrumbHome: 'Accueil',
    breadcrumbGuides: 'Guides',
    readLabel: 'Lire le guide',
    updatedLabel: 'Mis à jour le',
    englishOnlyNote: 'Ce guide n’est disponible qu’en anglais pour le moment.',
    faqHead: 'Questions fréquentes',
    relatedHead: 'À lire ensuite',
    ctaHead: 'Laissez Yujee faire la mise en page',
    ctaBody:
      'Importez vos photos, racontez ce qui se passait, et récupérez un PDF prêt à imprimer avec les pages composées et les légendes déjà rédigées, à corriger si besoin.',
    ctaButton: 'Commencer gratuitement',
  },
  pricingPage: {
    metaTitle: 'Tarifs — Ce que coûte un livre photo en IA | Yujee',
    metaDesc:
      'Un crédit, une photo. Achat unique, sans abonnement ni expiration. Ce que coûte un vrai livre, ce qui se passe si la génération échoue, et ce que l’impression ajoute.',
    title: 'Ce que coûte vraiment un livre photo',
    lede:
      'Un crédit, c’est {photos} photo. Pas d’abonnement, rien qui se renouvelle : vous achetez un pack de crédits une fois et vous les dépensez quand vous faites un livre.',
    freeLine: 'Vous recevez {credits} crédits gratuits à l’inscription. De quoi faire un premier livre entier.',
    packsHead: 'Packs de crédits',
    packsCreditsLabel: 'crédits',
    packsPerPhoto: 'par photo',
    workedHead: 'Ce que cela donne sur un vrai livre',
    worked: [
      {
        h: 'Un week-end en voyage',
        body: 'Environ 24 photos. Les crédits offerts en couvrent l’essentiel, et le pack à {packSmall} termine le livre avec de la marge.',
      },
      {
        h: 'Une année en un livre',
        body: 'Environ 60 photos pour toute l’année. Le pack à {packMid} suffit et laisse de quoi faire un second livre court.',
      },
      {
        h: 'La vie d’un parent',
        body: 'Environ 90 photos étalées sur des décennies, proche de la limite par livre. Le pack à {packLarge} en vient à bout et laisse plus de la moitié des crédits inutilisés.',
      },
    ],
    capLine:
      'Un livre accepte jusqu’à {max} photos. Au-delà, faites-en deux tomes : cela se lit mieux et rien n’est perdu.',
    includedHead: 'Ce que les crédits achètent',
    included: [
      'Un PDF prêt pour l’impression en 300 DPI, sans filigrane, qui vous appartient',
      'Une mise en page parmi plus de 40 gabarits de magazine — vous ne glissez jamais une photo dans un cadre',
      'Des légendes et des textes de chapitre rédigés à partir de vos photos et de vos notes, puis retouchés en conversant',
      'Vos photos d’origine ne quittent pas votre navigateur ; seules des prévisualisations compressées vont à l’IA',
    ],
    notIncludedHead: 'Ce qu’ils n’achètent pas : l’impression',
    notIncludedBody:
      'Vous recevez un fichier, pas un colis. L’impression est séparée et vous la confiez à qui vous voulez : un format relié classique revient à environ 20 à 70 dollars selon le nombre de pages, le papier et la reliure. Nous avons détaillé le calcul ici :',
    notIncludedLink: 'Combien coûte l’impression d’un livre photo ?',
    failureHead: 'Si la génération échoue, rien ne vous est facturé',
    failureBody:
      'Les crédits sont réservés au lancement de la mise en page et débités seulement si elle aboutit. En cas d’échec, la réservation est levée et les crédits reviennent sur votre solde.',
    refundHead: 'Remboursements',
    refundBody:
      'Les packs de crédits sont un achat unique de produit numérique et ne sont pas remboursables, sauf lorsque la loi l’exige. Les crédits déjà dépensés sur un livre qui a abouti restent dépensés, y compris si le résultat ne vous plaît pas. Si vous avez payé via un prestataire de paiement, ses propres règles de remboursement s’appliquent également.',
    noExpiryHead: 'Sans abonnement, sans expiration',
    noExpiryBody:
      'Rien ne se renouvelle et rien n’est prélevé à nouveau. Les crédits restent sur votre compte jusqu’à ce que vous les utilisiez : ils n’ont pour l’instant pas de date d’expiration.',
    faqHead: 'Questions fréquentes',
    faq: [
      {
        q: 'Existe-t-il une version gratuite ?',
        a: 'Oui. L’inscription vous donne assez de crédits pour un premier livre complet, et vous pouvez en exporter le PDF prêt à imprimer. Pas de compte à rebours d’essai, pas de carte bancaire.',
      },
      {
        q: 'Combien de crédits coûte un livre ?',
        a: 'Exactement autant que de photos : un crédit couvre {photos} photo. Un livre de 30 photos coûte 30 crédits. La pagination découle de la mise en page ; avec peu de photos, on tourne souvent autour de {pages} pages.',
      },
      {
        q: 'Faut-il repayer pour rééditer ou réexporter ?',
        a: 'Non. Les crédits sont débités une seule fois, quand la mise en page réussit. Retoucher le livre en conversant, réexporter le PDF et le retélécharger ne coûtent rien.',
      },
      {
        q: 'Puis-je faire imprimer le PDF n’importe où ?',
        a: 'Oui. C’est un PDF standard en 300 DPI, sans filigrane ni verrou : apportez-le à n’importe quel imprimeur ou service en ligne, ou gardez-le en numérique.',
      },
      {
        q: 'Que deviennent mes crédits si j’arrête d’utiliser Yujee ?',
        a: 'Ils restent sur votre compte. Ils n’expirent pas pour l’instant et il n’y a aucun abonnement à résilier.',
      },
    ],
    ctaHead: 'Commencez avec les crédits offerts',
    ctaBody: 'Déposez un dossier de photos et regardez le livre déjà mis en page avant de décider d’acheter quoi que ce soit.',
    ctaButton: 'Créer un livre',
    buyLink: 'Acheter des crédits',
  },
  footer: {
    tagline: 'Vos photos éparpillées deviennent un magazine à garder.',
    groups: [
      {
        head: 'Produit',
        items: [
          { label: 'Créer un livre photo', href: '#homepage-composer' },
          { label: 'Comment ça marche', href: '#features' },
          { label: 'Ce que vous obtenez', href: '#outputs' },
          { label: 'Tarifs', href: '/pricing' },
        ],
      },
      {
        head: 'Livres photo',
        items: [
          { label: 'Exemple de livre photo de voyage', href: '/examples/travel-journal' },
          { label: 'Exemple de livre de récit de vie', href: '/examples/life-story' },
          { label: 'Tous les exemples', href: '/examples' },
          { label: 'Guides du livre photo', href: '/guides' },
        ],
      },
      {
        head: 'Aide',
        items: [
          { label: 'FAQ', href: '#faq' },
          { label: 'Nous contacter', href: `mailto:${SUPPORT_EMAIL}` },
        ],
      },
      {
        head: 'À propos',
        items: [{ label: 'Notre histoire', href: '/about/story' }],
      },
      {
        head: 'Mentions légales',
        items: [
          { label: 'Confidentialité', href: '/privacy' },
          { label: 'Conditions', href: '/terms' },
        ],
      },
    ],
    copy: '© 2026 Yujee. Tous droits réservés.',
  },
};
