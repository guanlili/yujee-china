import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { renderOrderReceiptEmail } from './order-receipt';
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
});
