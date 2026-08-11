import type { EmailCopy } from './types';

export const ja: EmailCopy = {
  verification: {
    subject: 'Yujee のメールアドレスをご確認ください',
    title: 'メールアドレスの確認',
    greeting: (name: string) => `${name} さん、こんにちは。`,
    body: 'Yujee へようこそ。メールアドレスを確認して、アカウントの設定を完了してください。',
    button: 'メールアドレスを確認',
    validity: 'このリンクはまもなく期限が切れ、一度しかご利用いただけません。',
    fallback: 'ボタンが動かないときは、次のリンクをブラウザに貼り付けてください：',
    ignore: 'Yujee のアカウントを作成した覚えがない場合は、このメールは破棄してください。',
  },
  order: {
    subject: 'Yujee ご注文の確認',
    title: 'ご注文を確認しました',
    body: 'Yujee のご注文はお支払いが完了し、ご利用いただける状態です。',
    orderId: '注文番号',
    amount: '金額',
    album: 'アルバム',
    button: 'アルバムを見る',
    footer: 'このメールは領収書として保管してください。',
  },
};
