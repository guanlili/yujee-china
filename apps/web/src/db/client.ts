import { drizzle, type PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import postgres from 'postgres';
import { env } from '@/lib/env';
import * as schema from './schema';

const isLocal = /localhost|127\.0\.0\.1/.test(env.DATABASE_URL);

const client = postgres(env.DATABASE_URL, {
  max: 10,
  idle_timeout: 20,
  max_lifetime: 60 * 30,
  connect_timeout: 10,
  ssl: isLocal ? undefined : 'require',
  prepare: false,
});

export const db = drizzle(client, { schema });
export type DB = typeof db;

// The handle passed to db.transaction(async (tx) => ...).
export type Tx = PgTransaction<
  PostgresJsQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

// Accept either the top-level db or an open transaction. Repos use this
// so callers can compose multi-table writes atomically (invariant 8).
export type DbOrTx = DB | Tx;
