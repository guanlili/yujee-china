import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDraftSync,
  decidePageApply,
  type LocalPageState,
  type SyncChanges,
  type SyncFetchResult,
  type SyncRemotePage,
} from './draft-sync';

// ── 手动时钟:测试逐拍推进 loop 的 sleep ──────────────────────────────────────
function createManualSleep() {
  const waits: Array<() => void> = [];
  const delays: number[] = [];
  const sleep = (ms: number) => {
    delays.push(ms);
    return new Promise<void>((resolve) => waits.push(resolve));
  };
  const advance = async () => {
    waits.shift()?.();
    // 让 loop 的「poll 完成 + 下一轮 poll 发出」都跑完再交还测试(两拍宏任务)。
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  };
  return { sleep, delays, advance, pending: () => waits.length };
}

const remote = (pageIndex: number, version: number): SyncRemotePage => ({
  pageIndex,
  version,
  updatedBy: 'other-user',
  updatedAt: '2026-08-27T10:00:00.000Z',
  page: { pageIndex, version },
});

const changes = (over: Partial<SyncChanges>): SyncChanges => ({
  kind: 'changes',
  revision: 10,
  structureChanged: false,
  reloadRequired: false,
  pages: [],
  ...over,
});

function createHost(states: Record<number, LocalPageState>) {
  const applied: number[] = [];
  const marked: SyncRemotePage[] = [];
  return {
    host: {
      localPageState: (pageIndex: number) =>
        states[pageIndex] ?? { dirty: false, conflict: false, version: null },
      applyPage: (r: SyncRemotePage) => applied.push(r.pageIndex),
      markRemoteChanged: (r: SyncRemotePage) => marked.push(r),
    },
    applied,
    marked,
  };
}

// ── 裁决表(§10.2/§10.3)──────────────────────────────────────────────────────
test('decidePageApply: 干净页高版本替换 / dirty、conflict 跳过 / 同版本与低版本忽略', () => {
  const clean = { dirty: false, conflict: false, version: 5 };
  assert.equal(decidePageApply({ version: 6 }, clean), 'replace');
  assert.equal(decidePageApply({ version: 5 }, clean), 'ignore', '同版本=自己的回声(§10.3)');
  assert.equal(decidePageApply({ version: 4 }, clean), 'ignore');
  assert.equal(decidePageApply({ version: 9 }, { ...clean, dirty: true }), 'skip-dirty');
  assert.equal(decidePageApply({ version: 9 }, { ...clean, conflict: true }), 'skip-conflict');
  assert.equal(decidePageApply({ version: 1 }, { dirty: false, conflict: false, version: null }), 'replace',
    '本地版本未知(legacy)→ 替换');
});

// ── 轮询循环(§10.1)──────────────────────────────────────────────────────────
test('2.5 秒轮询节奏,请求无重叠;hidden 不发,visible poke 立即同步', async () => {
  const clock = createManualSleep();
  let visible = true;
  let fetchCount = 0;
  let revision = 7;
  const { host, applied } = createHost({});

  const sync = createDraftSync({
    source: {
      fetchChanges: async () => {
        fetchCount += 1;
        return changes({ revision: 10 });
      },
      reloadDraft: async () => ({ kind: "reloaded", revision: 10, pages: [] }),
    },
    host,
    getRevision: () => revision,
    setRevision: (r) => { revision = r; },
    sleep: clock.sleep,
    isVisible: () => visible,
  });

  sync.start();
  await new Promise((r) => setTimeout(r, 0)); // 首轮立即 poll
  assert.equal(fetchCount, 1);
  assert.equal(revision, 10);

  // poke 在两次 sleep 之间:同样立即发一次。
  sync.poke();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(fetchCount, 2);

  // 推进一拍:间隔 2500(成功后恢复默认间隔)。
  await clock.advance();
  assert.equal(fetchCount, 3);
  assert.deepEqual(clock.delays, [2500, 2500], '成功轮询间隔恒为 2500ms');

  // hidden:poke 与 loop 拍都不发请求。
  visible = false;
  await clock.advance();
  sync.poke();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(fetchCount, 3, 'hidden 时不发请求');

  // 恢复可见 + poke 立即同步。
  visible = true;
  sync.poke();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(fetchCount, 4);

  sync.stop();
});

test('在途请求不重叠:fetch 未返回时 poke 不再发', async () => {
  const clock = createManualSleep();
  let fetchCount = 0;
  const gates: Array<(r: SyncFetchResult) => void> = [];
  const sync = createDraftSync({
    source: {
      fetchChanges: () => new Promise<SyncFetchResult>((resolve) => gates.push(resolve)),
      reloadDraft: async () => ({ kind: "reloaded", revision: 0, pages: [] }),
    },
    host: createHost({}).host,
    getRevision: () => 0,
    setRevision: () => {},
    sleep: clock.sleep,
  });
  sync.start();
  await new Promise((r) => setTimeout(r, 0));
  sync.poke();
  sync.poke();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(fetchCount + gates.length, 1, '只有一个在途');
  gates.shift()!(changes({ revision: 1 }));
  await new Promise((r) => setTimeout(r, 0));
  sync.stop();
});

