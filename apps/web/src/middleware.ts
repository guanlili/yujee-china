import createMiddleware from 'next-intl/middleware';
import { type NextRequest, NextResponse } from 'next/server';
import { detectLocale, localizePath, routing, stripLocale } from '@/lib/i18n/routing';

const intlMiddleware = createMiddleware(routing);

const protectedPaths = ['/create', '/album', '/my-albums', '/credits', '/settings', '/admin'];

export type AuthRedirect = {
  pathname: string;
  from: string;
};

export function isProtectedPath(pathnameWithoutLocale: string): boolean {
  return protectedPaths.some(
    (path) => pathnameWithoutLocale === path || pathnameWithoutLocale.startsWith(`${path}/`),
  );
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
