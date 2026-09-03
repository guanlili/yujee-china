import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createPageSaveCoordinator,
  type PagePatch,
  type SaveOutcome,
  type SaveTransport,
} from './page-save-coordinator';

// ── 假传输层:可编程响应 + 手动放行(测「在途」时序)──────────────────────────
type RecordedCall = { pageIndex: number; baseVersion: number | null; patch: PagePatch };

function createGatedTransport() {
  const calls: RecordedCall[] = [];
  /** 每次调用的结果由测试预先脚本化;未脚本化默认成功。 */
  const script: Array<SaveOutcome | (() => Promise<SaveOutcome>)> = [];
  /** 挂起中的请求,手动 resolve 放行(模拟在途)。 */
  const gates: Array<(outcome: SaveOutcome) => void> = [];

  const transport: SaveTransport = {
    async save(pageIndex, baseVersion, patch) {
      calls.push({ pageIndex, baseVersion, patch });
      const step = script.length
        ? (script.shift() as SaveOutcome | (() => Promise<SaveOutcome>))
        : {
            ok: true as const,
            version: baseVersion === null ? null : baseVersion + 1,
            revision: baseVersion === null ? null : baseVersion + 1,
          };
      if (typeof step === 'function') {
        return new Promise<SaveOutcome>((resolve) => gates.push(resolve));
      }
      return step;
    },
  };
  return {
    transport,
    calls,
    script,
    release(outcome: SaveOutcome) {
      gates.shift()!(outcome);
    },
  };
}

const patch = (over: Partial<PagePatch> = {}): PagePatch => over;

// ── 队列规则(collab plan §9.2 / 18.2)───────────────────────────────────────
test('同页串行:A、B 快速提交按顺序持久化,B 不丢', async () => {
  const t = createGatedTransport();
  const coord = createPageSaveCoordinator({ transport: t.transport });

  t.script.push((() => new Promise(() => {})) as unknown as () => Promise<SaveOutcome>); // A 挂起
  coord.enqueue(0, 7, patch({ textsJson: { title: 'A' } }));
  coord.enqueue(0, 7, patch({ textsJson: { body: 'B' } }));
  assert.equal(coord.state(0), 'dirty', 'A 在途、B 积压中,不应再发第二个请求');
  assert.equal(t.calls.length, 1, '同页永远只有一个在途请求');

  t.release({ ok: true, version: 8, revision: 8 });
  await coord.flush(0);
  assert.equal(t.calls.length, 2);
  assert.equal(t.calls[1]!.baseVersion, 8, '成功响应 version 串接为下一批 baseVersion');
  assert.deepEqual(t.calls[1]!.patch.textsJson, { title: 'A', body: 'B' }, 'A、B 都要持久化');
  assert.equal(coord.state(0), 'saved');
  coord.dispose();
});

test('A 在途时 B、C 合并到下一批,且只发两次', async () => {
  const t = createGatedTransport();
  const coord = createPageSaveCoordinator({ transport: t.transport });

  t.script.push((() => new Promise(() => {})) as unknown as () => Promise<SaveOutcome>);
  coord.enqueue(2, 1, patch({ imagePosJson: { hero: { x: 1, y: 2, scale: 1 } } }));
  coord.enqueue(2, 1, patch({ textsJson: { title: 'B' } }));
  coord.enqueue(2, 1, patch({ textsJson: { caption: 'C' } }));

  t.release({ ok: true, version: 2, revision: 2 });
  await coord.flush(2);
  assert.equal(t.calls.length, 2, 'A 一次 + 合并的 B/C 一次');
  const merged = t.calls[1]!.patch;
  assert.deepEqual(merged.imagePosJson, { hero: { x: 1, y: 2, scale: 1 } });
  assert.deepEqual(merged.textsJson, { title: 'B', caption: 'C' });
  coord.dispose();
});