test('网络失败退避 2.5s→5s→10s 封顶,成功后恢复 2.5s', async () => {
  const clock = createManualSleep();
  let fail = true;
  let revision = 0;
  const sync = createDraftSync({
    source: {
      fetchChanges: async () => (fail ? { kind: 'error' } : changes({ revision: 3 })),
      reloadDraft: async () => ({ kind: "reloaded", revision: 0, pages: [] }),
    },
    host: createHost({}).host,
    getRevision: () => revision,
    setRevision: (r) => { revision = r; },
    sleep: clock.sleep,
  });
  sync.start();
  await new Promise((r) => setTimeout(r, 0)); // 失败1
  await clock.advance(); // 失败2
  await clock.advance(); // 失败3
  await clock.advance(); // 失败4(封顶)
  assert.deepEqual(clock.delays, [2500, 5000, 10000, 10000]);
  fail = false;
  await clock.advance(); // 成功 → 恢复 2500
  assert.equal(revision, 3);
  assert.deepEqual(clock.delays, [2500, 5000, 10000, 10000, 2500]);
  sync.stop();
});

test('远端页面按裁决表应用:干净页替换,dirty/conflict 标记远端变化,version 不变忽略', async () => {
  const clock = createManualSleep();
  let revision = 4;
  const { host, applied, marked } = createHost({
    0: { dirty: false, conflict: false, version: 4 },
    1: { dirty: true, conflict: false, version: 4 },
    2: { dirty: false, conflict: true, version: 4 },
    3: { dirty: false, conflict: false, version: 5 },
  });
  const sync = createDraftSync({
    source: {
      fetchChanges: async () =>
        changes({
          revision: 5,
          pages: [remote(0, 5), remote(1, 5), remote(2, 5), remote(3, 5), remote(4, 5)],
        }),
      reloadDraft: async () => ({ kind: "reloaded", revision: 0, pages: [] }),
    },
    host,
    getRevision: () => revision,
    setRevision: (r) => { revision = r; },
    sleep: clock.sleep,
  });
  sync.start();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(applied, [0, 4], '干净高版本/未知版本页被替换');
  assert.deepEqual(marked.map((m) => m.pageIndex), [1, 2], 'dirty/conflict 页保留远端内容供提示');
  assert.equal(marked[0]!.version, 5, 'markRemoteChanged 收到完整远端页');
  assert.equal(revision, 5, '成功处理后推进 revision');
  sync.stop();
});

test('reloadRequired/structureChanged → reloadDraft,同样不覆盖 dirty/conflict 页', async () => {
  const clock = createManualSleep();
  let reloadCalls = 0;
  let revision = 2;
  const { host, applied, marked } = createHost({
    1: { dirty: true, conflict: false, version: 2 },
  });
  const sync = createDraftSync({
    source: {
      fetchChanges: async () => changes({ revision: 9, structureChanged: true, reloadRequired: true }),
      reloadDraft: async () => {
        reloadCalls += 1;
        return { kind: 'reloaded', revision: 9, pages: [remote(0, 9), remote(1, 9)] };
      },
    },
    host,
    getRevision: () => revision,
    setRevision: (r) => { revision = r; },
    sleep: clock.sleep,
  });
  sync.start();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(reloadCalls, 1);
  assert.deepEqual(applied, [0]);
  assert.deepEqual(marked.map((m) => m.pageIndex), [1], '整书重载也不覆盖 dirty 页');
  assert.equal(revision, 9);
  sync.stop();
});

test('宿主暂缓(deferred):revision 不推进,下一轮以原 since 重试', async () => {
  const clock = createManualSleep();
  const sinces: number[] = [];
  let revision = 6;
  const sync = createDraftSync({
    source: {
      fetchChanges: async (since) => {
        sinces.push(since);
        return { kind: 'deferred' };
      },
      reloadDraft: async () => ({ kind: 'deferred' }),
    },
    host: createHost({}).host,
    getRevision: () => revision,
    setRevision: (r) => { revision = r; },
    sleep: clock.sleep,
  });
  sync.start();
  await new Promise((r) => setTimeout(r, 0));
  await clock.advance();
  await clock.advance();
  assert.equal(revision, 6, 'deferred 不推进 revision');
  assert.deepEqual(sinces, [6, 6, 6], '以原 since 重试');
  sync.stop();
});

test('401/403 → 停止轮询;stop 后不再发', async () => {
  const clock = createManualSleep();
  let fetchCount = 0;
  const sync = createDraftSync({
    source: {
      fetchChanges: async () => {
        fetchCount += 1;
        return { kind: 'unauthorized' };
      },
      reloadDraft: async () => ({ kind: 'unauthorized' }),
    },
    host: createHost({}).host,
    getRevision: () => 0,
    setRevision: () => {},
    sleep: clock.sleep,
  });
  sync.start();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(fetchCount, 1);
  for (let i = 0; i < 3; i += 1) await clock.advance();
  sync.poke();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(fetchCount, 1, 'unauthorized 后彻底停止');
});
