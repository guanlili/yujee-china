// TODO(i18n-translate): placeholder copy of en, to be replaced
import type { EmailCopy } from './types';

export const es: EmailCopy = {
  verification: {
    subject: 'Verify your Yujee email',
    title: 'Verify your email',
    greeting: (name: string) => `Hi ${name},`,
    body: 'Welcome to Yujee. Confirm your email address to finish setting up your account.',
    button: 'Verify email',
    validity: 'This link expires soon and can only be used once.',
    fallback: 'If the button does not work, paste this link into your browser:',
    ignore: 'If you did not create a Yujee account, you can ignore this email.',
  },
  order: {
    subject: 'Yujee order confirmation',
    title: 'Order confirmed',
    body: 'Your Yujee order is paid and ready.',
    orderId: 'Order ID',
    amount: 'Amount',
    album: 'Album',
    button: 'View album',
    footer: 'Keep this email as your receipt.',
  },
};
