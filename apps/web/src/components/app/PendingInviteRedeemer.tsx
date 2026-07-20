'use client';

import { useEffect, useState } from 'react';
import { getMessages } from '@/lib/i18n/messages';
import type { Locale } from '@/lib/i18n/routing';
import { clearPendingInvite, takePendingInvite } from '@/lib/invite/pending-invite';

// 一次性错误:码本身没法兑(无效/过期/已兑/用尽/校验失败/无权),清掉别再重试,
// 也别打扰新用户。UNAUTHORIZED / 网络错误不在此列 → 保留码,下次进 app 再试。
const PERMANENT_ERROR_CODES = new Set([
  'INVITE_CODE_INVALID',
  'INVITE_CODE_EXPIRED',
  'INVITE_CODE_USED',
  'INVITE_CODE_EXHAUSTED',
  'VALIDATION_FAILED',
  'FORBIDDEN',
]);

// 登录后自动兑换注册时暂存的邀请码。挂在登录后落地页(my-albums),用户一进来
// 就静默兑换,成功弹一个可点掉的到账提示。失败不打扰(除非是可重试的临时错误)。
export function PendingInviteRedeemer({ locale }: { locale: Locale }) {
  const t = getMessages(locale).dashboard.settings;
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const code = takePendingInvite();
    if (!code) return;

    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/v1/invite/redeem', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        });
        const json = await res.json();
        if (json.ok) {
          clearPendingInvite();
          if (!active) return;
          setToast(
            t.inviteSuccess
              .replace('{credits}', String(json.data.credits))
              .replace('{balance}', String(json.data.balance)),
          );
        } else if (PERMANENT_ERROR_CODES.has(json.error?.code)) {
          clearPendingInvite();
        }
        // 其余(UNAUTHORIZED / 会话未就绪)保留码,下次进 app 再兑。
      } catch {
        // 网络异常:保留码,下次重试。
      }
    })();

    return () => {
      active = false;
    };
    // 仅在挂载时跑一次;locale 在本组件生命周期内不变,t 用闭包即可。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!toast) return null;
  return (
    <div className="fixed inset-x-0 bottom-6 z-[90] flex justify-center px-4" role="status">
      <button
        type="button"
        onClick={() => setToast(null)}
        className="pointer-events-auto flex items-center gap-2 rounded-full bg-[var(--fg)] px-5 py-3 text-[14px] font-semibold text-white shadow-[0_8px_24px_rgba(0,0,0,0.22)] transition hover:-translate-y-0.5"
      >
        <span aria-hidden="true">🎉</span>
        <span>{toast}</span>
      </button>
    </div>
  );
}
