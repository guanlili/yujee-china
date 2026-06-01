import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ============================================
// Enums (docs/web/database.md §8 state machines)
// ============================================

export const albumStatusEnum = pgEnum('album_status', [
  'AGENT_RUNNING',
  'EDITING',
  'COMPLETED',
  'FAILED',
]);

export const agentJobStatusEnum = pgEnum('agent_job_status', [
  'QUEUED',
  'RUNNING',
  'COMPLETED',
  'FAILED',
]);

export const creditHoldStatusEnum = pgEnum('credit_hold_status', [
  'HOLDING',
  'SETTLED',
  'RELEASED',
]);

export const messageRoleEnum = pgEnum('message_role', ['user', 'assistant']);

export const customerProviderEnum = pgEnum('customer_provider', ['stripe', 'creem']);

export const creditLedgerReasonEnum = pgEnum('credit_ledger_reason', [
  'SIGNUP_BONUS',
  'GENERATION_HOLD',
  'GENERATION_SETTLE',
  'GENERATION_RELEASE',
  'PURCHASE',
  'REFUND',
  'ADMIN_ADJUST',
]);

// ============================================
// better-auth tables (4) — docs/web/database.md §2
// `users.credit_balance` is an additionalField; credit_ledger is source of truth.
// ============================================

export const users = pgTable('users', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name'),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  isAdmin: boolean('is_admin').notNull().default(false),
  creditBalance: integer('credit_balance').notNull().default(100),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('idx_sessions_user').on(t.userId),
  }),
);

export const accounts = pgTable(
  'accounts',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    idToken: text('id_token'),
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('idx_accounts_user').on(t.userId),
    providerAccount: uniqueIndex('uq_accounts_provider_account').on(t.providerId, t.accountId),
  }),
);

export const verifications = pgTable('verifications', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()`),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ============================================
// Payment mapping — docs/web/database.md §3.1
// ============================================

export const customers = pgTable(
  'customers',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: customerProviderEnum('provider').notNull(),
    externalCustomerId: text('external_customer_id').notNull(),
    email: text('email'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userProvider: uniqueIndex('uq_customers_user_provider').on(t.userId, t.provider),
    providerExternal: uniqueIndex('uq_customers_provider_external').on(
      t.provider,
      t.externalCustomerId,
    ),
    userIdx: index('idx_customers_user').on(t.userId),
  }),
);

// ============================================
// Album core — docs/web/database.md §3 / §4 / §4.1
// `albums.creditHoldId` intentionally has no FK to break the
// albums ↔ credit_holds cycle; credit_holds.albumId is the strong link.
// ============================================

export const albums = pgTable(
  'albums',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    status: albumStatusEnum('status').notNull().default('AGENT_RUNNING'),
    prompt: text('prompt').notNull(),
    layoutJson: jsonb('layout_json'),
    photoCount: integer('photo_count').notNull(),
    pageCount: integer('page_count').notNull().default(0),
    pdfR2Key: text('pdf_r2_key'),
    pdfUrl: text('pdf_url'),
    creditHoldId: text('credit_hold_id'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userCreated: index('idx_albums_user_created').on(t.userId, t.createdAt.desc()),
    activeStatus: index('idx_albums_active')
      .on(t.status)
      .where(sql`${t.status} in ('AGENT_RUNNING', 'EDITING')`),
  }),
);

export const albumPages = pgTable(
  'album_pages',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()`),
    albumId: text('album_id')
      .notNull()
      .references(() => albums.id, { onDelete: 'cascade' }),
    pageIndex: integer('page_index').notNull(),
    templateId: text('template_id').notNull(),
    imagesJson: jsonb('images_json').notNull().default({}),
    textsJson: jsonb('texts_json').notNull().default({}),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    albumIndex: uniqueIndex('uq_album_pages_album_index').on(t.albumId, t.pageIndex),
    album: index('idx_album_pages_album').on(t.albumId),
  }),
);

