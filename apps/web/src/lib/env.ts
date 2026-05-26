import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().default('file:./yujee-dev.db'),
  AGENT_BASE_URL: z.string().url().default('http://localhost:8001'),
  AGENT_SHARED_SECRET: z.string().min(8).default('dev_secret_replace_me'),
  WEB_BASE_URL: z.string().url().default('http://localhost:3000'),
  DEMO_USER_ID: z.string().default('demo-user-001'),
  DEMO_USER_EMAIL: z.string().default('demo@yujee.local'),
});

export const env = EnvSchema.parse(process.env);
export type Env = z.infer<typeof EnvSchema>;
