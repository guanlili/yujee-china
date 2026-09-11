import createMiddleware from 'next-intl/middleware';
import { type NextRequest, NextResponse } from 'next/server';
import { detectLocale, localizePath, routing, stripLocale } from '@/lib/i18n/routing';

/** hreflang headers are off at the routing config — see routing.ts for why. */
const intlMiddleware = createMiddleware(routing);

const protectedPaths = ['/album', '/my-albums', '/credits', '/settings', '/admin'];

export type AuthRedirect = {
  pathname: string;
  from: string;
};

export type LegacyRedirect = {
  pathname: string;
  hash: string;
};

export function isProtectedPath(pathnameWithoutLocale: string): boolean {
  return protectedPaths.some(
    (path) => pathnameWithoutLocale === path || pathnameWithoutLocale.startsWith(`${path}/`),
  );
}

/**
 * `/` always lands on the default locale: localeDetection is off, and the
 * locale cookie never changes the target. next-intl performs this hop as a
 * 307, which tells search engines the move is temporary — Bing then keeps the
 * bare apex in its index and reports / and /en as duplicate title/description
 * pairs. Handling it ourselves lets the redirect be a 308.
 */
export function getRootRedirect(pathname: string): string | null {
  return pathname === '/' ? localizePath('/', routing.defaultLocale) : null;
}

export function getLegacyRedirect(pathname: string): LegacyRedirect | null {
  if (stripLocale(pathname) !== '/create') return null;

  return {
    pathname: localizePath('/', detectLocale(pathname)),
    hash: '#homepage-composer',
  };
}

export function getAuthRedirect(pathname: string, hasSession: boolean): AuthRedirect | null {
  const pathnameWithoutLocale = stripLocale(pathname);
  if (!isProtectedPath(pathnameWithoutLocale) || hasSession) return null;

  const locale = detectLocale(pathname);
  const from = pathname === pathnameWithoutLocale
    ? localizePath(pathnameWithoutLocale, locale)
    : pathname;

  return {
    pathname: localizePath('/login', locale),
    from,
  };
}

function hasSessionCookie(request: NextRequest): boolean {
  return (
    request.cookies.has('better-auth.session_token') ||
    request.cookies.has('__Secure-better-auth.session_token')
  );
}

function withSecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  return response;
}

export default function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const chapterPath = stripLocale(pathname);
  if (/^\/(pet|travel|palace)(?:\/|$)/.test(chapterPath)) {
    if (/^\/(pet|travel|palace)\/?$/.test(pathname)) {
      const url = request.nextUrl.clone();
      url.pathname = localizePath(pathname.replace(/\/$/, ''), routing.defaultLocale);
      return withSecurityHeaders(NextResponse.redirect(url, 307));
    }
    return withSecurityHeaders(NextResponse.next());
  }
  if (pathname.startsWith('/chapters/')) return withSecurityHeaders(NextResponse.next());
  const rootTarget = getRootRedirect(pathname);
  if (rootTarget) {
    const url = request.nextUrl.clone();
    url.pathname = rootTarget;
    return withSecurityHeaders(NextResponse.redirect(url, 308));
  }

  const legacy = getLegacyRedirect(request.nextUrl.pathname);
  if (legacy) {
    const url = request.nextUrl.clone();
    url.pathname = legacy.pathname;
    url.hash = legacy.hash;
    return withSecurityHeaders(NextResponse.redirect(url));
  }

  const redirect = getAuthRedirect(request.nextUrl.pathname, hasSessionCookie(request));
  if (redirect) {
    const url = request.nextUrl.clone();
    url.pathname = redirect.pathname;
    url.searchParams.set('from', redirect.from);
    return NextResponse.redirect(url);
  }

  return withSecurityHeaders(intlMiddleware(request));
}

export const config = {
  matcher: ['/', '/((?!api|_next|.*\\..*).*)'],
};