export const albumMessages = pgTable(
  'album_messages',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()`),
    albumId: text('album_id')
      .notNull()
      .references(() => albums.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: messageRoleEnum('role').notNull(),
    content: text('content').notNull(),
    layoutPatch: jsonb('layout_patch'),
    usage: jsonb('usage'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    albumCreated: index('idx_album_messages_album_created').on(t.albumId, t.createdAt),
    userCreated: index('idx_album_messages_user_created').on(t.userId, t.createdAt.desc()),
  }),
);

// ============================================
// Agent jobs — docs/web/database.md §5
// ============================================

export const agentJobs = pgTable(
  'agent_jobs',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()`),
    requestId: text('request_id').notNull().unique(),
    albumId: text('album_id')
      .notNull()
      .references(() => albums.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: agentJobStatusEnum('status').notNull().default('QUEUED'),
    stage: text('stage'),
    progress: integer('progress').notNull().default(0),
    usage: jsonb('usage'),
    error: jsonb('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // Set when QUEUED→RUNNING, then refreshed on every progress callback — it is
    // a last-activity heartbeat, not a fixed start time. Zombie staleness checks
    // (read-path sweep + daily cron) measure "no progress since startedAt".
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => ({
    userCreated: index('idx_agent_jobs_user_created').on(t.userId, t.createdAt.desc()),
    runningStartedAt: index('idx_agent_jobs_running_started')
      .on(t.startedAt)
      .where(sql`${t.status} = 'RUNNING'`),
    // Supports findLatestByAlbum: the album-uuid read path looks up the newest
    // job per album on every 15s poll while AGENT_RUNNING (docs/web/api.md §3.4).
    albumCreated: index('idx_agent_jobs_album_created').on(t.albumId, t.createdAt.desc()),
  }),
);

// ============================================
// Credits — docs/web/database.md §6 / §7
// credit_ledger fields are a minimal draft; see PR description for
// the open question to the architect.
// ============================================

export const creditHolds = pgTable(
  'credit_holds',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    albumId: text('album_id')
      .notNull()
      .references(() => albums.id, { onDelete: 'cascade' }),
    amount: integer('amount').notNull(),
    status: creditHoldStatusEnum('status').notNull().default('HOLDING'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    settledAt: timestamp('settled_at', { withTimezone: true }),
  },
  (t) => ({
    userCreated: index('idx_credit_holds_user_created').on(t.userId, t.createdAt.desc()),
    activeStatus: index('idx_credit_holds_holding')
      .on(t.status)
      .where(sql`${t.status} = 'HOLDING'`),
  }),
);

export const creditLedger = pgTable(
  'credit_ledger',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    delta: integer('delta').notNull(),
    reason: creditLedgerReasonEnum('reason').notNull(),
    balanceAfter: integer('balance_after').notNull(),
    relatedAlbumId: text('related_album_id').references(() => albums.id, {
      onDelete: 'set null',
    }),
    relatedHoldId: text('related_hold_id').references(() => creditHolds.id, {
      onDelete: 'set null',
    }),
    meta: jsonb('meta'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userCreated: index('idx_credit_ledger_user_created').on(t.userId, t.createdAt.desc()),
  }),
);

// ============================================
// Type exports
// ============================================

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type Verification = typeof verifications.$inferSelect;
export type NewVerification = typeof verifications.$inferInsert;

export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;

export type Album = typeof albums.$inferSelect;
export type NewAlbum = typeof albums.$inferInsert;
export type AlbumPage = typeof albumPages.$inferSelect;
export type NewAlbumPage = typeof albumPages.$inferInsert;
export type AlbumMessage = typeof albumMessages.$inferSelect;
export type NewAlbumMessage = typeof albumMessages.$inferInsert;

export type AgentJob = typeof agentJobs.$inferSelect;
export type NewAgentJob = typeof agentJobs.$inferInsert;

export type CreditHold = typeof creditHolds.$inferSelect;
export type NewCreditHold = typeof creditHolds.$inferInsert;
export type CreditLedger = typeof creditLedger.$inferSelect;
export type NewCreditLedger = typeof creditLedger.$inferInsert;
