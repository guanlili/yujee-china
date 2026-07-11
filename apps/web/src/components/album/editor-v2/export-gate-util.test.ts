import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeExportUnlocked } from './export-gate-util';

// 闸门真值表(2026-07 设计环节收紧)。口径必须与 album-service.storyProgressFrom 的
// exportUnlocked 一致:导出解锁 ⇔ allDone 且 stage === 'ready'(设计已完成)。
// theme/cover 不再解锁 —— 没做封面封尾/字体文案设计就不能导。

test('computeExportUnlocked: 仅 stage=ready 且 allDone 解锁', () => {
  assert.equal(computeExportUnlocked('ready', true), true);
});

test('computeExportUnlocked: analysing/story → 锁', () => {
  assert.equal(computeExportUnlocked('analysing', true), false);
  assert.equal(computeExportUnlocked('story', true), false);
});

test('computeExportUnlocked: theme/cover(设计未完成)→ 锁', () => {
  assert.equal(computeExportUnlocked('theme', true), false);
  assert.equal(computeExportUnlocked('cover', true), false);
});

test('computeExportUnlocked: allDone=false 时任何 stage 都锁(含 ready)', () => {
  for (const s of ['analysing', 'story', 'theme', 'cover', 'ready'] as const) {
    assert.equal(computeExportUnlocked(s, false), false, `stage=${s} allDone=false 应锁`);
  }
});

test('computeExportUnlocked: 缺失/空/未知 stage → 锁', () => {
  for (const bad of [undefined, null, '', 'bogus'] as const) {
    assert.equal(computeExportUnlocked(bad, true), false, `stage=${String(bad)} 应锁`);
  }
});

test('computeExportUnlocked: 真值表与 album-service 口径逐项一致', () => {
  const serverFormula = (stage: string, allDone: boolean) => allDone && stage === 'ready';
  for (const stage of ['analysing', 'story', 'theme', 'cover', 'ready']) {
    for (const allDone of [true, false]) {
      assert.equal(
        computeExportUnlocked(stage, allDone),
        serverFormula(stage, allDone),
        `stage=${stage} allDone=${allDone}`,
      );
    }
  }
});
