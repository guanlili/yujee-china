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
  AUTH_EMAIL_FROM: z.string().min(1).default('Yujee <noreply@yujeeai.com>'),
  EMAIL_DELIVERY: z.enum(['capture', 'console', 'resend']).default('capture'),
  EMAIL_CAPTURE_FILE: z.string().min(1).default('.tmp/email-capture.jsonl'),
  RESEND_API_KEY: z.string().optional(),
  DEMO_USER_ID: z.string().default('demo-user-001'),
  DEMO_USER_EMAIL: z.string().default('demo@yujee.local'),
});

export const env = EnvSchema.parse(process.env);
export type Env = z.infer<typeof EnvSchema>;
