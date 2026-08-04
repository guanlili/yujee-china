'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { localizePath, type Locale } from '@/lib/i18n/routing';
import { useChromeSession } from './useChromeSession';

// 页面级游客门禁:middleware 只看 cookie 存在性,匿名影子账号的 session 天然放行 ——
// 账号页(设置/积分/我的相册)对游客没意义(临时邮箱/零积分),识别 isAnonymous
// 后带回跳丢去登录;登录成功即转正过户,from 把用户带回原页。
export function useAnonymousRedirect(locale: Locale, from: string): void {
  const router = useRouter();
  const { user, loading } = useChromeSession();
  useEffect(() => {
    if (loading) return;
    if (user?.isAnonymous) {
      router.replace(localizePath(`/login?from=${encodeURIComponent(from)}`, locale));
    }
  }, [loading, user, router, locale, from]);
}
