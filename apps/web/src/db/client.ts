import { drizzle, type PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import postgres from 'postgres';
import { env } from '@/lib/env';
import * as schema from './schema';

// DATABASE_SSL 显式给定则完全覆盖启发式 —— 单机 compose 的 PG 挂自签证书、或
// 可信内网只想明文,都靠它显式表态;未设时维持旧行为:localhost/127.0.0.1 免
// TLS,其余一律 require(只加密不验链,自签证书可用;要验链用 verify-full)。
export function resolveDatabaseSsl(
  url: string,
  mode: 'disable' | 'prefer' | 'require' | 'verify-full' | undefined,
): 'prefer' | 'require' | 'verify-full' | boolean | undefined {
  if (mode === 'disable') return false;
  if (mode) return mode;
  return /localhost|127\.0\.0\.1/.test(url) ? undefined : 'require';
}

const client = postgres(env.DATABASE_URL, {
  max: 10,
  idle_timeout: 20,
  max_lifetime: 60 * 30,
  connect_timeout: 10,
  ssl: resolveDatabaseSsl(env.DATABASE_URL, env.DATABASE_SSL),
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
