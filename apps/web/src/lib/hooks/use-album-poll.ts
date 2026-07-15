'use client';

import { useEffect, useState } from 'react';
import type { AlbumDetail } from '@/components/album/types';
import {
  fetchJudgeCandidates,
  PhotosUnavailableError,
  renderAndSubmitJudgeLayout,
  UnauthorizedError,
} from '@/lib/generation/client';
import { albumRecipe } from '@/lib/generation/draft';

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
    let judgeSubmitInFlight = false;
    const submittedJudgeRequests = new Set<string>();
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

    // 展示同款 state 但**不进终态、不停循环**。authoring 阶段(EDITING 且未定稿)必须用
    // 这个:排版是用户在编辑器里待了几分钟后才触发的,若首个 tick 就把 ready 定为终态,
    // 循环早死,后面 candidates 停在 52 哨兵时没人取候选/渲染缩略图/派发 phase-2 ——
    // 排版永远完不成。定稿(layoutJson 落地)后才允许 ready 终态收口。
    // 信号没变就不 setState:15s 一次的存活轮询不该让编辑器整树跟着重渲染。
    let lastLiveSig = '';
    const applyLive = (next: AlbumPollState) => {
      if (stopped || settled) return;
      const album = next.detail?.album;
      const sig = [
        next.phase,
        album?.status ?? '',
        album?.layoutJson == null ? 'draft' : 'final',
        next.generation?.stage ?? '',
        next.generation?.progress ?? '',
      ].join('|');
      if (sig === lastLiveSig) return;
      lastLiveSig = sig;
      setState(next);
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
        // P2 phase 2 (docs/agent/contract.md §5.2.1): the `candidates` callback parked the
        // 独立 layout job at progress 52(解耦后这发生在相册 EDITING 下,不再是 AGENT_RUNNING)。
        // 一旦看到 candidates-ready 哨兵(layout,52)就取候选 → 渲染"照片填槽"缩略图 → POST judge-layout。
        // **必须在状态分支之前驱动**:否则 EDITING 会被下面的 early-return 拦掉,phase-2 永不触发。
        // 失败非致命:Agent/Web 兜底从候选 0 收尾,继续轮询即可。
        if (generation?.stage === 'layout' && generation.progress === 52) {
          const recipe = albumRecipe.load(uuid);
          if (recipe?.requestId && !judgeSubmitInFlight) {
            judgeSubmitInFlight = true;
            const requestId = recipe.requestId;
            const language = recipe.language;
            try {
              // 去重键 = GET 返回的「本次 layout job」requestId(每次排版都换),不能用
              // recipe.requestId(analyze 的,追加照片后不变):否则首次生成派发过 judge
              // 后,追加照片的增量排版会被永远挡在 52 —— judge/write_copy(写文案跑在
              // judge 里)不再触发。重复 POST 由服务端 52→53 CAS 兜底,无害。
              const { ready, units, requestId: layoutRequestId } = await fetchJudgeCandidates(uuid, requestId);
              if (
                ready &&
                units.length > 0 &&
                layoutRequestId &&
                !submittedJudgeRequests.has(layoutRequestId)
              ) {
                await renderAndSubmitJudgeLayout(uuid, { requestId, language, units });
                submittedJudgeRequests.add(layoutRequestId);
              }
            } catch (e) {
              if (e instanceof UnauthorizedError) {
                return apply({ ...INITIAL, phase: 'unauthorized' });
              }
              // Swallow render/dispatch errors — keep polling; the fallback completes.
            } finally {
              judgeSubmitInFlight = false;
            }
          }
          // 排版进行中:phase 保持 ready(解耦后用户就在编辑器里,切 running 会闪回
          // building 壳),但不进终态 —— 循环要活着等 completed 落 draft。
          return applyLive({ detail, generation, phase: 'ready', error: null });
        }
        if (status === 'EDITING' || status === 'COMPLETED') {
          const authoring = status === 'EDITING' && detail.album.layoutJson == null;
          if (authoring || generation != null) {
            // 未定稿(authoring)或仍有活跃 layout job:保持轮询,phase-2 哨兵靠本循环驱动。
            return applyLive({ detail, generation, phase: 'ready', error: null });
          }
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
