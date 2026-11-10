import createMiddleware from 'next-intl/middleware';

// ── IP 级 API 限流(2026-10-30)────────────────────────────────────────
// 单机生产无 WAF/CDN,公开 API 裸奔。对高频攻击面加内存滑动窗口限流;
// 单实例部署,不需要 Redis。命中限流返回 429 + Retry-After。
const RATE_LIMITS: Array<{ prefix: string; limit: number; windowMs: number }> = [
  { prefix: '/api/auth', limit: 10, windowMs: 60_000 },
  { prefix: '/api/v1/changelog', limit: 60, windowMs: 60_000 },
  { prefix: '/api/', limit: 120, windowMs: 60_000 },
];

const rateStore = new Map<string, number[]>();

function getClientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

function checkRateLimit(pathname: string, ip: string): boolean {
  const rule = RATE_LIMITS.find((r) => pathname.startsWith(r.prefix));
  if (!rule) return true;
  const key = `${ip}:${rule.prefix}`;
  const now = Date.now();
  const times = (rateStore.get(key) ?? []).filter((t) => now - t < rule.windowMs);
  if (times.length >= rule.limit) return false;
  times.push(now);
  rateStore.set(key, times);
  if (rateStore.size > 10_000) {
    for (const [k, v] of rateStore) {
      if (v.every((t) => now - t > 120_000)) rateStore.delete(k);
    }
  }
  return true;
}
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

// ── CSP(2026-11-10)────────────────────────────────────────────
// 此前只有 HSTS/nosniff/X-Frame-Options/Referrer-Policy,没有 CSP。策略刻意
// 不带 default-src 与 frame-src:字体自托管(/fonts/*.woff2),图片与 PDF 走
// 同源 /api/v1/assets → 302 到 cos.ap-beijing.myqcloud.com,编辑器占位图用
// images.unsplash.com,邮件与生图全在服务端调用(NEXT_PUBLIC_ 里没有浏览器端
// 外部基址)。编辑器截图用 html2canvas 把页面克隆进同源 srcdoc iframe,设了
// frame-src 会连带限制它,所以不设。
// 这版收掉的是:被第三方页面嵌入(frame-ancestors,与 X-Frame-Options 双保险)、
// <base> 劫持、表单外发、object/embed 注入、外部脚本只能来自本站。
// 仍未收紧的是 script-src 的 'unsafe-inline'/'unsafe-eval':Next 15 的内联启动
// 脚本需要前者;强 CSP 要走 nonce,而本仓库先让 next-intl middleware 产出
// response,拿不到改写请求头注入 nonce 的时机。
const CONTENT_SECURITY_POLICY = [
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.myqcloud.com https://images.unsplash.com",
  "font-src 'self' data:",
  "connect-src 'self' https://*.myqcloud.com",
  "media-src 'self' blob: data:",
  "worker-src 'self' blob:",
].join('; ');

function withSecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  response.headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  return response;
}

export default function middleware(request: NextRequest) {
  // API 限流(2026-10-30):登录/注册 10/min、公开读 60/min、其他 API 120/min
  if (request.nextUrl.pathname.startsWith('/api/')) {
    if (!checkRateLimit(request.nextUrl.pathname, getClientIp(request))) {
      return new NextResponse(
        JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } }),
        { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '60' } },
      );
    }
  }
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
