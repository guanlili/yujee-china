import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BOARD_BG_SIZE, parseOutDir, planJobs } from './gen-board-bg.ts';

test('每个方向 × 每个色调 各排一张', () => {
  const jobs = planJobs({ directions: ['paper', 'linen'], tones: ['rice', 'mist'] });
  assert.equal(jobs.length, 4);
});

test('tag 互不重复 —— 重名会静默覆盖文件,人工筛的时候少了图都不知道', () => {
  const jobs = planJobs({
    directions: ['paper', 'linen', 'grain'],
    tones: ['rice', 'mist', 'sage', 'clay'],
  });
  assert.equal(new Set(jobs.map((j) => j.tag)).size, jobs.length);
});

test('输入里有重复直接报错 —— 重复的 tag 既花两份钱又互相覆盖', () => {
  assert.throws(() => planJobs({ directions: ['paper'], tones: ['rice', 'rice'] }), /duplicate/i);
  assert.throws(() => planJobs({ directions: ['paper', 'paper'], tones: ['rice'] }), /duplicate/i);
});

test('tag 只用方向和色调名,不带 # —— 要当文件名用', () => {
  const [job] = planJobs({ directions: ['linen'], tones: ['mist'] });
  assert.equal(job!.tag, 'linen-mist');
});

test('文件名后缀必须是 .jpg —— presetImageUrl 拼的就是 .jpg,写成 .jpeg 入库即 404', () => {
  for (const job of planJobs({ directions: ['paper', 'linen', 'grain'], tones: ['rice', 'cloud'] })) {
    assert.ok(job.file.endsWith('.jpg'), `${job.file} 不是 .jpg`);
    assert.doesNotMatch(job.file, /\.jpeg$/);
  }
});

test('色值随 job 一起带出来,不靠拆 tag 字符串反推', () => {
  const [job] = planJobs({ directions: ['linen'], tones: ['mist'] });
  assert.equal(job!.tone, 'mist');
  assert.equal(job!.hex.toLowerCase(), '#dbe4ea');
});

test('prompt 走配方:满幅约束在,色码不在', () => {
  const [job] = planJobs({ directions: ['linen'], tones: ['rice'] });
  assert.match(job!.prompt, /fills the entire frame/i);
  assert.doesNotMatch(job!.prompt, /#\s*[0-9a-f]{3,6}\b/i);
});

test('出图按垫底背景的竖版比例 —— 现有 4 张预设是 506×900', () => {
  const [job] = planJobs({ directions: ['paper'], tones: ['rice'] });
  assert.equal(job!.size, BOARD_BG_SIZE);
  const [w, h] = BOARD_BG_SIZE.split('x').map(Number);
  assert.ok(Math.abs(w! / h! - 506 / 900) < 0.01, `${BOARD_BG_SIZE} 不是 506:900 比例`);
});

test('空清单直接报错,不静默跑出零张图', () => {
  assert.throws(() => planJobs({ directions: [], tones: ['rice'] }), /nothing to generate/);
});

test('--out 两种写法都认', () => {
  assert.equal(parseOutDir(['node', 's.ts', '--out', '/tmp/a']), '/tmp/a');
  assert.equal(parseOutDir(['node', 's.ts', '--out=/tmp/b']), '/tmp/b');
});

test('--out 后面没跟目录就报错 —— 别把 ¥4 的产物默默丢进临时目录', () => {
  assert.throws(() => parseOutDir(['node', 's.ts', '--out']), /--out needs a directory/);
});

test('没给 --out 时返回 null,由调用方决定默认值', () => {
  assert.equal(parseOutDir(['node', 's.ts']), null);
});
