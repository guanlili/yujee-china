import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { anonymous } from 'better-auth/plugins/anonymous';
import { phoneNumber as phoneNumberPlugin } from 'better-auth/plugins/phone-number';
import { APIError, createAuthEndpoint, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
import { parseSetCookieHeader, setSessionCookie } from 'better-auth/cookies';
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import * as schema from '@/db/schema';
import { anonTransferService } from '@/services/user/anon-transfer-service';
import { logger } from '@/lib/log/logger';
import { clientIpFrom } from '@/lib/api/client-ip';
import { ANON_SIGNUP_PER_IP_PER_HOUR } from '@/config/anon';
import { sendEmail } from '@/lib/email/send-email';
import { renderPasswordResetEmail, renderVerificationEmail } from '@/lib/email/templates';
import { sendSms } from '@/lib/sms/send-sms';
import { defaultLocale, detectLocale, type Locale } from '@/lib/i18n/routing';
import { env } from '@/lib/env';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '@/config/auth';
import { FREE_PLAN_CREDITS } from '@/config/pricing';
import { generateAppleClientSecret, getAppleCredentials } from './apple-client-secret';
import { normalizePhoneNumber } from './phone';

// re-export:归一的唯一真相在 ./phone(前后端共用),旧导入路径保持可用。
export { normalizePhoneNumber };

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

// ─── 手机号注册/登录(2026-10-28 起:短信 OTP 真实验证版)──────────────────────
// 演进:2026-10-27 免验证期(手机号+密码直接建号)→ 本批接入阿里云短信后,注册
// 强制 OTP 验证(建号即 phoneNumberVerified=true,终结免验证期),登录新增「验证码
// 登录」子模式(插件 /phone-number/send-otp + /phone-number/verify),密码登录保留。
// email 仍用 `{手机号}@phone.yujee.local` 占位且 emailVerified=true —— 这类账号
// 永远不收邮件,也不该被邮箱验证墙拦。验证码真实下发/回落在 lib/sms(sendOTP /
// sendPasswordResetOTP 两个回调 + 自定义注册发码端点),capture 模式沿用
// EMAIL_CAPTURE_FILE。requireVerification 保持全局关闭(D7):新号天然 verified,
// 存量号首次 OTP 登录时由 /phone-number/verify 自动转正,密码登录不设验证墙。
const PHONE_PLACEHOLDER_DOMAIN = 'phone.yujee.local';

// 与 phoneNumber 插件默认值钉同口径(otpLength=6 / expiresIn=300s / allowedAttempts=3):
// 自定义注册发码端点自己造 verification 行,格式必须与插件的 `${code}:${attempts}`
// 完全一致,否则 consumePhoneNumberOTP 验不了。
const PHONE_OTP_LENGTH = 6;
const PHONE_OTP_EXPIRES_IN_SECONDS = 300;

function generatePhoneOtp(): string {
  return String(randomInt(0, 10 ** PHONE_OTP_LENGTH)).padStart(PHONE_OTP_LENGTH, '0');
}

// phoneNumber 插件的内部 API:验码并消费,不发会话、不动用户。运行时挂在
// auth.api 上,但 createAuthOptions 的返回类型注解(BetterAuthOptions)把
// plugins 数组收窄成了泛型,infer 丢了插件端点 —— 这里用最小签名钉住契约
// (与 require-auth.ts 调 getSession、插件源码 routes.mjs 的实现对照)。
type ConsumePhoneNumberOtp = (input: {
  body: { phoneNumber: string; code: string };
}) => Promise<{ status: boolean }>;

function consumePhoneNumberOtp(phone: string, code: string): Promise<{ status: boolean }> {
  const api = getAuth().api as unknown as { consumePhoneNumberOTP: ConsumePhoneNumberOtp };
  return api.consumePhoneNumberOTP({ body: { phoneNumber: phone, code } });
}

// 同号 60s 一条(方案 §5.1 第①层):better-auth 的限流只有按 IP,换 IP 轰炸同号
// 拦不住 —— 直查 verifications 表该 identifier 最新一行,60s 内有新行即 429。
// 登录发码与注册发码共用 identifier=裸手机号,窗口天然共享。
const OTP_SEND_MIN_INTERVAL_MS = 60_000;

export async function lastOtpSentAt(identifier: string): Promise<Date | null> {
  const rows = await db
    .select({ createdAt: schema.verifications.createdAt })
    .from(schema.verifications)
    .where(eq(schema.verifications.identifier, identifier))
    .orderBy(desc(schema.verifications.createdAt))
    .limit(1);
  return rows[0]?.createdAt ?? null;
}

async function throttleOtpByPhone(phone: string): Promise<void> {
  const last = await lastOtpSentAt(phone);
  if (last && Date.now() - last.getTime() < OTP_SEND_MIN_INTERVAL_MS) {
    throw new APIError('TOO_MANY_REQUESTS', {
      message: 'Too many OTP requests for this phone number',
    });
  }
}

const yujeePhoneSignup = {
  id: 'yujee-phone-signup',
  endpoints: {
    /**
     * 注册发码(仅未注册号真实下发)。与登录发码(插件 /phone-number/send-otp,
     * 仅已注册号真实下发)互为镜像 —— 同一号码在两种流程里的「该不该收到码」
     * 状态相反,必须分开两个端点各自把关,共用同号 60s 窗口与同一 verification
     * identifier,防换端点绕过限频。
     * 已注册号:静默 200 不发码不烧钱(防枚举,与 D1 登录侧短路同款语义);提交
     * 注册时自然会拿到 PHONE_ALREADY_REGISTERED 冲突面板。
     */
    sendPhoneSignupOtp: createAuthEndpoint(
      '/phone-signup/send-otp',
      {
        method: 'POST',
        body: z.object({ phoneNumber: z.string().min(5).max(20) }),
      },
      async (ctx) => {
        const phone = normalizePhoneNumber(ctx.body.phoneNumber);
        if (!phone) {
          throw new APIError('BAD_REQUEST', { message: 'Invalid phone number' });
        }
        await throttleOtpByPhone(phone);
        const existing = await ctx.context.adapter.findOne({
          model: 'user',
          where: [{ field: 'phoneNumber', value: phone }],
        });
        if (existing) {
          return ctx.json({ message: 'code sent' });
        }
        // 镜像插件 sendPhoneNumberOTP 的存码格式(identifier=裸号,value=`code:0`)
        const code = generatePhoneOtp();
        await ctx.context.internalAdapter.createVerificationValue({
          value: `${code}:0`,
          identifier: phone,
          expiresAt: new Date(Date.now() + PHONE_OTP_EXPIRES_IN_SECONDS * 1000),
        });
        await sendSms({ phoneNumber: phone, code, scene: 'signup' });
        return ctx.json({ message: 'code sent' });
      },
    ),
    /** 手机号+密码+验证码注册。会话/cookie/密码哈希全部走 better-auth 内部通道,
     *  与官方 /sign-up/email 同款收尾(internalAdapter + setSessionCookie)。
     *  建号前先经插件的 consumePhoneNumberOTP 验码并消费(内部 API:不发会话、
     *  不动用户;码错/过期 400 INVALID_OTP,连错 3 次 403 TOO_MANY_ATTEMPTS),
     *  通过才建号且 phoneNumberVerified=true —— 注册即完成手机号验证(D3)。 */
    signUpWithPhone: createAuthEndpoint(
      '/phone-signup',
      {
        method: 'POST',
        body: z.object({
          phoneNumber: z.string().min(5).max(20),
          password: z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH),
          code: z.string().trim().min(4).max(10),
          name: z.string().trim().min(1).max(40).optional(),
        }),
      },
      async (ctx) => {
        const phone = normalizePhoneNumber(ctx.body.phoneNumber);
        if (!phone) {
          throw new APIError('BAD_REQUEST', { message: 'Invalid phone number' });
        }
        const email = `${phone}@${PHONE_PLACEHOLDER_DOMAIN}`;
        const [byEmail, byPhone] = await Promise.all([
          ctx.context.internalAdapter.findUserByEmail(email),
          ctx.context.adapter.findOne({
            model: 'user',
            where: [{ field: 'phoneNumber', value: phone }],
          }),
        ]);
        if (byEmail || byPhone) {
          throw new APIError('BAD_REQUEST', { code: 'PHONE_ALREADY_REGISTERED', message: 'Phone number already registered' });
        }
        // 验码并消费。放在注册冲突预检之后:已注册号不该烧掉用户手里还没用的码。
        // getAuth() 在请求期已初始化(端点由它挂载),与 require-auth.ts 同款用法。
        await consumePhoneNumberOtp(phone, ctx.body.code.trim());
        // 与官方 /sign-up/email 同款:先哈希、createUser(不含密码)、linkAccount
        // 落 credential 账户 —— 哈希在创建前做完,任何插件坏了也不会留下半截用户。
        const hash = await ctx.context.password.hash(ctx.body.password);
        const user = await ctx.context.internalAdapter.createUser(
          {
            email,
            name: ctx.body.name?.trim() || `用户 ${phone.slice(-4)}`,
            emailVerified: true,
            phoneNumber: phone,
            phoneNumberVerified: true,
          },
          { method: 'phone-number' },
        );
        if (!user) {
          throw new APIError('BAD_REQUEST', { code: 'FAILED_TO_CREATE_USER', message: 'Failed to create user' });
        }
        await ctx.context.internalAdapter.linkAccount({
          userId: user.id,
          providerId: 'credential',
          accountId: user.id,
          password: hash,
        });
        const session = await ctx.context.internalAdapter.createSession(user.id);
        if (!session) {
          throw new APIError('BAD_REQUEST', { code: 'FAILED_TO_CREATE_SESSION', message: 'Failed to create session' });
        }
        // biome-ignore lint/suspicious/noExplicitAny: 插件端点的 user 泛型与内部类型有出入,与官方路由同款用法
        await setSessionCookie(ctx, { session, user: user as any });
        return ctx.json({ token: session.token, user });
      },
    ),
  },
};

