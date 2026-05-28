import { db } from '@/db/client';
import { userRepo } from '@/db/repos/user-repo';
import { albumRepo } from '@/db/repos/album-repo';
import { agentJobRepo } from '@/db/repos/agent-job-repo';
import { creditLedgerRepo } from '@/db/repos/credit-ledger-repo';
import { zombieSweeper } from '@/services/job/zombie-sweeper';
import { logger } from '@/lib/log/logger';

const STUCK_CUTOFF_MS = 5 * 60 * 1000;
const DEFAULT_CLEANUP_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

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

  // Manual trigger for the same safety net cron would run. Delegates entirely
  // to the zombie sweeper — no duplicate cleanup logic here.
  async recoverStuck(actorId: string) {
    logger.info({ actorId, action: 'admin.recoverStuck' });
    return zombieSweeper.sweep('system');
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
