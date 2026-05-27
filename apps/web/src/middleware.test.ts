import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getAuthRedirect, isProtectedPath } from './middleware';

describe('middleware routing decisions', () => {
  it('protects localized tool and dashboard routes', () => {
    assert.equal(isProtectedPath('/create'), true);
    assert.equal(isProtectedPath('/album/demo'), true);
    assert.equal(isProtectedPath('/my-albums'), true);
    assert.equal(isProtectedPath('/login'), false);
  });

  it('redirects anonymous protected requests to the locale login page', () => {
    assert.deepEqual(getAuthRedirect('/zh/create', false), {
      pathname: '/zh/login',
      from: '/zh/create',
    });
  });

  it('does not redirect removed legacy routes', () => {
    assert.equal(getAuthRedirect('/text-to-video', false), null);
    assert.equal(getAuthRedirect('/dashboard', false), null);
  });
});