export function buildSocialProviders(): BetterAuthOptions['socialProviders'] {
  const providers: NonNullable<BetterAuthOptions['socialProviders']> = {};

  // 国内版不提供 Google 登录(2026-10-27 起):登录方式只有邮箱 + 手机号。
  // 即使 env 里残留 GOOGLE_*(字段为兼容存量环境保留一迭代),这里也不再挂载
  // google provider —— 配了也无效,存量 accounts 行不受影响。

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

// 插件的手机端点全部按 body.phoneNumber 精确查用户、精确写 verification identifier。
// 注册端落库前走过 normalizePhoneNumber;这里同样归一,否则「+86 138…」注册、
// 「+86-138-…」登录/找回会查无此人(账号不存在时插件仍返回成功且不发码)。
// 覆盖面:密码登录、验证码登录发码/验码、找回两条 —— 注册端点在 handler 内自归一。
const PHONE_BODY_NORMALIZE_PATHS: ReadonlySet<string> = new Set([
  '/sign-in/phone-number',
  '/phone-number/send-otp',
  '/phone-number/verify',
  '/phone-number/request-password-reset',
  '/phone-number/reset-password',
]);

function normalizePhoneAuthBody(ctx: {
  path: string;
  body?: { phoneNumber?: unknown } & Record<string, unknown>;
}) {
  if (!PHONE_BODY_NORMALIZE_PATHS.has(ctx.path)) return;
  const raw = typeof ctx.body?.phoneNumber === 'string' ? ctx.body.phoneNumber : '';
  const phone = normalizePhoneNumber(raw);
  if (!phone) {
    throw new APIError('BAD_REQUEST', { message: 'Invalid phone number' });
  }
  if (!ctx.body || phone === raw) return;
  return {
    context: {
      body: {
        ...ctx.body,
        phoneNumber: phone,
      },
    },
  };
}

// 验证码登录的发码门(方案 §4.1,默认 D1):归一 → 同号 60s 限频 → 未注册号
// 静默短路。短路返回 200 与插件成功响应同形(防枚举:攻击者扫号既拿不到码也
// 探不出「该号是否注册」),真实短信不下发、不烧钱;已注册 → 放行进插件正常
// 发码。顺序与限频口径和 /phone-signup/send-otp 对齐(同 identifier 共享窗口)。
// middleware 短路契约(better-call):直接返回 body 对象 —— Node ESM interop 下
// 它会被包成 { response: body },dispatch 层拿它当最终响应(实测钉住,见
// phone-otp-login.test.ts)。
async function gateLoginPhoneOtpSend(ctx: {
  path: string;
  body?: { phoneNumber?: unknown } & Record<string, unknown>;
}): Promise<{ message: string } | undefined> {
  if (ctx.path !== '/phone-number/send-otp') return;
  const raw = typeof ctx.body?.phoneNumber === 'string' ? ctx.body.phoneNumber : '';
  const phone = normalizePhoneNumber(raw);
  if (!phone) {
    throw new APIError('BAD_REQUEST', { message: 'Invalid phone number' });
  }
  await throttleOtpByPhone(phone);
  const existing = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.phoneNumber, phone))
    .limit(1);
  if (existing.length === 0) {
    return { message: 'code sent' };
  }
  return undefined;
}

