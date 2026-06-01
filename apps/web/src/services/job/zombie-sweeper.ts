import { agentJobRepo } from '@/db/repos/agent-job-repo';
import { jobService } from '@/services/job/job-service';
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

    // Candidates from a snapshot; jobService.sweepStaleJob re-validates each under
    // a row lock (so a heartbeat/callback that landed in between is respected) and
    // does the atomic job+album+credit transition. Same code path as the read-path
    // sweep — one definition of "fail a zombie", no duplication or divergence.
    const stale = await agentJobRepo.findStaleRunning(cutoff);

    let failed = 0;
    let releasedHolds = 0;

    for (const job of stale) {
      try {
        const { swept, releasedHold } = await jobService.sweepStaleJob(job.id, now, timeoutMs);
        if (swept) {
          failed += 1;
          if (releasedHold) releasedHolds += 1;
        }
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
