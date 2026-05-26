import type { Config } from 'drizzle-kit';

const raw = process.env.DATABASE_URL ?? 'file:./yujee-dev.db';
const url = raw.startsWith('file:') ? raw : `file:${raw}`;

export default {
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'turso',
  dbCredentials: { url },
} satisfies Config;
