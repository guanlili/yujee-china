import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { anonymous } from 'better-auth/plugins/anonymous';
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
import { parseSetCookieHeader } from 'better-auth/cookies';
import { and, eq, gte, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import * as schema from '@/db/schema';
import { anonTransferService } from '@/services/user/anon-transfer-service';
import { clientIpFrom } from '@/lib/api/client-ip';
import { ANON_SIGNUP_PER_IP_PER_HOUR } from '@/config/anon';
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

// 匿名注册限流:/sign-in/anonymous 每 IP 每小时 ANON_SIGNUP_PER_IP_PER_HOUR 次。
// 依据是 better-auth 自己写进 sessions.ip_address 的值(它默认从 x-forwarded-for 取),
// join users.is_anonymous 只数匿名 session。取不到 IP(本地 dev 无代理头)放行 ——
// 生产在 Vercel 后面必有转发头,另有 WAF 兜底。
export async function countRecentAnonSessionsByIp(ip: string, since: Date): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.sessions.userId, schema.users.id))
    .where(
      and(
        eq(schema.users.isAnonymous, true),
        eq(schema.sessions.ipAddress, ip),
        gte(schema.sessions.createdAt, since),
      ),
    );
  return rows[0]?.count ?? 0;
}

const throttleAnonymousSignIn = createAuthMiddleware(async (ctx) => {
  if (ctx.path !== '/sign-in/anonymous') return;
  const ip = clientIpFrom(ctx.headers ?? new Headers());
  if (!ip) return;
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const recent = await countRecentAnonSessionsByIp(ip, oneHourAgo);
  if (recent >= ANON_SIGNUP_PER_IP_PER_HOUR) {
    throw new APIError('TOO_MANY_REQUESTS', {
      message: 'Too many guest sessions from this address',
    });
  }
});

// 邮箱注册转正兜底:anonymous 插件的转正 matcher(dist/plugins/anonymous/index.mjs:118)
// 不含 /verify-email,而本仓 requireEmailVerification=true + autoSignInAfterVerification=true
// —— 邮箱注册的 session 是在点验证链接时才发的,插件的 onLinkAccount 在这条路上永远
// 不会触发。这里镜像插件 after-hook 的判定:响应真的种了 session cookie + 请求 cookie
// 里的旧 session 是匿名 → 过户相册并删除匿名用户。跨设备打开验证链接时旧 cookie 不在,
// 无法过户,由 7 天清理 cron 兜底(设计文档已知边界)。
const linkAnonymousOnVerifyEmail = createAuthMiddleware(async (ctx) => {
  if (ctx.path !== '/verify-email') return;
  const setCookie = ctx.context.responseHeaders?.get('set-cookie');
  const sessionTokenName = ctx.context.authCookies.sessionToken.name;
  if (!parseSetCookieHeader(setCookie || '').get(sessionTokenName)?.value.split('.')[0]) return;
  const oldSession = await getSessionFromCtx(ctx, { disableRefresh: true });
  const oldUser = oldSession?.user as ({ id: string; isAnonymous?: boolean | null }) | undefined;
  if (!oldSession || !oldUser?.isAnonymous) return;
  const newSession = ctx.context.newSession;
  if (!newSession || newSession.user.id === oldUser.id) return;
  await anonTransferService.transfer(oldUser.id, newSession.user.id);
  await ctx.context.internalAdapter.deleteUser(oldUser.id);
});

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
    // 顺序契约:anonymous 在前,nextCookies() 必须收尾(它是 set-cookie 的终段中间件;
    // anonymous 的转正 after-hook 要从 responseHeaders 里读 set-cookie)。
    plugins: [
      anonymous({
        onLinkAccount: async ({ anonymousUser, newUser }) => {
          // 在插件删除匿名用户之前过户,否则 albums 等 11 处 cascade 连锅端。
          await anonTransferService.transfer(anonymousUser.user.id, newUser.user.id);
        },
      }),
      nextCookies(),
    ],
    hooks: {
      before: throttleAnonymousSignIn,
      after: linkAnonymousOnVerifyEmail,
    },
    databaseHooks: {
      user: {
        create: {
          // 匿名账号不送注册赠礼:additionalFields.creditBalance 的 defaultValue(20)
          // 对 internalAdapter.createUser 无差别生效,这里按 isAnonymous 归零 ——
          // 否则脚本刷匿名账号 = 刷积分。真实注册不受影响(照旧拿 20)。
          before: async (user) => {
            if ((user as { isAnonymous?: boolean }).isAnonymous) {
              return { data: { ...user, creditBalance: 0 } };
            }
          },
        },
      },
    },
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
