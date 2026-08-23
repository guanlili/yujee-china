import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { renderOrderReceiptEmail } from './order-receipt';
import { renderPasswordResetEmail } from './password-reset';
import { renderVerificationEmail } from './verification';

describe('email templates', () => {
  it('renders a localized verification email with the provided action URL', () => {
    const email = renderVerificationEmail({
      locale: 'en',
      name: 'Ava',
      actionUrl: 'https://yujeeai.com/api/auth/verify-email?token=abc',
    });

    assert.equal(email.subject, 'Verify your Yujee email');
    assert.match(email.html, /Ava/);
    assert.match(email.html, /https:\/\/yujeeai\.com\/api\/auth\/verify-email\?token=abc/);
    assert.match(email.text, /Verify your email/);
  });

  it('renders a Chinese order receipt with amount and order id', () => {
    const email = renderOrderReceiptEmail({
      locale: 'zh',
      orderId: 'ord_123',
      amountLabel: '$19.00',
      albumTitle: 'Family Spring',
      receiptUrl: 'https://yujeeai.com/zh/my-albums',
    });

    assert.equal(email.subject, 'Yujee 订单确认');
    assert.match(email.html, /ord_123/);
    assert.match(email.html, /\$19\.00/);
    assert.match(email.text, /Family Spring/);
  });

  it('renders a localized password reset email with the reset URL', () => {
    const email = renderPasswordResetEmail({
      locale: 'en',
      name: 'Ava',
      actionUrl: 'https://yujeeai.com/api/auth/reset-password/tok?callbackURL=%2Fen%2Freset-password',
    });

    assert.equal(email.subject, 'Reset your Yujee password');
    assert.match(email.html, /Ava/);
    assert.match(email.html, /reset-password\/tok/);
    // The URL carries a query string — it must survive HTML escaping intact.
    assert.match(email.html, /callbackURL=%2Fen%2Freset-password/);
    assert.match(email.text, /Reset your password/);
  });

  it('renders the password reset email in the requested locale', () => {
    const email = renderPasswordResetEmail({
      locale: 'zh',
      name: null,
      actionUrl: 'https://yujeeai.com/api/auth/reset-password/tok?callbackURL=%2Fzh%2Freset-password',
    });

    assert.equal(email.subject, '重置你的 Yujee 密码');
    assert.match(email.text, /重置密码/);
  });
});
