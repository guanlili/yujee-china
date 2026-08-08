import type { EmailCopy } from './types';

export const fr: EmailCopy = {
  verification: {
    subject: 'Vérifiez votre adresse e-mail Yujee',
    title: 'Vérifiez votre adresse e-mail',
    greeting: (name: string) => `Bonjour ${name},`,
    body: 'Bienvenue sur Yujee. Confirmez votre adresse e-mail pour finaliser la création de votre compte.',
    button: 'Vérifier l’e-mail',
    validity: 'Ce lien expire bientôt et ne peut être utilisé qu’une seule fois.',
    fallback: 'Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :',
    ignore: 'Si vous n’avez pas créé de compte Yujee, vous pouvez ignorer cet e-mail.',
  },
  order: {
    subject: 'Confirmation de commande Yujee',
    title: 'Commande confirmée',
    body: 'Votre commande Yujee est payée et prête.',
    orderId: 'N° de commande',
    amount: 'Montant',
    album: 'Album',
    button: 'Voir l’album',
    footer: 'Conservez cet e-mail, il vous sert de reçu.',
  },
};
