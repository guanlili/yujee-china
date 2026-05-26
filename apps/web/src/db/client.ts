import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { env } from '@/lib/env';
import * as schema from './schema';

const url = env.DATABASE_URL.startsWith('file:') ? env.DATABASE_URL : `file:${env.DATABASE_URL}`;
const client = createClient({ url });

export const db = drizzle(client, { schema });
export type DB = typeof db;
