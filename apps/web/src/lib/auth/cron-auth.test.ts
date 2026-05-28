import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { matchesCronSecret } from './cron-auth';

const SECRET = 'cron-secret-abc123';

function req(init: { auth?: string; query?: string } = {}): Request {
  const url = `https://yujeeai.com/api/v1/admin/recover-stuck${init.query ?? ''}`;
  return new Request(url, {
    headers: init.auth ? { authorization: init.auth } : {},
  });
}

describe('matchesCronSecret', () => {
  it('authorizes a Vercel cron Bearer header', () => {
    assert.equal(matchesCronSecret(req({ auth: `Bearer ${SECRET}` }), SECRET), true);
  });

  it('authorizes a ?secret= query match (manual curl)', () => {
    assert.equal(matchesCronSecret(req({ query: `?secret=${SECRET}` }), SECRET), true);
  });

  it('rejects a wrong bearer token', () => {
    assert.equal(matchesCronSecret(req({ auth: 'Bearer nope' }), SECRET), false);
  });

  it('rejects a wrong query secret', () => {
    assert.equal(matchesCronSecret(req({ query: '?secret=nope' }), SECRET), false);
  });

  it('rejects a request with no credentials', () => {
    assert.equal(matchesCronSecret(req(), SECRET), false);
  });

  it('never authorizes when the configured secret is unset (dev)', () => {
    assert.equal(matchesCronSecret(req({ auth: 'Bearer ' }), undefined), false);
    assert.equal(matchesCronSecret(req({ auth: 'Bearer ' }), ''), false);
  });
});
