import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { db } from '@/db/client';
import * as schema from '@/db/schema';
import { sendEmail } from '@/lib/email/send-email';
import { renderVerificationEmail } from '@/lib/email/templates';
import { env } from '@/lib/env';
import { FREE_PLAN_CREDITS } from '@/config/pricing';
import { generateAppleClientSecret, getAppleCredentials } from './apple-client-secret';

type SchemaModule = Record<string, unknown>;
type BetterAuthSchema = {
  user: unknown;
  session: unknown;
  account: unknown;
  verification: unknown;
};

const requiredTableExports = ['users', 'sessions', 'accounts', 'verifications'] as const;
// 本地开发的可信来源。**https 变体必须一起列**:移动端真机调试要走
// `next dev --experimental-https`(iOS 上非 secure context 连 crypto.randomUUID
// 都没有),页面因此是 https://localhost:3000。而 better-auth 只在请求带 cookie 时
// 强制 CSRF origin 校验 —— 于是「干净浏览器能登、有过期 cookie 的浏览器 403」,
// 报错还只写在服务端日志里,前端看着就是「点了登录没反应」。之前只列 http,
// 一开 https 本地登录就废。
const LOCAL_TRUSTED_ORIGINS = [
  'http://localhost:3000',
  'https://localhost:3000',
  'http://127.0.0.1:3000',
  'https://127.0.0.1:3000',
  'http://localhost:3210',
  'https://localhost:3210',
  'http://127.0.0.1:3210',
  'https://127.0.0.1:3210',
];

export function getBetterAuthSchema(schemaModule: Partial<SchemaModule>): BetterAuthSchema {
  const missing = requiredTableExports.filter((key) => !schemaModule[key]);
  if (missing.length > 0) {
    throw new Error(`Missing better-auth tables from B2 schema: ${missing.join(', ')}`);
  }

  return {
    user: schemaModule.users,
    session: schemaModule.sessions,
    account: schemaModule.accounts,
    verification: schemaModule.verifications,
  };
}

export function buildSocialProviders(): BetterAuthOptions['socialProviders'] {
  const providers: NonNullable<BetterAuthOptions['socialProviders']> = {};

  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    providers.google = {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    };
  }

  const appleCreds = getAppleCredentials();
  if (appleCreds) {
    // clientSecret is the ES256 JWT we mint from the .p8 (see apple-client-secret.ts).
    providers.apple = {
      clientId: appleCreds.clientId,
      clientSecret: generateAppleClientSecret(appleCreds),
    };
  }

  return Object.keys(providers).length > 0 ? providers : undefined;
}

export function createAuthOptions(schemaModule: SchemaModule = schema): BetterAuthOptions {
  return {
    baseURL: env.WEB_BASE_URL,
    // Apple posts its callback from appleid.apple.com (response_mode=form_post);
    // that cross-site origin must be trusted for the callback to be accepted.
    trustedOrigins: [...LOCAL_TRUSTED_ORIGINS, 'https://appleid.apple.com'],
    basePath: '/api/auth',
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: getBetterAuthSchema(schemaModule),
      transaction: true,
    }),
    plugins: [nextCookies()],
    socialProviders: buildSocialProviders(),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        const email = renderVerificationEmail({
          locale: 'en',
          name: user.name ?? user.email,
          actionUrl: url,
        });
        await sendEmail({ to: user.email, ...email });
      },
    },
    user: {
      additionalFields: {
        isAdmin: {
          type: 'boolean',
          required: false,
          defaultValue: false,
          input: false,
        },
        creditBalance: {
          type: 'number',
          required: false,
          // New users get the free-plan welcome credits. Under per-photo billing
          // (1 credit = 1 photo) that is FREE_PLAN_CREDITS = 20, enough for a full
          // ~20-photo starter book. (Recording this as a SIGNUP_BONUS ledger row is
          // a follow-up — it needs the user committed, which conflicts with the
          // adapter's create transaction.)
          defaultValue: FREE_PLAN_CREDITS,
          input: false,
        },
      },
    },
    session: {
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60,
      },
    },
  };
}

export function createAuth() {
  return betterAuth(createAuthOptions());
}

let authInstance: ReturnType<typeof createAuth> | null = null;

export function getAuth(): ReturnType<typeof createAuth> {
  authInstance ??= createAuth();
  return authInstance;
}
