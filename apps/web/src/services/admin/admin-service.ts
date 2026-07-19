import { db } from '@/db/client';
import { accounts } from '@/db/schema';
import { getAuth } from '@/lib/auth/better-auth';
import { FREE_PLAN_CREDITS } from '@/config/pricing';
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

  async listUsers(_actorId: string, opts: { limit?: number; offset?: number } = {}) {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
    const offset = Math.max(opts.offset ?? 0, 0);

    const users = await userRepo.listRecent(limit, offset);
    const albumCounts = await albumRepo.countByUserIds(users.map((u) => u.id));
    const countByUser = new Map(albumCounts.map((c) => [c.userId, c.count]));

    return {
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        isAdmin: u.isAdmin,
        creditBalance: u.creditBalance,
        albumCount: countByUser.get(u.id) ?? 0,
        createdAt: u.createdAt,
      })),
      limit,
      offset,
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
};
