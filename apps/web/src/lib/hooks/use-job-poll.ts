'use client';

import { useEffect, useState } from 'react';

export type JobPollStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'TIMEOUT';

export interface JobPollState {
  status: JobPollStatus;
  stage: string | null;
  progress: number;
  error: { code: string; message: string } | null;
  albumId: string | null;
}

// 15s, not 2s: the browser only polls Web's own DB — the Agent runs the
// pipeline and callbacks when each stage lands, so tight polling just adds load
// without making the album arrive sooner.
const POLL_MS = 15000;
// 3.5 min, just above the Agent's background_task_timeout_seconds=180 so a slow
// run (composing up to 60s/call + a repair) has time to finish and the browser
// still polls once more to catch the Agent's terminal callback before giving up.
const FALLBACK_TIMEOUT_MS = 3.5 * 60 * 1000;

const INITIAL: JobPollState = {
  status: 'QUEUED',
  stage: null,
  progress: 0,
  error: null,
  albumId: null,
};

// Polls GET /api/v1/jobs/[requestId] every 15s (docs/web/api.md §5). Stops on a
// terminal status or after a 3.5-minute fallback so a lost job can't spin forever.
export function useJobPoll(requestId: string | null): JobPollState {
  const [state, setState] = useState<JobPollState>(INITIAL);

  useEffect(() => {
    if (!requestId) return;
    let stopped = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const startedAt = Date.now();

    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };

    const tick = async () => {
      if (stopped) return;
      if (Date.now() - startedAt > FALLBACK_TIMEOUT_MS) {
        setState((s) => ({ ...s, status: 'TIMEOUT' }));
        stop();
        return;
      }
      try {
        const res = await fetch(`/api/v1/jobs/${requestId}`);
        const json = await res.json();
        if (!json.ok) return;
        const d = json.data;
        setState({
          status: d.status,
          stage: d.stage ?? null,
          progress: d.progress ?? 0,
          error: d.error ?? null,
          albumId: d.albumId ?? null,
        });
        if (d.status === 'COMPLETED' || d.status === 'FAILED') stop();
      } catch {
        // transient network error — keep polling, it's stateless
      }
    };

    tick();
    timer = setInterval(tick, POLL_MS);
    return () => {
      stopped = true;
      stop();
    };
  }, [requestId]);

  return state;
}
