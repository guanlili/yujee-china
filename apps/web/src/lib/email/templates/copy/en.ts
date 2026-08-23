import type { EmailCopy } from './types';

export const en: EmailCopy = {
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
  passwordReset: {
    subject: 'Reset your Yujee password',
    title: 'Reset your password',
    greeting: (name: string) => `Hi ${name},`,
    body: 'We received a request to set a new password for your Yujee account. Use the button below to choose one.',
    button: 'Set a new password',
    validity: 'This link expires in one hour and can only be used once.',
    fallback: 'If the button does not work, paste this link into your browser:',
    ignore: 'If you did not ask to reset your password, you can ignore this email — your password stays as it is.',
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
