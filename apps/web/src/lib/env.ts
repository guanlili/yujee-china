import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z
    .string()
    .min(1)
    .default('postgresql://yujee:yujee@localhost:5432/yujee_dev'),
  AGENT_BASE_URL: z.string().url().default('http://localhost:8001'),
  AGENT_SHARED_SECRET: z.string().min(8).default('dev_secret_replace_me'),
  WEB_BASE_URL: z.string().url().default('http://localhost:3000'),
  BETTER_AUTH_SECRET: z.string().min(16).default('dev_better_auth_secret_change_me'),

  // Google OAuth (better-auth social provider). Both unset => Google sign-in
  // disabled, email/password still works.
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  AUTH_EMAIL_FROM: z.string().min(1).default('Yujee <noreply@yujeeai.com>'),
  EMAIL_DELIVERY: z.enum(['capture', 'console', 'resend']).default('capture'),
  EMAIL_CAPTURE_FILE: z.string().min(1).default('.tmp/email-capture.jsonl'),
  RESEND_API_KEY: z.string().optional(),
  DEMO_USER_ID: z.string().default('demo-user-001'),
  DEMO_USER_EMAIL: z.string().default('demo@yujee.local'),

  // Vercel cron auth bypass for admin routes (recover-stuck / cleanup-photos).
  // Vercel injects `Authorization: Bearer <CRON_SECRET>` on cron invocations.
  // Unset in dev => cron bypass disabled, so those routes still require admin.
  CRON_SECRET: z.string().optional(),

  // Payment · Creem (海外主通道)
  CREEM_API_KEY: z.string().optional(),
  CREEM_API_BASE_URL: z.string().url().default('https://api.creem.io'),
  CREEM_WEBHOOK_SECRET: z.string().optional(),
  CREEM_PRODUCT_ID_PACK_2400: z.string().optional(),
  CREEM_PRODUCT_ID_PACK_4800: z.string().optional(),
  CREEM_PRODUCT_ID_PACK_8000: z.string().optional(),
  CREEM_PRODUCT_ID_PACK_16000: z.string().optional(),
  CREEM_PRODUCT_ID_PRO_MONTHLY: z.string().optional(),
  CREEM_PRODUCT_ID_PRO_YEARLY: z.string().optional(),
  CREEM_PRODUCT_ID_STUDIO_MONTHLY: z.string().optional(),
  CREEM_PRODUCT_ID_STUDIO_YEARLY: z.string().optional(),

  // Cloudflare R2 (S3-compatible). PDF upload-url uses presigned PUT.
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().default('yujee-pdfs'),
  R2_PUBLIC_BASE_URL: z.string().url().default('https://cdn.yujeeai.com'),
});

export const env = EnvSchema.parse(process.env);
export type Env = z.infer<typeof EnvSchema>;
