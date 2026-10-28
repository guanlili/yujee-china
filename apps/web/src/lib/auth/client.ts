'use client';

import { createAuthClient } from 'better-auth/react';
import { anonymousClient, phoneNumberClient } from 'better-auth/client/plugins';

export const authClient = createAuthClient({
  baseURL: typeof window === 'undefined' ? undefined : window.location.origin,
  // 游客模式:signIn.anonymous() 静默建影子账号(落地页点「发送」时调)。
  // 手机号:signIn.phoneNumber({ phoneNumber, password })(密码登录);
  // 验证码登录 phoneNumber.sendOtp({ phoneNumber }) + phoneNumber.verify({ phoneNumber, code })
  //(verify 通过即置 phoneNumberVerified 并种会话,游客 session 由服务端并号)。
  // 找回:phoneNumber.requestPasswordReset({ phoneNumber }) 与
  // phoneNumber.resetPassword({ phoneNumber, otp, newPassword })。
  // 注册走 POST /api/auth/phone-signup(自定义端点,直接 fetch,同源带 cookie;
  // 发码用 POST /api/auth/phone-signup/send-otp,同样不在 client 插件面里)。
  plugins: [anonymousClient(), phoneNumberClient()],
});

export const { signIn, signOut, signUp, useSession, getSession } = authClient;