// options.hooks.before 与 after 一样只收单个 middleware(见 yujeeAuthAfterHooks)。
const yujeeAuthBeforeHooks = createAuthMiddleware(async (ctx) => {
  const shortCircuit = await gateLoginPhoneOtpSend(ctx);
  if (shortCircuit) return shortCircuit as never;
  const rewritten = normalizePhoneAuthBody(ctx);
  if (rewritten) return rewritten;
  await throttleAnonymousSignIn(ctx);
});

// after-hook 收到的 ctx 类型(从 createAuthMiddleware 的 handler 形参推导)。
type AuthHookCtx = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

// 邮箱注册转正兜底:anonymous 插件的转正 matcher(dist/plugins/anonymous/index.mjs:118)
// 不含 /verify-email,而本仓 requireEmailVerification=true + autoSignInAfterVerification=true
// —— 邮箱注册的 session 是在点验证链接时才发的,插件的 onLinkAccount 在这条路上永远
// 不会触发。这里镜像插件 after-hook 的判定:响应真的种了 session cookie + 请求 cookie
// 里的旧 session 是匿名 → 过户相册并删除匿名用户。跨设备打开验证链接时旧 cookie 不在,
// 无法过户,由 7 天清理 cron 兜底(设计文档已知边界)。
async function linkAnonymousOnVerifyEmail(ctx: AuthHookCtx) {
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
}

