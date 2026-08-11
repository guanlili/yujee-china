import type { EmailCopy } from './types';

export const zh: EmailCopy = {
  verification: {
    subject: '验证你的 Yujee 邮箱',
    title: '验证你的邮箱',
    greeting: (name: string) => `你好 ${name}，`,
    body: '欢迎使用 Yujee。请确认你的邮箱地址以完成账户设置。',
    button: '验证邮箱',
    validity: '此链接即将过期，且只能使用一次。',
    fallback: '如果按钮无法打开，请复制以下链接到浏览器：',
    ignore: '如果你没有注册 Yujee，可以忽略这封邮件。',
  },
  order: {
    subject: 'Yujee 订单确认',
    title: '订单已确认',
    body: '你的 Yujee 订单已支付完成。',
    orderId: '订单号',
    amount: '金额',
    album: '相册',
    button: '查看相册',
    footer: '请保留这封邮件作为收据。',
  },
};
