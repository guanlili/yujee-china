import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

/**
 * drizzle 账本与 meta 快照的对账。
 *
 * `drizzle-kit generate` 用 **meta 里 idx 最大的那份快照**当「上一版 schema」来做 diff。
 * 手写迁移(本仓常态,dev 库账本漂移导致 `db:migrate` 本地必失败)如果只补 SQL 不补
 * 快照,下一次 generate 就会对着更早的快照再吐一遍同样的 `ADD COLUMN` —— 而且新生成
 * 的那条不带 `IF NOT EXISTS`,进生产就是构建期 db:migrate 直接失败。
 * `0026_ambitious_lord_tyger.sql` 抬头记着上一次踩这个坑的账。
 */

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, 'migrations');
const metaDir = join(migrationsDir, 'meta');

type Journal = { entries: { idx: number; tag: string }[] };

const journal = JSON.parse(readFileSync(join(metaDir, '_journal.json'), 'utf8')) as Journal;

const pad4 = (n: number) => String(n).padStart(4, '0');

test('账本里最新那条迁移必须有对应的 meta 快照', () => {
  const latest = journal.entries.reduce((a, b) => (a.idx >= b.idx ? a : b));
  const snapshots = readdirSync(metaDir).filter((f) => f.endsWith('_snapshot.json'));
  const highestSnapshotIdx = Math.max(
    ...snapshots.map((f) => Number.parseInt(f.slice(0, 4), 10)).filter(Number.isFinite),
  );
  assert.equal(
    highestSnapshotIdx,
    latest.idx,
    `最新迁移是 ${latest.tag}(idx ${latest.idx}),但 meta 里最新快照只到 ${pad4(highestSnapshotIdx)}`
      + ' —— 下一次 drizzle-kit generate 会把这一版的 DDL 再吐一遍',
  );
});

test('最新快照必须与 schema 对得上(以 0032 加的 album_photos.profile 为哨兵)', () => {
  const latest = journal.entries.reduce((a, b) => (a.idx >= b.idx ? a : b));
  const snapshot = JSON.parse(
    readFileSync(join(metaDir, `${pad4(latest.idx)}_snapshot.json`), 'utf8'),
  ) as { tables: Record<string, { columns: Record<string, unknown> }> };
  const albumPhotos = snapshot.tables['public.album_photos'] ?? snapshot.tables.album_photos;
  assert.ok(albumPhotos, '快照里应有 album_photos 表');
  assert.ok(
    albumPhotos.columns.profile,
    '快照里 album_photos 缺 profile 列 —— generate 会重吐一遍 ADD COLUMN',
  );
});

test('快照链首尾相接:每份快照的 prevId 指向前一份的 id', () => {
  const snapshots = readdirSync(metaDir)
    .filter((f) => f.endsWith('_snapshot.json'))
    .sort();
  let prev: { id: string } | null = null;
  for (const file of snapshots) {
    const snap = JSON.parse(readFileSync(join(metaDir, file), 'utf8')) as {
      id: string;
      prevId: string;
    };
    if (prev) assert.equal(snap.prevId, prev.id, `${file} 的 prevId 没接上前一份快照`);
    prev = snap;
  }
});