// ─── 手机号注册/登录的游客并号(2026-10-27)──────────────────────────────────
// 游客持匿名 session 走手机号注册或登录:过户业务数据 → 删匿名号。三条路各有坑:
// - /phone-signup(自定义端点)不在 anonymous 插件转正 matcher 的路径名单里(matcher
//   认 /sign-in、/sign-up、/callback 等前缀),插件 hook 对它完全不跑 —— 没有显式
//   hook,游客的书会滞留在无人可见的匿名号下;
// - /sign-in/phone-number 与 /phone-number/verify(验证码登录,2026-10-28 起)都在
//   matcher 名单里(1.7.12 的 dist/plugins/anonymous/index.mjs:170 含
//   /phone-number/verify 前缀 —— SA 方案稿写的「不在名单」与实际不符),插件 hook
//   本就会转正;这里仍是权威路径:user 级 after-hook 先于插件 hook 执行,先做完
//   过户+删号;插件 hook 随后的二次触发由 transferAnonWithGuard 开头的实查闸拦成
//   no-op,一次请求恰好一次过户(Q1,phone-otp-login.test.ts L3 实测钉住)。显式
//   接管让并号语义不依赖插件版本的 matcher 名单。
// 判定镜像 linkAnonymousOnVerifyEmail:响应真的种了 session cookie + 请求 cookie 里
// 的旧 session 是匿名 → 过户 + 删匿名号。无匿名 session 的普通注册/登录(#52 行为)
// 在 oldSession 判定处自然早退,零副作用(R4)。
export const PHONE_AUTH_LINK_PATHS: ReadonlySet<string> = new Set([
  '/phone-signup',
  '/sign-in/phone-number',
  '/phone-number/verify',
]);

// 幂等闸 + 过户共用体:按主键实查匿名行。cookie 缓存里的旧匿名 session 作不了数 ——
// 删行之后缓存最多还能「活」5 分钟(cookieCache maxAge),插件 hook 会带着它再进来。
// 行没了/不是匿名 = 已处理过,整个跳过,防双次 transfer 与误导性日志(Q1)。
type AnonLinkAdapterCtx = {
  context: { internalAdapter: { findUserById: (id: string) => Promise<unknown> } };
};

async function transferAnonWithGuard(
  ctx: AnonLinkAdapterCtx,
  anonUserId: string,
  realUserId: string,
): Promise<boolean> {
  const anonRow = (await ctx.context.internalAdapter.findUserById(anonUserId)) as
    | { isAnonymous?: boolean | null }
    | null;
  if (!anonRow || !anonRow.isAnonymous) return false;
  await anonTransferService.transfer(anonUserId, realUserId);
  return true;
}

