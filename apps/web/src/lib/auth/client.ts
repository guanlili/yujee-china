'use client';

import { createAuthClient } from 'better-auth/react';
import { anonymousClient, phoneNumberClient } from 'better-auth/client/plugins';

export const authClient = createAuthClient({
  baseURL: typeof window === 'undefined' ? undefined : window.location.origin,
  // 游客模式:signIn.anonymous() 静默建影子账号(落地页点「发送」时调)。
  // 手机号:signIn.phoneNumber({ phoneNumber, password })(免验证期)。
  // 找回:phoneNumber.requestPasswordReset({ phoneNumber }) 与
  // phoneNumber.resetPassword({ phoneNumber, otp, newPassword })。
  // 注册走 POST /api/auth/phone-signup(自定义端点,直接 fetch,同源带 cookie)。
  plugins: [anonymousClient(), phoneNumberClient()],
});

export const { signIn, signOut, signUp, useSession, getSession } = authClient;
