import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

const uuid = () => text('id').primaryKey().$defaultFn(() => randomUUID());
const ts = (name: string) =>
  integer(name, { mode: 'timestamp' }).notNull().$defaultFn(() => new Date());

export const users = sqliteTable('users', {
  id: uuid(),
  email: text('email').notNull().unique(),
  name: text('name'),
  creditBalance: integer('credit_balance').notNull().default(100),
  createdAt: ts('created_at'),
  updatedAt: ts('updated_at'),
});

export const albums = sqliteTable(
  'albums',
  {
    id: uuid(),
    userId: text('user_id').notNull(),
    title: text('title').notNull(),
    status: text('status', { enum: ['AGENT_RUNNING', 'EDITING', 'COMPLETED', 'FAILED'] })
      .notNull()
      .default('AGENT_RUNNING'),
    prompt: text('prompt').notNull(),
    layoutJson: text('layout_json'),
    photoCount: integer('photo_count').notNull(),
    pageCount: integer('page_count').notNull().default(0),
    pdfR2Key: text('pdf_r2_key'),
    pdfUrl: text('pdf_url'),
    creditHoldId: text('credit_hold_id'),
    errorMessage: text('error_message'),
    createdAt: ts('created_at'),
    updatedAt: ts('updated_at'),
  },
  (t) => ({
    userCreated: index('idx_albums_user_created').on(t.userId, t.createdAt),
  }),
);

export const albumPages = sqliteTable(
  'album_pages',
  {
    id: uuid(),
    albumId: text('album_id').notNull(),
    pageIndex: integer('page_index').notNull(),
    templateId: text('template_id').notNull(),
    imagesJson: text('images_json').notNull().default('{}'),
    textsJson: text('texts_json').notNull().default('{}'),
    updatedAt: ts('updated_at'),
  },
  (t) => ({
    albumIndex: uniqueIndex('uq_album_pages_album_index').on(t.albumId, t.pageIndex),
    album: index('idx_album_pages_album').on(t.albumId),
  }),
);

export const agentJobs = sqliteTable(
  'agent_jobs',
  {
    id: uuid(),
    requestId: text('request_id').notNull().unique(),
    albumId: text('album_id').notNull(),
    userId: text('user_id').notNull(),
    status: text('status', { enum: ['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED'] })
      .notNull()
      .default('QUEUED'),
    stage: text('stage'),
    progress: integer('progress').notNull().default(0),
    usage: text('usage'),
    error: text('error'),
    createdAt: ts('created_at'),
    startedAt: integer('started_at', { mode: 'timestamp' }),
    completedAt: integer('completed_at', { mode: 'timestamp' }),
  },
  (t) => ({
    userCreated: index('idx_agent_jobs_user_created').on(t.userId, t.createdAt),
  }),
);

export const creditHolds = sqliteTable('credit_holds', {
  id: uuid(),
  userId: text('user_id').notNull(),
  albumId: text('album_id').notNull(),
  amount: integer('amount').notNull(),
  status: text('status', { enum: ['HOLDING', 'SETTLED', 'RELEASED'] })
    .notNull()
    .default('HOLDING'),
  createdAt: ts('created_at'),
  settledAt: integer('settled_at', { mode: 'timestamp' }),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Album = typeof albums.$inferSelect;
export type NewAlbum = typeof albums.$inferInsert;
export type AlbumPage = typeof albumPages.$inferSelect;
export type NewAlbumPage = typeof albumPages.$inferInsert;
export type AgentJob = typeof agentJobs.$inferSelect;
export type NewAgentJob = typeof agentJobs.$inferInsert;
export type CreditHold = typeof creditHolds.$inferSelect;
export type NewCreditHold = typeof creditHolds.$inferInsert;

export const _unused = sql;