async function linkAnonymousOnPhoneAuth(ctx: AuthHookCtx) {
  if (!PHONE_AUTH_LINK_PATHS.has(ctx.path)) return;
  const setCookie = ctx.context.responseHeaders?.get('set-cookie');
  const sessionTokenName = ctx.context.authCookies.sessionToken.name;
  if (!parseSetCookieHeader(setCookie || '').get(sessionTokenName)?.value.split('.')[0]) return;
  const oldSession = await getSessionFromCtx(ctx, { disableRefresh: true });
  const oldUser = oldSession?.user as ({ id: string; isAnonymous?: boolean | null }) | undefined;
  if (!oldSession || !oldUser?.isAnonymous) return;
  const newSession = ctx.context.newSession;
  if (!newSession || newSession.user.id === oldUser.id) return;
  let transferred = false;
  try {
    transferred = await transferAnonWithGuard(ctx, oldUser.id, newSession.user.id);
  } catch (error) {
    // 过户失败不抛(R8):此刻账号与会话已建好,抛出去只会把注册/登录打成 500,前端
    // 误判失败。transfer 是单事务,失败即整体未动、匿名侧原封无损,留结构化错误
    // 日志给运维补救(管理端并号工具本期不做)。
    logger.error(
      { source: ctx.path, anonUserId: oldUser.id, realUserId: newSession.user.id, error },
      'anon phone link: transfer failed; anon data left intact',
    );
    return;
  }
  if (!transferred) return;
  logger.info(
    { source: ctx.path, anonUserId: oldUser.id, realUserId: newSession.user.id },
    'anon phone link: transferred',
  );
  // 顺序契约(R8):transfer 成功之后才删匿名行;删失败只留日志 —— 匿名号此时已无
  // 业务数据,空壳由 7 天清理 cron 兜底。不能反过来:先删 = 11 处 cascade 连锅端。
  try {
    await ctx.context.internalAdapter.deleteUser(oldUser.id);
  } catch (error) {
    logger.error(
      { source: ctx.path, anonUserId: oldUser.id, realUserId: newSession.user.id, error },
      'anon phone link: anon user delete failed; empty shell left for cleanup cron',
    );
  }
}

// options.hooks.after 只收**单个** middleware:better-auth 1.7.12 的 getHooks
// (dist/api/dispatch.mjs:149-155)直接把整个值塞进 { matcher: ()=>true, handler },
// 传数组会在每个请求上炸 'hook.handler is not a function'(连带 /sign-in/anonymous
// 一起 500)。这里用一个显式分派器串起两条匿名并号逻辑,路径判定在各自函数开头,
// 互不越界;user 级 after 仍先于插件 hook 执行(见 linkAnonymousOnPhoneAuth 注释)。
const yujeeAuthAfterHooks = createAuthMiddleware(async (ctx) => {
  await linkAnonymousOnVerifyEmail(ctx);
  await linkAnonymousOnPhoneAuth(ctx);
});

/**
 * better-auth hands `sendResetPassword` one absolute URL and nothing else — no
 * request locale, no user preference. The only language signal on it is the
 * `callbackURL` we asked for from the browser (`/zh/reset-password`), so we read
 * the locale back out of that. A miss falls back to the default locale rather
 * than throwing: a default-language reset mail still gets someone back into
 * their account.
 */
export function localeFromResetUrl(url: string): Locale {
  try {
    const callbackURL = new URL(url).searchParams.get('callbackURL');
    if (!callbackURL) return defaultLocale;
    // originCheck accepts absolute same-origin URLs as well as relative paths,
    // and detectLocale splits on '/' — hand it a whole URL and it reads 'https:'
    // as the locale segment. Normalise to a pathname first.
    return detectLocale(new URL(callbackURL, url).pathname);
  } catch {
    return defaultLocale;
  }
}

