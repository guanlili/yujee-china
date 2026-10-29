'use client';

// 导航栏的更新日志徽标:有未读时显示红点,点击跳 /changelog。
import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import Link from 'next/link';

export default function ChangelogBadge() {
  const locale = useLocale();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch('/api/v1/changelog/unread-count');
        if (res.ok) {
          const json = await res.json();
          if (!cancelled && json.ok) setUnread(json.data.count);
        }
      } catch { /* 静默 */ }
    };
    void check();
    const timer = setInterval(check, 30_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  if (unread === 0) return null;

  return (
    <Link
      href={`/${locale}/changelog`}
      className="relative inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
      title={locale === 'zh' ? `${unread} 条新更新` : `${unread} new updates`}
    >
      📋 {unread > 9 ? '9+' : unread}
      <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-red-500" />
    </Link>
  );
}
