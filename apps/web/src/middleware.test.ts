import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NextRequest } from 'next/server';

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

  // next-intl ships `alternateLinks: true` by default, which makes the
  // middleware attach an hreflang Link: header enumerating routing.locales — it
  // is path-agnostic and cannot know that a guide exists in English only.
  //
  // Google treats the Link: header, the <head> tags and the sitemap as three
  // interchangeable ways of saying the same thing. Leaving the header on meant
  // one response asserted five languages in its header and one in its head, and
  // the header's x-default pointed at an unprefixed URL that is in neither
  // sitemap nor head. An hreflang cluster Google cannot reconcile gets
  // discounted site-wide, so this took the landing page down with it.
  //
  // Every indexable page emits real <link rel="alternate"> tags through
  // publicPageMetadata → localeAlternates, which narrows correctly. The header
  // was redundant even where it was accidentally true.
  it('never attaches an hreflang Link header — the head tags are the only cluster', async () => {
    for (const path of [
      '/en/guides/turn-old-family-photos-into-a-book',
      '/en',
      '/zh/examples',
    ]) {
      const response = await middleware.default(
        new NextRequest(new URL(path, 'https://yujeeai.com')),
      );
      const link = response.headers.get('link') ?? '';
      assert.ok(
        !link.includes('hreflang'),
        `${path} still advertises hreflang in a Link header: ${link}`,
      );
    }
  });
});
