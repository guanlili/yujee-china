import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { clientIpFrom } from './client-ip';

function headers(init: Record<string, string> = {}): Headers {
  return new Request('https://yujeeai.com/api/auth/sign-in/anonymous', { headers: init }).headers;
}

describe('clientIpFrom', () => {
  it('takes the first hop of x-forwarded-for', () => {
    assert.equal(clientIpFrom(headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' })), '203.0.113.7');
  });

  it('trims whitespace around the first hop', () => {
    assert.equal(clientIpFrom(headers({ 'x-forwarded-for': '  203.0.113.7 ,10.0.0.1' })), '203.0.113.7');
  });

  it('falls back to x-real-ip when x-forwarded-for is absent', () => {
    assert.equal(clientIpFrom(headers({ 'x-real-ip': '198.51.100.4' })), '198.51.100.4');
  });

  it('ignores an empty x-forwarded-for and still uses x-real-ip', () => {
    assert.equal(clientIpFrom(headers({ 'x-forwarded-for': ' ', 'x-real-ip': '198.51.100.4' })), '198.51.100.4');
  });

  it('returns null when no proxy headers exist', () => {
    assert.equal(clientIpFrom(headers()), null);
  });
});