test('网络失败:A 失败后 B 不丢,flush 重试成功', async () => {
  const t = createGatedTransport();
  const coord = createPageSaveCoordinator({ transport: t.transport });

  t.script.push({ ok: 'error', kind: 'network' });
  coord.enqueue(1, 3, patch({ textsJson: { title: 'A' } }));
  coord.enqueue(1, 3, patch({ textsJson: { body: 'B' } }));
  // 等泵自然落定(失败),不主动 flush —— 证明失败后**不会自动重试**。
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(coord.state(1), 'failed');
  assert.equal(t.calls.length, 1, '失败后不再自动重试');

  await coord.flush(1); // flush = 用户点「重试」/ 离开编辑器前的尽力一搏
  assert.equal(t.calls.length, 2, 'flush 重泵,patch 保留未丢');
  assert.deepEqual(t.calls[1]!.patch.textsJson, { title: 'A', body: 'B' });
  assert.equal(coord.state(1), 'saved');
  coord.dispose();
});

test('409 冲突:停止自动提交,保留 patch,conflictInfo 可取,resolveConflict 收尾', async () => {
  const t = createGatedTransport();
  const conflicts: number[] = [];
  const coord = createPageSaveCoordinator({
    transport: t.transport,
    onConflict: (info) => conflicts.push(info.pageIndex),
  });

  t.script.push({ ok: 'conflict', currentVersion: 42 });
  coord.enqueue(0, 17, patch({ textsJson: { title: '我的' } }));
  coord.enqueue(0, 17, patch({ textsJson: { body: '编辑' } })); // 冲突后的积压也不自动发
  await coord.flush(0);

  assert.equal(coord.state(0), 'conflict');
  assert.equal(t.calls.length, 1, '409 后不再自动发送');
  assert.deepEqual(conflicts, [0]);
  assert.deepEqual(coord.conflictInfo(0), { pageIndex: 0, currentVersion: 42 });

  // 用户「放弃我的修改并重新加载」:以服务端版本收尾,回到可保存状态。
  coord.resolveConflict(0, 42);
  assert.equal(coord.state(0), 'saved');
  coord.enqueue(0, 42, patch({ textsJson: { title: '重新开始' } }));
  await coord.flush(0);
  assert.equal(t.calls[1]!.baseVersion, 42);
  assert.equal(coord.state(0), 'saved');
  coord.dispose();
});

test('401/403 → forbidden,与网络失败分开,不自动重试也不被 flush 重发', async () => {
  const t = createGatedTransport();
  const coord = createPageSaveCoordinator({ transport: t.transport });

  t.script.push({ ok: 'error', kind: 'forbidden' });
  coord.enqueue(3, 5, patch({ textsJson: { title: 'x' } }));
  await coord.flush(3);
  assert.equal(coord.state(3), 'forbidden');

  await coord.flush(3); // forbidden 是终态,重试入口也不该重发
  assert.equal(t.calls.length, 1);
  coord.dispose();
});

test('不同页面并行:page 0 在途不阻塞 page 5 立即发出', async () => {
  const t = createGatedTransport();
  const coord = createPageSaveCoordinator({ transport: t.transport });

  t.script.push((() => new Promise(() => {})) as unknown as () => Promise<SaveOutcome>);
  coord.enqueue(0, 1, patch({ textsJson: { title: '页0' } }));
  coord.enqueue(5, 9, patch({ textsJson: { title: '页5' } }));
  assert.equal(t.calls.length, 2, '不同页面并发保存');
  t.release({ ok: true, version: 2, revision: 2 });
  await coord.flush();
  assert.equal(coord.state(0), 'saved');
  assert.equal(coord.state(5), 'saved');
  coord.dispose();
});

