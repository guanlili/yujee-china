import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as middleware from './middleware';

const { getAuthRedirect, isProtectedPath } = middleware;

describe('middleware routing decisions', () => {
  it('protects localized tool and dashboard routes', () => {
    assert.equal(isProtectedPath('/album/demo'), true);
    assert.equal(isProtectedPath('/my-albums'), true);
    assert.equal(isProtectedPath('/credits'), true);
    assert.equal(isProtectedPath('/login'), false);
  });

  it('redirects anonymous protected requests to the locale login page', () => {
    assert.deepEqual(getAuthRedirect('/zh/my-albums', false), {
      pathname: '/zh/login',
      from: '/zh/my-albums',
    });
  });

  it('does not redirect removed legacy routes', () => {
    assert.equal(getAuthRedirect('/text-to-video', false), null);
    assert.equal(getAuthRedirect('/dashboard', false), null);
    // /create was removed — creation now funnels straight into /album.
    assert.equal(getAuthRedirect('/create', false), null);
    assert.equal(isProtectedPath('/create'), false);
  });

  it('permanently redirects the bare apex to the default locale', () => {
    // Must be a 308, not next-intl's 307 — Bing keeps a temporarily-redirected
    // URL in its index, which made / and /en duplicate title/description pairs.
    assert.equal(middleware.getRootRedirect('/'), '/en');
    assert.equal(middleware.getRootRedirect('/en'), null);
    assert.equal(middleware.getRootRedirect('/zh'), null);
    assert.equal(middleware.getRootRedirect('/about'), null);
  });

  it('redirects the removed /create route to the live homepage composer', () => {
    assert.equal(typeof middleware.getLegacyRedirect, 'function');
    assert.deepEqual(middleware.getLegacyRedirect('/create'), {
      pathname: '/en',
      hash: '#homepage-composer',
    });
    assert.deepEqual(middleware.getLegacyRedirect('/zh/create'), {
      pathname: '/zh',
      hash: '#homepage-composer',
    });
  });
});
