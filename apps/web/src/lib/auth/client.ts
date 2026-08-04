'use client';

import { createAuthClient } from 'better-auth/react';
import { anonymousClient } from 'better-auth/client/plugins';

export const authClient = createAuthClient({
  baseURL: typeof window === 'undefined' ? undefined : window.location.origin,
  // 游客模式:signIn.anonymous() 静默建影子账号(落地页点「发送」时调)。
  plugins: [anonymousClient()],
});

export const { signIn, signOut, signUp, useSession, getSession } = authClient;
