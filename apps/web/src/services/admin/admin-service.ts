import { desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { accounts, inviteCodes } from '@/db/schema';
import { getAuth } from '@/lib/auth/better-auth';
import { FREE_PLAN_CREDITS } from '@/config/pricing';
import { ANON_CLEANUP_DAYS } from '@/config/anon';
import { userRepo } from '@/db/repos/user-repo';
import { albumRepo } from '@/db/repos/album-repo';
import { agentJobRepo } from '@/db/repos/agent-job-repo';
import { creditLedgerRepo } from '@/db/repos/credit-ledger-repo';
import { creditService } from '@/services/credit/credit-service';
import { zombieSweeper } from '@/services/job/zombie-sweeper';
import { draftExpirySweeper } from '@/services/job/draft-expiry-sweeper';
import { ERRORS } from '@/lib/api/error-codes';
import { logger } from '@/lib/log/logger';

const STUCK_CUTOFF_MS = 5 * 60 * 1000;
const DEFAULT_CLEANUP_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

// Fat-finger guard on manual grants: one click can never move more than this in
// either direction. Positive = grant, negative = correction/deduction.
const MAX_GRANT_MAGNITUDE = 100_000;

// Fat-finger guards on invite codes: a code can't grant more than this per
// redemption, and can't be dated further out than a year.
const MAX_INVITE_CREDITS = 100_000;
const MAX_INVITE_EXPIRY_DAYS = 365;

const ALBUM_STATUSES = ['AGENT_RUNNING', 'EDITING', 'COMPLETED', 'FAILED'] as const;
const JOB_STATUSES = ['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED'] as const;

type AlbumStatusCounts = Record<(typeof ALBUM_STATUSES)[number], number>;
type JobStatusCounts = Record<(typeof JOB_STATUSES)[number], number>;

function albumStatusRecord(rows: { status: string; count: number }[]): AlbumStatusCounts {
  const base = Object.fromEntries(ALBUM_STATUSES.map((s) => [s, 0])) as AlbumStatusCounts;
  for (const r of rows) base[r.status as keyof AlbumStatusCounts] = r.count;
  return base;
}

function jobStatusRecord(rows: { status: string; count: number }[]): JobStatusCounts {
  const base = Object.fromEntries(JOB_STATUSES.map((s) => [s, 0])) as JobStatusCounts;
  for (const r of rows) base[r.status as keyof JobStatusCounts] = r.count;
  return base;
}

// All methods take the verified admin actorId first (invariant 7). Authorization
// itself happens upstream in requireAdmin; the actorId is for audit, not a gate.
export const adminService = {
  async getOverview(_actorId: string, now: Date = new Date()) {
    const [totalUsers, totalAlbums, albumStatusRows, stuckJobs, newUsers7d, newAlbums7d] =
      await Promise.all([
        userRepo.count(),
        albumRepo.count(),
        albumRepo.countByStatus(),
        agentJobRepo.countStuckRunning(new Date(now.getTime() - STUCK_CUTOFF_MS)),
        userRepo.countCreatedSince(new Date(now.getTime() - 7 * DAY_MS)),
        albumRepo.countCreatedSince(new Date(now.getTime() - 7 * DAY_MS)),
      ]);

    return {
      totalUsers,
      totalAlbums,
      albumsByStatus: albumStatusRecord(albumStatusRows),
      stuckJobs,
      newUsers7d,
      newAlbums7d,
    };
  },

  // 分页读。total 是**筛选后**的全集大小,页面靠它算「第 X–Y / 共 N」和有没有下一页。
  // 游客默认不列:他们按 createdAt 倒序永远排在最前,不藏就把真实用户挤出第一页。
  async listUsers(
    _actorId: string,
    opts: { limit?: number; offset?: number; includeAnonymous?: boolean } = {},
  ) {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
    const requested = Math.max(opts.offset ?? 0, 0);
    const includeAnonymous = opts.includeAnonymous ?? false;

    // 先数再取:越界的 offset(收藏的旧 ?page=9、手改的 URL)夹到最后一页,不翻空白页,
    // 也不让天文数字的 offset 进 SQL。返回的是**生效后**的 offset,页面按它标页码。
    const total = await userRepo.count({ includeAnonymous });
    const offset = total === 0 ? 0 : Math.min(requested, Math.floor((total - 1) / limit) * limit);
    const users = await userRepo.listRecent({ limit, offset, includeAnonymous });
    const albumCounts = await albumRepo.countByUserIds(users.map((u) => u.id));
    const countByUser = new Map(albumCounts.map((c) => [c.userId, c.count]));

    return {
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        isAdmin: u.isAdmin,
        isAnonymous: u.isAnonymous,
        creditBalance: u.creditBalance,
        albumCount: countByUser.get(u.id) ?? 0,
        createdAt: u.createdAt,
      })),
      total,
      limit,
      offset,
      includeAnonymous,
    };
  },

  // Manual credit grant/correction by email. Looks the user up
  // case-insensitively (operator hand-types the address), validates the amount,
  // then moves the balance through creditService.applyDelta so users.credit_balance
  // and a credit_ledger ADMIN_ADJUST row commit together (invariant 8). The
  // acting admin id + optional note land in the ledger meta for audit.
  async grantCredit(
    actorId: string,
    input: { email: string; amount: number; note?: string },
  ) {
    const amount = input.amount;
    if (!Number.isInteger(amount) || amount === 0) {
      throw ERRORS.VALIDATION_FAILED('amount must be a non-zero integer');
    }
    if (Math.abs(amount) > MAX_GRANT_MAGNITUDE) {
      throw ERRORS.VALIDATION_FAILED(`amount magnitude must be <= ${MAX_GRANT_MAGNITUDE}`);
    }

    const user = await userRepo.findByEmailInsensitive(input.email);
    if (!user) throw ERRORS.USER_NOT_FOUND();

    const note = input.note?.trim() || undefined;
    const ledger = await db.transaction((tx) =>
      creditService.applyDelta(tx, user.id, amount, 'ADMIN_ADJUST', {
        meta: { actorId, ...(note ? { note } : {}) },
      }),
    );

    logger.info(
      { actorId, action: 'admin.grantCredit', targetUserId: user.id, amount },
      'admin credit grant',
    );

    return {
      email: user.email,
      delta: amount,
      balanceAfter: ledger.balanceAfter,
    };
  },

  // Manual account creation for users who cannot self-register (e.g. domestic
  // users who never receive the verification email or are blocked from Google
  // OAuth). Creates the user pre-verified so they can log in immediately, plus a
  // matching better-auth `credential` account holding the hashed password. The
  // password is hashed through better-auth's own context so the resulting login
  // is byte-for-byte identical to a normal sign-up. User row + credential account
  // commit together so a half-created account can never exist (invariant 8).
  async createUser(
    actorId: string,
    input: { email: string; password: string; name?: string },
  ) {
    const email = input.email.trim().toLowerCase();
    const password = input.password;
    const name = input.name?.trim() || undefined;

    if (password.length < 8 || password.length > 128) {
      throw ERRORS.VALIDATION_FAILED('password must be 8–128 characters');
    }

    const existing = await userRepo.findByEmailInsensitive(email);
    if (existing) throw ERRORS.USER_EXISTS();

    const ctx = await getAuth().$context;
    const hashed = await ctx.password.hash(password);

    const user = await db.transaction(async (tx) => {
      const created = await userRepo.upsertById(tx, {
        email,
        name,
        emailVerified: true,
        creditBalance: FREE_PLAN_CREDITS,
      });
      await tx.insert(accounts).values({
        userId: created.id,
        // better-auth stores email/password logins under the `credential`
        // provider with accountId == user id; match that exactly.
        accountId: created.id,
        providerId: 'credential',
        password: hashed,
      });
      return created;
    });

    logger.info(
      { actorId, action: 'admin.createUser', targetUserId: user.id },
      'admin manual user create',
    );

    return { id: user.id, email: user.email, creditBalance: user.creditBalance };
  },

  // Create a shareable invite code (for referral / 小红书 campaigns). Code is
  // normalized to the same upper+trim shape redemption compares against, so the
  // operator can type it any case. maxRedemptions null = no cap on total uses
  // (still one-per-user via the redemption unique index). Duplicate code is a
  // hard 409 — codes are the public credential, silently reusing one would let a
  // new campaign inherit an old code's spent redemptions.
  async createInviteCode(
    actorId: string,
    input: { code: string; credits: number; expiryDays: number; maxRedemptions: number | null },
  ) {
    const code = input.code.trim().toUpperCase().slice(0, 64);
    if (!code) throw ERRORS.VALIDATION_FAILED('code is required');
    if (!Number.isInteger(input.credits) || input.credits <= 0 || input.credits > MAX_INVITE_CREDITS) {
      throw ERRORS.VALIDATION_FAILED(`credits must be 1..${MAX_INVITE_CREDITS}`);
    }
    if (
      !Number.isInteger(input.expiryDays) ||
      input.expiryDays <= 0 ||
      input.expiryDays > MAX_INVITE_EXPIRY_DAYS
    ) {
      throw ERRORS.VALIDATION_FAILED(`expiryDays must be 1..${MAX_INVITE_EXPIRY_DAYS}`);
    }
    const maxRedemptions = input.maxRedemptions;
    if (maxRedemptions !== null && (!Number.isInteger(maxRedemptions) || maxRedemptions <= 0)) {
      throw ERRORS.VALIDATION_FAILED('maxRedemptions must be a positive integer or empty');
    }

    const existing = await db.select().from(inviteCodes).where(eq(inviteCodes.code, code)).limit(1);
    if (existing.length > 0) throw ERRORS.INVITE_CODE_EXISTS();

    const expiresAt = new Date(Date.now() + input.expiryDays * DAY_MS);
    const [row] = await db
      .insert(inviteCodes)
      .values({ code, credits: input.credits, expiresAt, maxRedemptions })
      .returning();

    logger.info(
      { actorId, action: 'admin.createInviteCode', code, credits: input.credits },
      'admin invite code created',
    );

    return {
      code: row.code,
      credits: row.credits,
      expiresAt: row.expiresAt,
      maxRedemptions: row.maxRedemptions,
    };
  },

  async listInviteCodes(_actorId: string) {
    const rows = await db
      .select()
      .from(inviteCodes)
      .orderBy(desc(inviteCodes.createdAt))
      .limit(100);
    return rows.map((r) => ({
      code: r.code,
      credits: r.credits,
      redeemedCount: r.redeemedCount,
      maxRedemptions: r.maxRedemptions,
      active: r.active,
      expiresAt: r.expiresAt,
      createdAt: r.createdAt,
    }));
  },

  async getAnalytics(_actorId: string, now: Date = new Date()) {
    const since7d = new Date(now.getTime() - 7 * DAY_MS);
    const since30d = new Date(now.getTime() - 30 * DAY_MS);

    const [
      totalUsers,
      newUsers7d,
      newUsers30d,
      totalAlbums,
      newAlbums7d,
      newAlbums30d,
      albumStatusRows,
      jobStatusRows,
      creditsPurchased30d,
      creditsSettled30d,
    ] = await Promise.all([
      userRepo.count(),
      userRepo.countCreatedSince(since7d),
      userRepo.countCreatedSince(since30d),
      albumRepo.count(),
      albumRepo.countCreatedSince(since7d),
      albumRepo.countCreatedSince(since30d),
      albumRepo.countByStatus(),
      agentJobRepo.countByStatus(),
      creditLedgerRepo.sumByReasonSince('PURCHASE', since30d),
      creditLedgerRepo.sumByReasonSince('GENERATION_SETTLE', since30d),
    ]);

    return {
      users: { total: totalUsers, last7d: newUsers7d, last30d: newUsers30d },
      albums: { total: totalAlbums, last7d: newAlbums7d, last30d: newAlbums30d },
      albumsByStatus: albumStatusRecord(albumStatusRows),
      jobsByStatus: jobStatusRecord(jobStatusRows),
      credits: {
        purchased30d: creditsPurchased30d,
        // settle deltas are negative; report consumption as a positive number
        consumed30d: -creditsSettled30d,
      },
    };
  },

  // Manual trigger for the same safety net cron would run. The daily cron does
  // two independent cleanups (rebuild-tech-plan §12): the zombie sweeper releases
  // stale RUNNING agent_jobs, and the draft-expiry sweeper releases the holds of
  // idle drafts past 24h (EDITING + draft_json, never finalized). Both delegate
  // to their own sweeper — no duplicate cleanup logic here.
  async recoverStuck(actorId: string) {
    logger.info({ actorId, action: 'admin.recoverStuck' });
    const zombies = await zombieSweeper.sweep('system');
    const expiredDrafts = await draftExpirySweeper.sweep('system');
    return { ...zombies, expiredDrafts };
  },

  // Janitorial purge of dead FAILED albums. Invariant 1 means there are no
  // server-side photos to delete; this clears the stale album rows their
  // generations left behind. credit_ledger.related_album_id is set null on
  // delete, so the audit trail survives. Holds never moved balance, so dropping
  // them via cascade is credit-safe.
  async cleanupAbandoned(actorId: string, opts: { olderThanDays?: number } = {}) {
    const days = Math.min(Math.max(opts.olderThanDays ?? DEFAULT_CLEANUP_DAYS, 1), 365);
    const cutoff = new Date(Date.now() - days * DAY_MS);

    const stale = await albumRepo.findFailedOlderThan(cutoff);
    let deleted = 0;

    if (stale.length > 0) {
      await db.transaction(async (tx) => {
        for (const album of stale) {
          await albumRepo.delete(tx, album.id);
          deleted += 1;
        }
      });
    }

    logger.info({ actorId, action: 'admin.cleanupAbandoned', days, deleted }, 'admin cleanup');
    return { scanned: stale.length, deleted };
  },

  // 游客(匿名影子账号)清理:创建超过 N 天仍未转正的匿名用户,连同名下相册/任务/
  // 消息一起删(schema 里 11 处 onDelete:'cascade' 收尾)。转正过的用户在
  // onLinkAccount 时已被 anonymous 插件删除并过户,这里扫到的只剩「来了没登录」的。
  // 游客零积分变动、零 R2 写入,删行即删干净 —— 没有对象存储要跟着清。
  async cleanupAnonymous(actorId: string, opts: { olderThanDays?: number } = {}) {
    const days = Math.min(Math.max(opts.olderThanDays ?? ANON_CLEANUP_DAYS, 1), 365);
    const cutoff = new Date(Date.now() - days * DAY_MS);

    const stale = await userRepo.findAnonymousCreatedBefore(cutoff);
    let deleted = 0;

    if (stale.length > 0) {
      await db.transaction(async (tx) => {
        for (const user of stale) {
          await userRepo.deleteById(tx, user.id);
          deleted += 1;
        }
      });
    }

    logger.info({ actorId, action: 'admin.cleanupAnonymous', days, deleted }, 'anon cleanup');
    return { scanned: stale.length, deleted };
  },

  // draft_pages 行修复(2026-08-03 线上事故):0024 回填按页对象的 pageIndex 字段落行,
  // 老相册字段稀疏/重复时行集被打散、重复字段的页被 ON CONFLICT 静默丢弃。以 legacy
  // draftJson.pages 的**数组顺序**为真相重建行(页内 pageIndex 字段一并归一到位置值,
  // 行 version 对齐该相册当前 draft_revision)。envelope-only 相册(design-chat 提交过,
  // 行即真相)被 jsonb_typeof 守卫天然跳过。单事务,幂等 —— 走 admin 接口是因为生产
  // DATABASE_URL 是 sensitive env,本地拉不出来,只有生产运行时自己拿得到。
  async repairDraftPages(actorId: string): Promise<{ rows: number; albums: number }> {
    const stats = await db.transaction(async (tx) => {
      await tx.execute(sql`
        DELETE FROM draft_pages d
        USING albums a
        WHERE d.album_id = a.id
          AND jsonb_typeof(a.draft_json->'pages') = 'array'`);
      // FOR KEY SHARE:把要写子行的 album 行先锁住,挡掉并发删除。不锁的话
      // 「一边跑修复、一边有用户删相册」会在插入的瞬间撞 draft_pages 的外键
      // (album_id 已经没了)——整个修复事务回滚,admin 拿到 500。KEY SHARE 是能
      // 挡 DELETE 的最弱锁:它只与 FOR UPDATE(删除取的锁)冲突,正常改书的
      // UPDATE 照跑不误。
      await tx.execute(sql`
        WITH locked AS (
          SELECT id, draft_json, draft_revision
          FROM albums
          WHERE jsonb_typeof(draft_json->'pages') = 'array'
          FOR KEY SHARE
        )
        INSERT INTO draft_pages (album_id, page_index, page, version, updated_by)
        SELECT a.id,
               p.ord::int - 1,
               jsonb_set(p.elem, '{pageIndex}', to_jsonb(p.ord::int - 1)),
               GREATEST(a.draft_revision, 1),
               NULL
        FROM locked a,
             LATERAL jsonb_array_elements(a.draft_json->'pages') WITH ORDINALITY AS p(elem, ord)`);
      await tx.execute(sql`
        UPDATE albums SET draft_revision = GREATEST(draft_revision, 1)
        WHERE jsonb_typeof(draft_json->'pages') = 'array'`);
      const counted = await tx.execute(sql`
        SELECT count(*)::int AS rows, count(DISTINCT album_id)::int AS albums FROM draft_pages`);
      const first = (counted as unknown as Array<{ rows: number; albums: number }>)[0];
      return { rows: first?.rows ?? 0, albums: first?.albums ?? 0 };
    });
    logger.info({ actorId, action: 'admin.repairDraftPages', ...stats }, 'draft_pages repaired');
    return stats;
  },
};
