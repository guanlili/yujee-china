import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildChapterContext,
  buildChapterInterviews,
  classifyInterviewCase,
  formatDatePrefix,
  interviewMessages,
} from './interview';

test('classifyInterviewCase covers all four time/place combinations', () => {
  assert.equal(
    classifyInterviewCase({ earliestTakenAt: '2026-12-15T10:00', latestTakenAt: null, place: '杭州' }),
    'timeAndPlace',
  );
  assert.equal(
    classifyInterviewCase({ earliestTakenAt: '2026-12-15T10:00', latestTakenAt: null, place: null }),
    'timeOnly',
  );
  assert.equal(
    classifyInterviewCase({ earliestTakenAt: null, latestTakenAt: null, place: '杭州' }),
    'placeOnly',
  );
  assert.equal(
    classifyInterviewCase({ earliestTakenAt: null, latestTakenAt: null, place: null }),
    'neither',
  );
});

test('classifyInterviewCase treats blank place as absent', () => {
  assert.equal(
    classifyInterviewCase({ earliestTakenAt: null, latestTakenAt: null, place: '   ' }),
    'neither',
  );
});

test('interviewMessages returns exactly three short messages per case', () => {
  for (const kind of ['timeAndPlace', 'timeOnly', 'placeOnly', 'neither'] as const) {
    const msgs = interviewMessages(kind);
    assert.equal(msgs.length, 3);
    for (const m of msgs) assert.ok(m.trim().length > 0);
  }
});

test('interviewMessages: timeAndPlace does NOT ask time or place again', () => {
  const [, , third] = interviewMessages('timeAndPlace');
  const all = interviewMessages('timeAndPlace').join('');
  // 已知时间+地点时,不该再问「什么时候」「在哪」。
  assert.ok(!all.includes('什么时候'));
  assert.ok(!all.includes('在哪'));
  assert.ok(third.length > 0);
});

test('formatDatePrefix extracts YYYY/MM/DD, or null on unparseable', () => {
  assert.equal(formatDatePrefix('2026-12-15T10:00:00'), '2026/12/15');
  assert.equal(formatDatePrefix('2026-12-15'), '2026/12/15');
  assert.equal(formatDatePrefix(null), null);
  assert.equal(formatDatePrefix('not a date'), null);
});

test('buildChapterContext joins known time+place prefix with the user answer', () => {
  const out = buildChapterContext(
    { earliestTakenAt: '2026-12-15T10:00', latestTakenAt: null, place: '杭州' },
    '那天是奶奶生日，全家第一次到齐。',
  );
  assert.equal(out, '时间：2026/12/15  地点：杭州\n（用户原话）那天是奶奶生日，全家第一次到齐。');
});

test('buildChapterContext shows a date range when the group spans multiple days', () => {
  const out = buildChapterContext(
    { earliestTakenAt: '2026-12-15T10:00', latestTakenAt: '2026-12-17T20:00', place: '杭州' },
    '三天的旅行。',
  );
  assert.ok(out.startsWith('时间：2026/12/15~2026/12/17  地点：杭州'));
});

test('buildChapterContext with only prefix (empty answer) keeps just the facts', () => {
  const out = buildChapterContext(
    { earliestTakenAt: '2026-12-15T10:00', latestTakenAt: null, place: '杭州' },
    '   ',
  );
  assert.equal(out, '时间：2026/12/15  地点：杭州');
});

test('buildChapterContext with only user answer (no known facts) keeps just the answer', () => {
  const out = buildChapterContext(
    { earliestTakenAt: null, latestTakenAt: null, place: null },
    '在老家的院子里。',
  );
  assert.equal(out, '在老家的院子里。');
});

test('buildChapterContext returns empty string when both prefix and answer are empty (= skip)', () => {
  const out = buildChapterContext(
    { earliestTakenAt: null, latestTakenAt: null, place: null },
    '',
  );
  assert.equal(out, '');
});

test('buildChapterContext caps output at 500 chars (matches V3Chapter.chapterContext)', () => {
  const out = buildChapterContext(
    { earliestTakenAt: null, latestTakenAt: null, place: null },
    'x'.repeat(600),
  );
  assert.equal(out.length, 500);
});

test('buildChapterInterviews aligns chapter photoIds → clusterId → prefill', () => {
  const chapters = [
    { chapterId: 'c1', label: '海边', photoIds: ['p1', 'p2'] },
    { chapterId: 'c2', label: '城市', photoIds: ['p3'] },
  ];
  const photoToCluster = new Map([
    ['p1', 'cl1'],
    ['p2', 'cl1'],
    ['p3', 'cl2'],
  ]);
  const prefills = [
    { clusterId: 'cl1', earliestTakenAt: '2026-05-01T09:00', latestTakenAt: null, place: '杭州' },
    { clusterId: 'cl2', earliestTakenAt: null, latestTakenAt: null, place: null },
  ];

  const result = buildChapterInterviews(chapters, photoToCluster, prefills);
  assert.equal(result.length, 2);
  // c1: 时间✓地点✓ => timeAndPlace 的三条消息。
  assert.deepEqual(result[0]!.input, { earliestTakenAt: '2026-05-01T09:00', latestTakenAt: null, place: '杭州' });
  assert.deepEqual(result[0]!.messages, interviewMessages('timeAndPlace'));
  // c2: 无时间无地点 => neither。
  assert.deepEqual(result[1]!.input, { earliestTakenAt: null, latestTakenAt: null, place: null });
  assert.deepEqual(result[1]!.messages, interviewMessages('neither'));
});

test('buildChapterInterviews falls back to empty input when mapping is missing', () => {
  const chapters = [{ chapterId: 'c1', label: 'x', photoIds: ['pX'] }];
  const result = buildChapterInterviews(chapters, new Map(), []);
  assert.deepEqual(result[0]!.input, { earliestTakenAt: null, latestTakenAt: null, place: null });
  assert.deepEqual(result[0]!.messages, interviewMessages('neither'));
});

test('buildChapterContext never contains coordinates — place is a name string only', () => {
  // place 只可能是地名字符串;这里断言拼出来的前缀就是我们喂进去的地名,不含任何数字坐标格式。
  const out = buildChapterContext(
    { earliestTakenAt: null, latestTakenAt: null, place: '西湖' },
    '',
  );
  assert.equal(out, '地点：西湖');
  assert.ok(!/\d+\.\d+/.test(out)); // 无 lat/lng 小数
});
