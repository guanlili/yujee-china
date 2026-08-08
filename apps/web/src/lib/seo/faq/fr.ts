import {
  FREE_PLAN_CREDITS,
  PAGES_PER_CREDIT_LABEL,
  PHOTOS_PER_CREDIT,
} from '@/config/pricing';
import type { FaqEntry } from './types';

export const FR: readonly FaqEntry[] = [
  // Questions are phrased the way people actually search ("créer un livre photo",
  // "mise en page livre photo") so the page and its FAQPage JSON-LD match real
  // queries. Facts must stay identical to the product — only the wording carries
  // keywords.
  {
    q: 'Faut-il savoir faire du design pour créer un livre photo ?',
    a: 'Pas du tout. Vous choisissez les photos, et le créateur de livre photo par IA s’occupe de la mise en page, du regroupement et d’un premier jet des légendes. Chaque page reste modifiable — vous mettez les mains dedans autant que vous le voulez.',
  },
  {
    q: 'Dans quel format mon livre photo est-il exporté ?',
    a: 'Un PDF prêt à imprimer en 300 DPI — à télécharger, à partager, ou à envoyer directement à un imprimeur pour faire imprimer et relier votre livre photo.',
  },
  {
    q: 'Mes photos sont-elles privées et en sécurité ?',
    a: 'Vos photos originales ne sont jamais envoyées : seuls des aperçus compressés partent vers l’IA pour préparer la mise en page. Nos serveurs conservent vos données de mise en page ainsi que le PDF et la couverture que vous exportez, pour que vous puissiez rouvrir et retélécharger votre livre à tout moment. Vos albums ne sont visibles que par vous et ne sont jamais rendus publics.',
  },
  {
    q: 'Combien de temps faut-il pour créer un livre photo ?',
    a: 'Quelques minutes après l’import, vous obtenez un brouillon feuilletable de votre livre, mis en page automatiquement comme un magazine. Vous peaufinez ensuite aussi longtemps que vous voulez — tout est enregistré au fur et à mesure.',
  },
  {
    q: 'Puis-je modifier la mise en page ou ajouter des photos plus tard ?',
    a: 'Oui. Chaque page est modifiable et vous pouvez ajouter de nouvelles photos quand vous voulez — un livre souvenir comme un album de naissance est fait pour continuer à grandir.',
  },
  {
    // Reworded, not added: an "Is Yujee free to use?" entry alongside this one
    // would be two questions with one answer. The grant is interpolated so the
    // claim can never outlive the constant.
    q: 'Yujee est-il un créateur de livre photo gratuit ?',
    a: `Oui, pour commencer. L’inscription vous offre ${FREE_PLAN_CREDITS} crédits gratuits — de quoi faire un livre photo entier, de la couverture à la dernière page. 1 crédit = ${PHOTOS_PER_CREDIT} photo${PHOTOS_PER_CREDIT === 1 ? '' : 's'}, et un livre photo fait en général ${PAGES_PER_CREDIT_LABEL} pages. Sans abonnement.`,
  },
];
