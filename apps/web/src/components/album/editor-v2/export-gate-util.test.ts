import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeExportUnlocked } from './export-gate-util';

// 闸门真值表(WP5.2 / §4.5a)。口径必须与 WP2.4 的 exportUnlocked 一致:
// 导出解锁 ⇔ allDone && stage ∉ {analysing, story}。

test('computeExportUnlocked: analysing → 锁(导出不可用)', () => {
  assert.equal(computeExportUnlocked('analysing', true), false);
});

test('computeExportUnlocked: story → 锁(分组故事未全组 done)', () => {
  assert.equal(computeExportUnlocked('story', true), false);
});

test('computeExportUnlocked: theme → 开(全组 done 后解锁)', () => {
  assert.equal(computeExportUnlocked('theme', true), true);
});

test('computeExportUnlocked: cover → 开(主题/封面不重新锁闸门)', () => {
  assert.equal(computeExportUnlocked('cover', true), true);
});

test('computeExportUnlocked: ready → 开', () => {
  assert.equal(computeExportUnlocked('ready', true), true);
});

test('computeExportUnlocked: 主题/封面跳过不影响导出可用', () => {
  // §4.5a:story → theme 一解锁,之后无论停在 theme、cover 还是 ready(跳过主题/
  // 封面),导出始终可用 —— 全是 true。
  for (const s of ['theme', 'cover', 'ready']) {
    assert.equal(computeExportUnlocked(s, true), true, `stage=${s} 应解锁`);
  }
});

test('computeExportUnlocked: allDone=false 时 theme/cover/ready 仍锁', () => {
  for (const s of ['theme', 'cover', 'ready']) {
    assert.equal(computeExportUnlocked(s, false), false, `stage=${s} allDone=false 应锁`);
  }
});

test('computeExportUnlocked: 缺失/空 stage → 锁(没相册可导出)', () => {
  // 唯一的额外护栏(前端 stage 类型是 string|undefined)。服务端 album.stage 永远是
  // 合法 enum,不会走到这里。
  for (const bad of [undefined, null, '']) {
    assert.equal(computeExportUnlocked(bad, true), false, `stage=${String(bad)} 应锁`);
  }
});

test('computeExportUnlocked: 非空未知 stage 走 WP2.4 公式(只 analysing/story 锁)', () => {
  // 复用 WP2.4 口径而非另造一套:任何非空字符串都用同一公式判定,跟服务端一致。
  assert.equal(computeExportUnlocked('bogus', true), true);
  assert.equal(computeExportUnlocked('bogus', false), false);
});

test('computeExportUnlocked: 真值表与 WP2.4 album-service 口径逐项一致', () => {
  // 镜像 album-service.ts `allDone && stage !== 'analysing' && stage !== 'story'`。
  const truthTable: Array<{ stage: string; allDone: boolean }> = [
    { stage: 'analysing', allDone: false },
    { stage: 'analysing', allDone: true },
    { stage: 'story', allDone: false },
    { stage: 'story', allDone: true },
    { stage: 'theme', allDone: false },
    { stage: 'theme', allDone: true },
    { stage: 'cover', allDone: false },
    { stage: 'cover', allDone: true },
    { stage: 'ready', allDone: false },
    { stage: 'ready', allDone: true },
  ];
  for (const { stage, allDone } of truthTable) {
    const mirror = allDone && stage !== 'analysing' && stage !== 'story';
    assert.equal(
      computeExportUnlocked(stage, allDone),
      mirror,
      `stage=${stage} allDone=${String(allDone)} 应与 service 公式一致`,
    );
  }
});

test('computeExportUnlocked: allDone 必须参与 unlock 判定,不能只看 stage', () => {
  const serverCases: Record<string, boolean> = {
    analysing: false,
    story: false,
    theme: true,
    cover: true,
    ready: true,
  };
  for (const [stage, expectedWhenDone] of Object.entries(serverCases)) {
    assert.equal(computeExportUnlocked(stage, false), false, `stage=${stage} allDone=false 应锁`);
    assert.equal(computeExportUnlocked(stage, true), expectedWhenDone, `stage=${stage} allDone=true`);
  }
});
