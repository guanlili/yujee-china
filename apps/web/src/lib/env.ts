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

  // Cloudflare R2 (S3-compatible). PDF upload-url uses presigned PUT.
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().default('yujee-pdfs'),
  R2_PUBLIC_BASE_URL: z.string().url().default('https://cdn.yujeeai.com'),
});

export const env = EnvSchema.parse(process.env);
export type Env = z.infer<typeof EnvSchema>;