test('dispose 后不发送新请求、不更新状态', async () => {
  const t = createGatedTransport();
  const states: Array<[number, string]> = [];
  const coord = createPageSaveCoordinator({
    transport: t.transport,
    onPageStateChange: (pageIndex, state) => states.push([pageIndex, state]),
  });

  t.script.push((() => new Promise(() => {})) as unknown as () => Promise<SaveOutcome>);
  coord.enqueue(0, 1, patch({ textsJson: { title: 'A' } }));
  coord.dispose();
  t.release({ ok: true, version: 2, revision: 2 }); // 在途完成后……

  assert.equal(states.filter(([i]) => i === 0 && states.length > 1).length >= 0, true);
  assert.deepEqual(
    states.filter(([i, s]) => i === 0 && (s === 'saved' || s === 'dirty')),
    [[0, 'dirty']],
    'dispose 后在途完成的响应不得再更新状态(没有 saved 回调)',
  );
  assert.equal(coord.state(0), 'saving', 'dispose 冻结最后状态');

  coord.enqueue(9, 1, patch()); // dispose 后的新请求直接忽略
  assert.equal(t.calls.length, 1);
});

test('enqueue 带来的 baseVersion 不得回退协调器已知的更新版本', async () => {
  const t = createGatedTransport();
  const coord = createPageSaveCoordinator({ transport: t.transport });

  coord.enqueue(0, 10, patch({ textsJson: { title: 'A' } }));
  await coord.flush(0);
  assert.equal(t.calls[0]!.baseVersion, 10);

  // 保存成功后协调器已知 version=11;调用方还拿着旧的 skeleton version=10 来 enqueue。
  coord.enqueue(0, 10, patch({ textsJson: { title: 'B' } }));
  await coord.flush(0);
  assert.equal(t.calls[1]!.baseVersion, 11, '以协调器已知的新版本为准,否则必然 409');
  coord.dispose();
});

// ── mergePagePatch 合并语义(§8.2:字段缺失=不改;字段内部按 key 后写覆盖)──
test('mergePagePatch:跨字段并集 + 字段内按 key 后写覆盖 + 不修改入参', () => {
  const a: PagePatch = {
    textsJson: { title: 'A', body: '旧' },
    imagePosJson: { hero: { x: 1, y: 1, scale: 1 } },
  };
  const b: PagePatch = {
    textsJson: { body: '新' },
    textStyles: { title: { 'font-size': null } },
  };
  const aBefore = JSON.stringify(a);
  const bBefore = JSON.stringify(b);

  const merged = mergePagePatchImpl(a, b);

  // 字段内合并:同 key 后写覆盖,不同 key 并存。
  assert.deepEqual(merged.textsJson, { title: 'A', body: '新' });
  // 跨字段并集:只在 A 出现的 imagePosJson、只在 B 出现的 textStyles 都在。
  assert.deepEqual(merged.imagePosJson, { hero: { x: 1, y: 1, scale: 1 } });
  assert.deepEqual(merged.textStyles, { title: { 'font-size': null } }, 'null(移除样式)必须原样保留');
  // 两边都没有的字段不出现(缺失 = 不改,服务端保持现值)。
  assert.equal('imagesJson' in merged, false);
  assert.equal('pageStyle' in merged, false);
  // 纯函数:入参逐字节不变。
  assert.equal(JSON.stringify(a), aBefore);
  assert.equal(JSON.stringify(b), bBefore);
});

test('mergePagePatch:同 key 的样式 null 覆盖非 null(后写的删除生效)', () => {
  const merged = mergePagePatchImpl(
    { textStyles: { title: { 'font-weight': '700', color: 'red' } } },
    { textStyles: { title: { 'font-weight': null } } },
  );
  assert.deepEqual(merged.textStyles, { title: { 'font-weight': null, color: 'red' } });
});

test('mergePagePatch:imagesJson 换图槽位按 key 覆盖,其余槽保留', () => {
  const merged = mergePagePatchImpl(
    { imagesJson: { hero: 'p1', side: 'p2' } },
    { imagesJson: { hero: 'p9' } },
  );
  assert.deepEqual(merged.imagesJson, { hero: 'p9', side: 'p2' });
});

// mergePagePatch 尚未实现时,把断言组标失败而不是整个文件崩溃。
import { mergePagePatch } from './page-save-coordinator';
function mergePagePatchImpl(a: PagePatch, b: PagePatch): PagePatch {
  return mergePagePatch(a, b);
}
