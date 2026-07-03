function normalizeLocalPath(value: string | undefined): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return null;
  try {
    const url = new URL(value, 'https://yujee.local');
    if (url.origin !== 'https://yujee.local') return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

export function safeAuthRedirect(from: string | undefined, fallback: string): string {
  return normalizeLocalPath(from) ?? normalizeLocalPath(fallback) ?? '/';
}

export function authHrefWithFrom(path: string, from: string | undefined): string {
  const safeFrom = normalizeLocalPath(from);
  if (!safeFrom) return path;
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}from=${encodeURIComponent(safeFrom)}`;
}
