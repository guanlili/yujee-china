// 草稿增量轮询协调器(collab plan §10):2.5s 拉 draft-changes,把远端页面按
// 「本地状态裁决表」应用到本地。桌面/移动共用,时钟/可见性/网络全部可注入。
//
// 行为(§10.1,逐条有测试):
//  - 默认 2500ms 轮询;上一次未结束不发下一次(无重叠);
//  - hidden 暂停,恢复可见(poke)立即同步一次;
//  - 网络失败退避 2.5s→5s→10s,成功恢复 2.5s;
//  - 401/403 停止轮询(交给登录/权限处理);
//  - reloadRequired/structureChanged → 整书重载(同样不覆盖 dirty/conflict 页);
//  - 只有响应被成功处理后才推进已知 revision;dirty/conflict 页的远端内容经
//    markRemoteChanged 保存在内存供提示使用。

export type SyncRemotePage = {
  pageIndex: number;
  version: number;
  updatedBy: string | null;
  updatedAt: string;
  page: unknown;
};

export type SyncChanges = {
  /** 判别字段:fetchChanges 成功分支统一携带,便于与 error/unauthorized 区分。 */
  kind: 'changes';
  revision: number;
  structureChanged: boolean;
  reloadRequired: boolean;
  pages: SyncRemotePage[];
};

export type SyncFetchResult =
  | SyncChanges
  | { kind: 'error' }
  | { kind: 'unauthorized' }
  | { kind: 'deferred' };

export type DraftSyncSource = {
  fetchChanges(since: number): Promise<SyncFetchResult>;
  /** 整书重载。返回 'deferred' 表示宿主暂缓(如本地有未保存编辑),核心保持
   *  原 since 等下一轮重试,不计失败、不推进 revision。 */
  reloadDraft(): Promise<
    | { kind: 'reloaded'; revision: number; pages: SyncRemotePage[] }
    | { kind: 'error' | 'unauthorized' | 'deferred' }
  >;
};

export type LocalPageState = {
  /** dirty/saving:本地有未落库编辑。 */
  dirty: boolean;
  /** conflict:保存已被 409,等待用户选择。 */
  conflict: boolean;
  /** 本地已确认的页面 version;null = 未知(legacy/排版前)。 */
  version: number | null;
};

export type DraftSyncHost = {
  localPageState(pageIndex: number): LocalPageState;
  /** 干净页:用远端内容替换本地页并重绘。 */
  applyPage(remote: SyncRemotePage): void;
  /** dirty/conflict 页:不替换,但远端版本已前进 —— 保存完整远端页供提示用。 */
  markRemoteChanged(remote: SyncRemotePage): void;
};

// 裁决表(§10.2/§10.3):同 version(自己刚保存的回声,§10.3)与更低 version
// 一律忽略 —— 不依赖 updatedBy 判断,同一用户多标签页同样成立。
export function decidePageApply(
  remote: { version: number },
  local: LocalPageState,
): 'replace' | 'skip-dirty' | 'skip-conflict' | 'ignore' {
  if (local.conflict) return 'skip-conflict';
  if (local.dirty) return 'skip-dirty';
  if (local.version === null) return 'replace';
  return remote.version > local.version ? 'replace' : 'ignore';
}

export type DraftSync = {
  start(): void;
  stop(): void;
  /** 立即同步一次(恢复可见时调用;hidden 时是 no-op)。 */
  poke(): void;
};

export function createDraftSync(opts: {
  source: DraftSyncSource;
  host: DraftSyncHost;
  getRevision(): number;
  setRevision(revision: number): void;
  intervalMs?: number;
  backoffSteps?: number[];
  sleep?: (ms: number) => Promise<void>;
  isVisible?: () => boolean;
}): DraftSync {
  const interval = opts.intervalMs ?? 2500;
  const backoff = opts.backoffSteps ?? [2500, 5000, 10000];
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  // 无 DOM 环境(单测/SSR)视为可见,由注入方显式控制可见性语义。
  const isVisible =
    opts.isVisible ??
    (() => (typeof document === 'undefined' ? true : document.visibilityState === 'visible'));

  let stopped = false;
  let inFlight = false;
  let failures = 0;

  // 退避(§10.1):第 1 次失败等 2500,第 2 次 5000,第 3 次起封顶 10000;
  // 成功立即恢复 interval。
  const nextDelay = () =>
    failures === 0 ? interval : backoff[Math.min(failures - 1, backoff.length - 1)]!;

  function applyAll(pages: SyncRemotePage[]) {
    for (const remote of pages) {
      const verdict = decidePageApply(remote, opts.host.localPageState(remote.pageIndex));
      if (verdict === 'replace') opts.host.applyPage(remote);
      else if (verdict === 'skip-dirty' || verdict === 'skip-conflict') {
        opts.host.markRemoteChanged(remote);
      }
    }
  }

  async function poll(): Promise<void> {
    if (stopped || inFlight || !isVisible()) return;
    inFlight = true;
    try {
      const res = await opts.source.fetchChanges(opts.getRevision());
      if (stopped) return;
      if (res.kind === 'unauthorized') {
        stopped = true; // 401/403:停止轮询,交给登录/权限处理
        return;
      }
      if (res.kind === 'error') {
        failures = Math.min(failures + 1, backoff.length);
        return;
      }
      if (res.kind !== 'changes') return; // 宿主暂缓(deferred),原 since 重试
      failures = 0;
      if (res.reloadRequired || res.structureChanged) {
        await reload();
        return;
      }
      applyAll(res.pages);
      // 只有成功处理后才推进 revision(§10.2)。被跳过的 dirty 页远端内容已在
      // markRemoteChanged 留存,推进不会让这批变化再也取不到。
      opts.setRevision(res.revision);
    } finally {
      inFlight = false;
    }
  }

  async function reload(): Promise<void> {
    const res = await opts.source.reloadDraft();
    if (stopped) return;
    if (res.kind === 'unauthorized') {
      stopped = true;
      return;
    }
    if (res.kind === 'error') {
      failures = Math.min(failures + 1, backoff.length);
      return;
    }
    if (res.kind !== 'reloaded') return; // deferred:暂缓重载,原 since 重试
    failures = 0;
    applyAll(res.pages);
    opts.setRevision(res.revision);
  }

  async function loop(): Promise<void> {
    while (!stopped) {
      await poll();
      if (stopped) return;
      await sleep(nextDelay());
    }
  }

  return {
    start() {
      stopped = false;
      void loop();
    },
    stop() {
      stopped = true;
    },
    poke() {
      void poll();
    },
  };
}