export function buildPasswordResetEmail(
  user: { email: string; name?: string | null },
  url: string,
): { to: string } & ReturnType<typeof renderPasswordResetEmail> {
  return {
    to: user.email,
    ...renderPasswordResetEmail({
      locale: localeFromResetUrl(url),
      // `??` alone lets an empty name through to the template's English
      // 'there' fallback, which then greets a Japanese reader as 'there さん'.
      name: user.name?.trim() || user.email,
      actionUrl: url,
    }),
  };
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
    // 顺序契约:anonymous 在前,nextCookies() 必须收尾(它是 set-cookie 的终段中间件;
    // anonymous 的转正 after-hook 要从 responseHeaders 里读 set-cookie)。
    plugins: [
      anonymous({
        onLinkAccount: async ({ anonymousUser, newUser, ctx }) => {
          // 在插件删除匿名用户之前过户,否则 albums 等 11 处 cascade 连锅端。
          // 走共用体(带幂等闸):手机号登录路径上,显式 after-hook(user 级先跑)
          // 已过户并删了匿名行,插件 hook 从 cookie 缓存还会再触发到这里,闸门让它
          // no-op。邮箱/OAuth 路径行为不变(过户失败照旧向上抛)。
          await transferAnonWithGuard(ctx, anonymousUser.user.id, newUser.user.id);
        },
      }),
      // 手机号:官方插件给密码登录(/sign-in/phone-number)、验证码登录发码/验码
      // (/phone-number/send-otp、/phone-number/verify),以及找回
      // (/phone-number/request-password-reset + /reset-password)。
      // 注册走我们自定义的 /phone-signup(见 yujeePhoneSignup)。requireVerification
      // 保持不设(默认关,D7):新号注册即 verified,存量号首次 OTP 登录自动转正,
      // 密码登录不设验证墙 —— 存量用户零感知。
      // 找回发码只调 sendPasswordResetOTP,不回落 sendOTP;漏接则账号存在也无码。
      // 验证码真实下发/回落全在 lib/sms(SMS_DELIVERY 开关),这里只接线。
      phoneNumberPlugin({
        sendOTP: async ({ phoneNumber, code }) => {
          await sendSms({ phoneNumber, code, scene: 'login' });
        },
        sendPasswordResetOTP: async ({ phoneNumber, code }) => {
          await sendSms({ phoneNumber, code, scene: 'reset' });
        },
      }),
      yujeePhoneSignup,
      nextCookies(),
    ],
    hooks: {
      before: yujeeAuthBeforeHooks,
      after: yujeeAuthAfterHooks,
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
    // /request-password-reset 是**未登录可调、直接发真实邮件**的端点,而
    // better-auth 自带的特殊限流只覆盖 /sign-in /sign-up /change-password
    // /change-email(api/rate-limiter/index.mjs:159),它会落到默认的 100 次/10 秒
    // —— 每分钟 600 封砸向受害者的收件箱,顺带烧 Resend 的账单。
    // 局限:storage 默认是进程内存,Vercel 多实例各算各的;真要收死得配
    // secondaryStorage 或 database storage(需要新表)。这里先把量级压下来。
    rateLimit: {
      customRules: {
        '/request-password-reset': { window: 3600, max: 3 },
        // 手机号注册与发码不在 better-auth 内置特殊限流的路径名单里
        // (那套只认 /sign-in /sign-up /change-* /request-password-reset 前缀),
        // 不配就会落到默认 100 次/10 秒 —— 注册 10 分钟 5 次、发码(登录/注册两个
        // 端点)各 1 分钟 3 次;同号 60s 窗口另由 before-hook/端点内的
        // throttleOtpByPhone 把关(按 IP 之外的第二层)。
        '/phone-signup': { window: 600, max: 5 },
        '/phone-signup/send-otp': { window: 60, max: 3 },
        '/phone-number/send-otp': { window: 60, max: 3 },
        // 手机号找回与邮件找回同一量级。插件对 /phone-number* 另有 10 次/60s
        // 兜底;customRules 精确路径在其后覆盖,这条是 3 次/小时。
        '/phone-number/request-password-reset': { window: 3600, max: 3 },
      },
    },
    socialProviders: buildSocialProviders(),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: MAX_PASSWORD_LENGTH,
      // 没有这个函数,/request-password-reset 一律 400「Reset password isn't enabled」
      // —— 登录页的「忘记密码」链接从上线起就通向 404,后端也从未真的开过这条路。
      resetPasswordTokenExpiresIn: 3600,
      sendResetPassword: async ({ user, url }) => {
        await sendEmail(buildPasswordResetEmail(user, url));
      },
      // 重置密码是账号被盗后的收回手段:攻击者手上的 session 必须一起作废。
      // 注意 cookieCache(见下面 session 段)有 5 分钟窗口:库里的 session 行立刻删,
      // 但已签发的 cookie 在缓存期内仍会被当作有效,最多再答 5 分钟。
      revokeSessionsOnPasswordReset: true,
      // requireEmailVerification 下,不补这一刀就是死循环:验证邮件进垃圾箱的人
      // 登不进去 → 来点「忘记密码」→ 重置成功 → 依旧 403 EMAIL_NOT_VERIFIED,
      // 而页面还告诉他「现在可以用新密码登录了」。这条路正是为这批人修的。
      // 收到并用掉重置 token 本身就证明了邮箱控制权,和点验证链接是同一件事。
      onPasswordReset: async ({ user }) => {
        if (user.emailVerified) return;
        await db
          .update(schema.users)
          .set({ emailVerified: true })
          .where(eq(schema.users.id, user.id));
      },
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
