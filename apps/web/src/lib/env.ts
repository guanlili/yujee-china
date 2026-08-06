import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z
    .string()
    .min(1)
    .default('postgresql://yujee:yujee@localhost:5432/yujee_dev'),
  AGENT_BASE_URL: z.string().url().default('http://localhost:8001'),
  AGENT_SHARED_SECRET: z.string().min(8).default('dev_secret_replace_me'),
  // 设计 Agent（packages/design-agent album server，对话式改书）。secret 未设 => 不带鉴权头（本地 dev）。
  DESIGN_AGENT_BASE_URL: z.string().url().default('http://localhost:8787'),
  DESIGN_AGENT_SHARED_SECRET: z.string().optional(),
  WEB_BASE_URL: z.string().url().default('http://localhost:3000'),
  BETTER_AUTH_SECRET: z.string().min(16).default('dev_better_auth_secret_change_me'),

  // Google OAuth (better-auth social provider). Both unset => Google sign-in
  // disabled, email/password still works.
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  // Sign in with Apple (better-auth social provider). Apple has no static
  // client secret: it's a short-lived ES256 JWT we sign from the .p8 key on the
  // fly (see lib/auth/apple-client-secret.ts). All four must be set to enable
  // Apple sign-in; any missing => Apple disabled, other logins unaffected.
  //  - APPLE_CLIENT_ID  : the Services ID (e.g. com.yujee.web), NOT the app bundle id
  //  - APPLE_TEAM_ID    : 10-char Apple Developer Team ID
  //  - APPLE_KEY_ID     : 10-char Key ID of the Sign-in-with-Apple key
  //  - APPLE_PRIVATE_KEY: contents of the AuthKey_XXXX.p8 (PEM). Newlines may be
  //    stored as literal "\n" — we normalize them before signing.
  APPLE_CLIENT_ID: z.string().optional(),
  APPLE_TEAM_ID: z.string().optional(),
  APPLE_KEY_ID: z.string().optional(),
  APPLE_PRIVATE_KEY: z.string().optional(),
  AUTH_EMAIL_FROM: z.string().min(1).default('Yujee <noreply@yujeeai.com>'),
  // 用户反馈转发收件箱(运营者私人邮箱;发件人复用 AUTH_EMAIL_FROM)。
  FEEDBACK_INBOX: z.string().min(3).default('1658152285@qq.com'),
  EMAIL_DELIVERY: z.enum(['capture', 'console', 'resend']).default('capture'),
  EMAIL_CAPTURE_FILE: z.string().min(1).default('.tmp/email-capture.jsonl'),
  RESEND_API_KEY: z.string().optional(),
  DEMO_USER_ID: z.string().default('demo-user-001'),
  DEMO_USER_EMAIL: z.string().default('demo@yujee.local'),
  DEMO_USER_PASSWORD: z.string().min(8).default('demo-password-123'),

  // Vercel cron auth bypass for admin routes (recover-stuck / cleanup-photos).
  // Vercel injects `Authorization: Bearer <CRON_SECRET>` on cron invocations.
  // Unset in dev => cron bypass disabled, so those routes still require admin.
  CRON_SECRET: z.string().optional(),

  // Bootstrap admins without a DB write: any signed-in user whose email is in
  // this comma-separated allowlist is treated as admin, in addition to the
  // users.is_admin flag. Set in the Vercel dashboard (never needs the DB key).
  // Empty => admin gated purely by the flag.
  ADMIN_EMAILS: z.string().optional(),

  // Payment · Creem (海外主通道)
  CREEM_API_KEY: z.string().optional(),
  CREEM_API_BASE_URL: z.string().url().default('https://api.creem.io'),
  CREEM_WEBHOOK_SECRET: z.string().optional(),
  CREEM_PRODUCT_ID_PACK_1: z.string().optional(),
  CREEM_PRODUCT_ID_PACK_4: z.string().optional(),
  CREEM_PRODUCT_ID_PACK_10: z.string().optional(),

  // Payment · Waffo Pancake (海外主通道,2026-08 起替换 Creem;Creem 变量留作在途订单兜底)
  // WAFFO_ENV 决定 webhook 验签用哪把官方公钥 + 拒收错环境事件。
  // 生产必须显式设 'prod',否则 live 事件会被当错环境静默忽略(只扣钱不发积分)。
  WAFFO_MERCHANT_ID: z.string().optional(),
  WAFFO_STORE_ID: z.string().optional(),
  WAFFO_PRIVATE_KEY: z.string().optional(),
  WAFFO_ENV: z.enum(['test', 'prod']).default('test'),
  WAFFO_PRODUCT_ID_PACK_1: z.string().optional(),
  WAFFO_PRODUCT_ID_PACK_4: z.string().optional(),
  WAFFO_PRODUCT_ID_PACK_10: z.string().optional(),

  // Cloudflare R2 (S3-compatible). PDF upload-url uses presigned PUT.
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().default('yujee-pdfs'),
  R2_PUBLIC_BASE_URL: z.string().url().default('https://cdn.yujeeai.com'),
});

// 下面这些变量在 schema 里都带 dev 兜底默认值(localhost / dev_secret_replace_me 之类),
// 好处是本地零配置起得来,代价是**生产漏配一个变量不会崩,会带着占位值静默上线** ——
// 封面预览那次事故就是这个形状。所以真生产环境下要求它们必须由环境显式提供。
//
// 只在「真生产」生效:
//   - Vercel:  VERCEL_ENV === 'production'(preview/development 保留 dev 默认值,
//              否则每个 PR 预览构建都会因为 Preview 环境本就缺 DATABASE_URL 而炸)
//   - 自托管:  NODE_ENV === 'production' 且没有 VERCEL_ENV(Fly/Docker 等)
const PRODUCTION_REQUIRED = [
  'DATABASE_URL',
  'WEB_BASE_URL',
  'BETTER_AUTH_SECRET',
  'AGENT_BASE_URL',
  'AGENT_SHARED_SECRET',
  'DESIGN_AGENT_BASE_URL',
  'DESIGN_AGENT_SHARED_SECRET',
] as const;

type RawEnv = Record<string, string | undefined>;

export function isRealProduction(raw: RawEnv): boolean {
  if (raw.VERCEL_ENV) return raw.VERCEL_ENV === 'production';
  return raw.NODE_ENV === 'production';
}

export function assertProductionEnv(raw: RawEnv): void {
  if (!isRealProduction(raw)) return;
  const missing = PRODUCTION_REQUIRED.filter((key) => !raw[key]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `生产环境缺少必需的环境变量: ${missing.join(', ')}。` +
        '这些变量在开发环境有占位默认值,生产环境必须显式设置 —— ' +
        '带着占位值启动会静默连错数据库/错服务。',
    );
  }
}

assertProductionEnv(process.env);

export const env = EnvSchema.parse(process.env);
export type Env = z.infer<typeof EnvSchema>;
