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
  passwordReset: {
    subject: 'Yujee のパスワード再設定',
    title: 'パスワードの再設定',
    greeting: (name: string) => `${name} さん、こんにちは。`,
    body: 'Yujee アカウントのパスワードを再設定するリクエストを受け付けました。下のボタンから新しいパスワードを設定してください。',
    button: '新しいパスワードを設定',
    validity: 'このリンクは 1 時間で期限が切れ、一度しかご利用いただけません。',
    fallback: 'ボタンが動かないときは、次のリンクをブラウザに貼り付けてください：',
    ignore: 'お心当たりがない場合は、このメールを破棄してください。パスワードは変更されません。',
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
