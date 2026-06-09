import { db } from '@/db/client';
import { albumRepo } from '@/db/repos/album-repo';
import { creditService } from '@/services/credit/credit-service';
import { logger } from '@/lib/log/logger';

// requirements §10.5 / rebuild-tech-plan §12: a draft idle for 24h releases its
// reserved credit. The existing zombie sweeper scans stale agent_jobs (RUNNING
// with no callback) — an idle draft is EDITING with no RUNNING job, so it would
// never be caught there. This is the second, independent sweep.
const DEFAULT_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24h

type Actor = 'system';
type SweepOpts = { now?: Date; expiryMs?: number };
type SweepResult = { scanned: number; releasedHolds: number };

// Release the HOLDING hold of one expired idle draft in a single transaction
// (invariant 8). The album stays EDITING with its draft_json intact — the user
// can still return; finalize then re-holds via ensureHold (W7b, §12.1). release
// no-ops on an already-released hold, so concurrent sweeps (cron + read-path)
// race safely. Returns true if a hold was released. Shared by the cron sweep and
// the read-time opportunistic path so there is one definition of "release an
// expired draft", no divergence.
async function releaseExpiredDraftHold(holdId: string): Promise<boolean> {
  try {
    await db.transaction(async (tx) => {
      await creditService.release(tx, holdId);
    });
    return true;
  } catch (err) {
    logger.error({ holdId, err }, 'draft-expiry release failed for hold');
    return false;
  }
}

// Read-time opportunistic sweep, mirroring jobService.resolveGeneration's role
// for zombies: when albumService.getDetail / listByUser touches an EDITING album,
// check whether it is an idle draft past the cutoff and, if so, release its hold
// on the spot. Returns true if a hold was released. Safe to call on any album —
// the per-album predicate (EDITING + draft_json + layout_json null + HOLDING +
// updated_at < cutoff) returns null when it doesn't match.
async function sweepAlbumOnRead(albumId: string, opts: SweepOpts = {}): Promise<boolean> {
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - (opts.expiryMs ?? DEFAULT_EXPIRY_MS));
  const holdId = await albumRepo.findExpiredDraftHold(albumId, cutoff);
  if (!holdId) return false;
  const released = await releaseExpiredDraftHold(holdId);
  if (released) {
    logger.info({ albumId, holdId }, 'draft-expiry release on read');
  }
  return released;
}

// Daily cron sweep (folded into recover-stuck): scan every expired idle draft and
// release its hold. Idempotent — re-running is a no-op once holds are RELEASED.
// The `system` actor satisfies invariant 7 (acts on all stale drafts, not one
// user's behalf).
export const draftExpirySweeper = {
  sweepAlbumOnRead,

  async sweep(_actor: Actor, opts: SweepOpts = {}): Promise<SweepResult> {
    const now = opts.now ?? new Date();
    const cutoff = new Date(now.getTime() - (opts.expiryMs ?? DEFAULT_EXPIRY_MS));

    const expired = await albumRepo.findExpiredDrafts(cutoff);
    let releasedHolds = 0;
    for (const { albumId, holdId } of expired) {
      if (await releaseExpiredDraftHold(holdId)) releasedHolds += 1;
    }

    if (expired.length > 0) {
      logger.info(
        { scanned: expired.length, releasedHolds, cutoff: cutoff.toISOString() },
        'draft-expiry sweeper run',
      );
    }

    return { scanned: expired.length, releasedHolds };
  },
};
