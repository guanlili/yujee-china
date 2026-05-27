import { db } from '@/db/client';
import { agentJobRepo } from '@/db/repos/agent-job-repo';
import { albumRepo } from '@/db/repos/album-repo';
import { creditService } from '@/services/credit/credit-service';
import { logger } from '@/lib/log/logger';

const DEFAULT_RUNNING_TIMEOUT_MS = 10 * 60 * 1000; // 10 min

type SweepResult = {
  scanned: number;
  failed: number;
  releasedHolds: number;
};

type Actor = 'system';
type SweepOpts = { now?: Date; timeoutMs?: number };

// Run by a future cron; the `system` actor satisfies invariant 7 since
// the sweeper acts on all stale jobs, not on behalf of one user.
export const zombieSweeper = {
  async sweep(_actor: Actor, opts: SweepOpts = {}): Promise<SweepResult> {
    const now = opts.now ?? new Date();
    const timeoutMs = opts.timeoutMs ?? DEFAULT_RUNNING_TIMEOUT_MS;
    const cutoff = new Date(now.getTime() - timeoutMs);

    const stale = await agentJobRepo.findStaleRunning(cutoff);

    let failed = 0;
    let releasedHolds = 0;

    for (const job of stale) {
      try {
        const album = await albumRepo.findById(job.albumId);
        const holdId = album?.creditHoldId ?? null;

        // Invariant 8: job FAILED + album FAILED + hold RELEASED must
        // commit together or not at all, otherwise credit stays HOLDING.
        await db.transaction(async (tx) => {
          await agentJobRepo.update(tx, job.id, {
            status: 'FAILED',
            error: {
              code: 'AGENT_TIMEOUT',
              message: `RUNNING > ${timeoutMs}ms without callback`,
            },
            completedAt: now,
          });

          await albumRepo.update(tx, job.albumId, {
            status: 'FAILED',
            errorMessage: 'Generation timed out. No credit was charged.',
          });

          if (holdId) {
            await creditService.release(tx, holdId);
          }
        });

        failed += 1;
        if (holdId) releasedHolds += 1;
      } catch (err) {
        logger.error(
          { jobId: job.id, requestId: job.requestId, err },
          'zombie sweep failed for job',
        );
      }
    }

    if (stale.length > 0) {
      logger.info(
        { scanned: stale.length, failed, releasedHolds, cutoff: cutoff.toISOString() },
        'zombie sweeper run',
      );
    }

    return { scanned: stale.length, failed, releasedHolds };
  },
};
