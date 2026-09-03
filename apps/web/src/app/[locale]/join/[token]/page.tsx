'use client';

// 协同编辑邀请落地页(collab plan §7.2/§15.1)。流程:
//   未登录 / 匿名游客 → 跳登录(成功后自动回到这里 redeem);
//   已登录真实账号 → redeem token → 跳相册编辑器,自动成为 editor。
// 后端 redeem 用 requireRealUser:匿名影子账号会 403 ANON_UPGRADE_REQUIRED,
// 所以前端对匿名也先送登录/转正。

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useChromeSession } from '@/components/app/useChromeSession';
import { CollabClientError, redeemEditLink } from '@/lib/collaboration/collaboration-client';
import { authHrefWithFrom } from '@/lib/auth/redirect';
import { boundPick } from '@/lib/i18n/pick';

type State =
  | { kind: 'loading' }
  | { kind: 'redirect-login' }
  // retryable:相册正在跑生成(CHAT_BUSY)或网络抖动 —— 稍后重试就好,不该把人
  // 支去找 owner 要新链接(新链接同样会被拒)。
  | { kind: 'error'; title: string; message: string; retryable: boolean };

export default function JoinPage() {
  const params = useParams<{ locale: string; token: string }>();
  const router = useRouter();
  const session = useChromeSession();
  const aT = boundPick(params.locale as never);
  const [state, setState] = useState<State>({ kind: 'loading' });
  const redeemed = useRef(false);

  useEffect(() => {
    if (session.loading || state.kind === 'redirect-login' || redeemed.current) return;

    // 未登录 或 匿名游客:先登录/转正,成功后回到本页自动 redeem。
    if (!session.user || session.user.isAnonymous) {
      setState({ kind: 'redirect-login' });
      const from = `/${params.locale}/join/${params.token}`;
      router.replace(authHrefWithFrom(`/${params.locale}/login`, from));
      return;
    }

    // 已登录真实账号:redeem 一次(幂等),成功后跳相册。
    redeemed.current = true;
    redeemEditLink(params.token)
      .then(({ albumId }) => {
        router.replace(`/${params.locale}/album/${albumId}`);
      })
      .catch((e: unknown) => {
        // 按 code 分支:把「稍等就好」和「这链接废了」分开 —— 一律说成已撤销会
        // 让正在生成中的相册的受邀人跑去要新链接,而新链接同样会被 CHAT_BUSY 拒。
        const code = e instanceof CollabClientError ? e.code : null;
        if (code === 'CHAT_BUSY') {
          // 失败后允许再试:redeemed 复位,否则不刷新页面就永远重试不了。
          redeemed.current = false;
          setState({
            kind: 'error',
            title: aT('相册正在生成中', 'This album is still generating'),
            message: aT(
              '等这本书生成完就能加入了，稍后再打开这个链接。',
              'You can join once the book finishes generating. Open this link again in a moment.',
            ),
            retryable: true,
          });
          return;
        }
        if (code === 'EDIT_LINK_NOT_FOUND') {
          setState({
            kind: 'error',
            title: aT('邀请链接无效或已失效', 'This invitation is invalid or expired'),
            message: aT(
              '这个邀请可能已被撤销，请联系相册所有者获取新链接。',
              'This invitation may have been revoked. Ask the album owner for a new link.',
            ),
            retryable: false,
          });
          return;
        }
        // 其余(网络抖动、5xx 等):不下「已撤销」的结论,让用户重试。
        redeemed.current = false;
        setState({
          kind: 'error',
          title: aT('没能加入这本书', 'Could not join this book'),
          message: aT('网络或服务出了点问题，请重试。', 'Something went wrong. Please try again.'),
          retryable: true,
        });
      });
  }, [session.loading, session.user, params.locale, params.token, router, state.kind]);

  if (state.kind === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg px-5">
        <div className="text-center">
          <p className="mb-3 text-[15px] font-semibold text-fg">{state.title}</p>
          <p className="text-[13px] text-muted">{state.message}</p>
          {state.retryable ? (
            <button
              type="button"
              onClick={() => setState({ kind: 'loading' })}
              className="mt-5 rounded-pill bg-fg px-5 py-2.5 text-[13px] font-semibold text-white"
            >
              {aT('重试', 'Try again')}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => router.replace(`/${params.locale}`)}
            className={`mt-5 rounded-pill px-5 py-2.5 text-[13px] font-semibold ${
              state.retryable ? 'ml-2 bg-line text-fg' : 'bg-fg text-white'
            }`}
          >
            {aT('返回首页', 'Back to home')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-5">
      <p className="text-[15px] text-muted">{aT('正在接受邀请…', 'Accepting invitation…')}</p>
    </div>
  );
}
