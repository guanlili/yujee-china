'use client';

import { useEffect, useState } from 'react';
import type { AlbumDetail } from '@/components/album/types';

// Album is the source of truth (docs/web/api.md §3.4): we poll GET
// /api/v1/albums/{uuid} by the addressable, ownership-checked uuid — never a
// job id carried in the URL. album.status drives the whole screen.
export type AlbumPollPhase =
  | 'loading' // first fetch in flight, nothing to show yet
  | 'running' // album AGENT_RUNNING — keep polling
  | 'ready' // EDITING / COMPLETED — render the editor
  | 'failed' // album FAILED — show the real error
  | 'unauthorized' // 401 — session gone, send to sign-in
  | 'gone' // 403 / 404 — not yours / deleted; fatal, stop
  | 'error'; // transient errors exhausted, or still running past the soft cap

export interface AlbumPollState {
  detail: AlbumDetail | null;
  generation: { stage: string | null; progress: number } | null;
  phase: AlbumPollPhase;
  error: string | null;
}

interface AlbumGetResponse extends AlbumDetail {
  generation: { stage: string | null; progress: number } | null;
}

const POLL_MS = 15000;
// Consecutive 5xx / network failures tolerated before we surface an error,
// instead of the old hook's silent infinite retry. ~1 min at 15s spacing.
// "Consecutive" because any successful tick resets the counter to 0 (see below),
// so scattered blips during a healthy generation never accumulate to the cap.
const MAX_TRANSIENT = 4;
// Soft ceiling on a still-RUNNING album. The backend opportunistically sweeps a
// dead job to FAILED within 5 min (job-service ZOMBIE_TIMEOUT_MS), so anything
// genuinely broken resolves before this; crossing it means a rare alive-but-slow
// run — we stop the background loop and let the user refresh, never claim failure.
const SOFT_CEILING_MS = 6 * 60 * 1000;

const INITIAL: AlbumPollState = {
  detail: null,
  generation: null,
  phase: 'loading',
  error: null,
};

// Terminal phases stop the poll loop; only 'loading' and 'running' keep it alive.
// 'error' is terminal too — it's only set once we've given up (transient cap hit
// or soft ceiling crossed); the user refreshes to restart, which re-runs the poll.
function isTerminal(phase: AlbumPollPhase): boolean {
  return phase !== 'loading' && phase !== 'running';
}

export function useAlbumPoll(uuid: string): AlbumPollState {
  const [state, setState] = useState<AlbumPollState>(INITIAL);

  useEffect(() => {
    let stopped = false;
    // settled: a terminal phase has been applied. Once set, ALL further applies
    // are ignored — so a slow older tick that resolves after a newer tick reached
    // a terminal state can't overwrite it back to running/error (which would leave
    // the page stuck, since the interval is already cleared).
    let settled = false;
    // inFlight: one request at a time. If a poll outlasts POLL_MS, the interval
    // would otherwise stack overlapping requests; this skips a tick while one runs.
    let inFlight = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let transient = 0;
    const startedAt = Date.now();

    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };

    const apply = (next: AlbumPollState) => {
      if (stopped || settled) return;
      setState(next);
      if (isTerminal(next.phase)) {
        settled = true;
        stop();
      }
    };

    const tick = async () => {
      if (stopped || settled || inFlight) return;
      inFlight = true;
      try {
        let res: Response;
        try {
          res = await fetch(`/api/v1/albums/${uuid}`);
        } catch {
          // Network blip — bounded retry, not silent-forever.
          if (++transient > MAX_TRANSIENT) {
            apply({ ...INITIAL, phase: 'error', error: 'Lost connection. Refresh to retry.' });
          }
          return;
        }

        // Fatal, deterministic statuses: stop and tell the truth.
        if (res.status === 401) return apply({ ...INITIAL, phase: 'unauthorized' });
        if (res.status === 403 || res.status === 404) {
          return apply({ ...INITIAL, phase: 'gone' });
        }
        if (res.status >= 500) {
          if (++transient > MAX_TRANSIENT) {
            apply({ ...INITIAL, phase: 'error', error: 'Server error. Refresh to retry.' });
          }
          return;
        }

        let json: { ok: boolean; data?: AlbumGetResponse; error?: { message?: string } };
        try {
          json = await res.json();
        } catch {
          if (++transient > MAX_TRANSIENT) {
            apply({ ...INITIAL, phase: 'error', error: 'Bad response. Refresh to retry.' });
          }
          return;
        }
        if (!json.ok || !json.data) {
          return apply({ ...INITIAL, phase: 'error', error: json.error?.message ?? 'Failed to load album.' });
        }

        transient = 0;
        const { generation, ...detail } = json.data;
        const status = detail.album.status;
        if (status === 'EDITING' || status === 'COMPLETED') {
          return apply({ detail, generation: null, phase: 'ready', error: null });
        }
        if (status === 'FAILED') {
          return apply({ detail, generation: null, phase: 'failed', error: detail.album.errorMessage });
        }
        // AGENT_RUNNING: keep polling unless we've crossed the soft ceiling.
        if (Date.now() - startedAt > SOFT_CEILING_MS) {
          return apply({ detail, generation, phase: 'error', error: null });
        }
        apply({ detail, generation, phase: 'running', error: null });
      } finally {
        inFlight = false;
      }
    };

    void tick();
    timer = setInterval(tick, POLL_MS);
    return () => {
      stopped = true;
      stop();
    };
  }, [uuid]);

  return state;
}
