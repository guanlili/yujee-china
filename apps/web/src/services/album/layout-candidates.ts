import type { SelectLayoutCandidateUnit } from '@yujee/contracts';

// Process-local request-window storage for P2 select-layout candidate structures
// (docs/agent/contract.md §5.2.1). The `candidates` callback stashes the Agent's
// candidate units here keyed by the (analyze/init) requestId; the browser reads
// them back through GET /api/v3/albums/:id/judge-layout, renders a thumbnail per
// candidate, then POSTs them to phase 2.
//
// Per the contract Web does NOT persist candidates (they are bulky structures, not
// album state): they live only in memory/session. On a multi-instance deploy a
// callback and a poll can land on different instances — that is acceptable: a miss
// degrades to the documented fallback (browser/Web take candidate 0 per unit and
// the deterministic skeleton still finishes the album). Mirrors
// `transientPagePhotoRefs`; #265 can add TTL/cap management later.

// 钉在 globalThis 上(prisma/db 单例同款手法):next dev 里写方(job-progress 路由)和
// 读方(judge-layout 路由)是两个编译入口,各自实例化本模块 —— 裸模块级 Map 会变成两份,
// 回调暂存的候选对轮询侧永远不可见(GET 恒 ready:false,job 最终被僵尸清扫收走)。
// globalThis 每进程一份,跨路由图、跨 HMR 重编译存活;生产单实例行为不变。
const g = globalThis as { __yujeeLayoutCandidates?: Map<string, SelectLayoutCandidateUnit[]> };
const unitsByRequest = (g.__yujeeLayoutCandidates ??= new Map<string, SelectLayoutCandidateUnit[]>());

export const transientLayoutCandidates = {
  set(requestId: string, units: SelectLayoutCandidateUnit[]): void {
    if (units.length === 0) unitsByRequest.delete(requestId);
    else unitsByRequest.set(requestId, units);
  },

  get(requestId: string): SelectLayoutCandidateUnit[] | undefined {
    return unitsByRequest.get(requestId);
  },

  clear(requestId: string): void {
    unitsByRequest.delete(requestId);
  },

  resetForTest(): void {
    unitsByRequest.clear();
  },
};
