import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { albumShares, albums, draftPages } from '@/db/schema';
import { cleanupUser, isDbReachable, makeAlbum, makeUser } from '@/db/repos/__test__/setup';
import { repairMag09Pages } from './repair-mag09-pages';

// 落库层的集成测试:补丁函数本身在 repair-mag09-html.test.ts 里已按黄金对照验过,
// 这里验 SQL 那一层 —— jsonb 过滤选得中、三处存储都写到、dry-run 真的不写、
// draft_revision 按写点约定推进、重复跑幂等。
//
// ⚠️ 这条用例会对 DATABASE_URL 指向的库**全库 apply**(修复本身就是全库扫描,没有
// 按册过滤的入口)。只在本地 dev 库跑;别把 DATABASE_URL 指到生产再跑测试。
// 修复幂等且只改坏页,即便误跑也不会造成新的坏数据,但会推进相关册的 draft_revision。

/** 老形态(拍平之前)的 mag-09 存库 html,截到能触发补丁的最小结构。 */
const BROKEN_HTML =
  '<div data-template="mag-09" style="position:relative;width:794px;height:1123px">' +
  '<div style="position:absolute;top:130px;right:60px;width:230px">' +
  '<p data-text-key="body" style="position:absolute;left:504px;top:130px;width:230px;height:31px">右上短句</p>' +
  '</div>' +
  '<div style="position:absolute;top:620px;left:60px;width:280px;line-height:1.75;' +
  'color:currentColor;letter-spacing:0.02em;text-align:justify">' +
  '<p data-text-key="explain" style="position:absolute;left:60px;top:620px;width:280px;height:32px">说明一</p>' +
  '<p data-text-key="explain2" style="position:absolute;left:60px;top:664px;width:280px;height:32px">说明二</p>' +
  '<p data-text-key="body2" style="margin-top:12px;margin-bottom:0;width:280px;height:200px;top:11px">正文</p>' +
  '</div></div>';

function brokenPage(pageIndex: number) {
  return {
    pageIndex,
    templateId: 'mag-09',
    images: { image1: 'ph1', image2: 'ph2' },
    texts: { body: '右上短句', explain: '说明一', explain2: '说明二', body2: '正文' },
    html: BROKEN_HTML,
  };
}

test('repairMag09Pages: dry-run 不写库,apply 修三处存储,重复跑幂等', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping repo integration test');
    return;
  }
  const user = await makeUser('mag09repair');
  try {
    const album = await makeAlbum(user.id, { title: 'mag-09 repair' });
    // 1) draft_pages 一行
    await db.insert(draftPages).values({
      albumId: album.id,
      pageIndex: 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      page: brokenPage(0) as any,
      version: 1,
      updatedBy: null,
    });
    // 2) legacy draft_json.pages 数组
    await db
      .update(albums)
      .set({ draftJson: { version: 'v3-story', pages: [brokenPage(0)] }, draftRevision: 1 })
      .where(eq(albums.id, album.id));
    // 3) 分享快照
    await db.insert(albumShares).values({
      token: `mag09-repair-${Date.now()}`,
      albumId: album.id,
      title: 'shared',
      snapshotJson: {
        pages: [
          {
            pageIndex: 0,
            templateId: 'mag-09',
            imagesJson: {},
            textsJson: {},
            htmlJson: BROKEN_HTML,
          },
        ],
        photoUrls: {},
        boardBackground: null,
        locale: 'zh',
      },
    });

    // ── dry-run:统计到,但一个字节都不写 ──
    const dry = await repairMag09Pages('test', false);
    assert.equal(dry.apply, false);
    assert.ok(dry.draftPages.repaired >= 1, 'dry-run 要统计到 draft_pages');
    assert.ok(dry.legacyDraftJson.repaired >= 1, 'dry-run 要统计到 legacy 数组');
    assert.ok(dry.shareSnapshots.repaired >= 1, 'dry-run 要统计到分享快照');

    const afterDry = await db
      .select({ page: draftPages.page })
      .from(draftPages)
      .where(eq(draftPages.albumId, album.id));
    assert.equal(
      (afterDry[0]!.page as { html: string }).html,
      BROKEN_HTML,
      'dry-run 不许改库',
    );

    // ── apply:三处都修好 ──
    await repairMag09Pages('test', true);

    const dp = await db
      .select({ page: draftPages.page, version: draftPages.version })
      .from(draftPages)
      .where(eq(draftPages.albumId, album.id));
    const dpHtml = (dp[0]!.page as { html: string }).html;
    assert.doesNotMatch(dpHtml, /top:620px;left:60px;width:280px;line-height:1\.75/, 'draft_pages 外壳要拆掉');
    assert.match(dpHtml, /data-text-key="body2"[^>]*top:708px/, 'body2 要落到 708');
    assert.match(dpHtml, /data-text-key="body2"[^>]*position:absolute/);

    const albumRow = await db
      .select({ draftJson: albums.draftJson, draftRevision: albums.draftRevision })
      .from(albums)
      .where(eq(albums.id, album.id));
    assert.ok(
      Number(albumRow[0]!.draftRevision) > 1,
      'draft_pages 写入要按写点约定推进 draft_revision',
    );
    assert.equal(
      Number(dp[0]!.version),
      Number(albumRow[0]!.draftRevision),
      '修好的行要盖上新 revision 的版本戳',
    );
    const legacyHtml = (albumRow[0]!.draftJson as { pages: Array<{ html: string }> }).pages[0]!.html;
    assert.match(legacyHtml, /data-text-key="body2"[^>]*top:708px/, 'legacy 数组也要修');

    const share = await db
      .select({ snapshotJson: albumShares.snapshotJson })
      .from(albumShares)
      .where(eq(albumShares.albumId, album.id));
    assert.match(
      share[0]!.snapshotJson.pages[0]!.htmlJson!,
      /data-text-key="body2"[^>]*top:708px/,
      '分享快照也要修',
    );

    // ── 再跑一遍:这册已经没有可修的了 ──
    const again = await repairMag09Pages('test', false);
    const stillBroken = await db.execute(sql`
      SELECT count(*)::int AS n FROM draft_pages
      WHERE album_id = ${album.id}
        AND page->>'html' LIKE '%top:620px;left:60px;width:280px;line-height:1.75%'`);
    assert.equal((stillBroken as unknown as Array<{ n: number }>)[0]!.n, 0);
    assert.ok(again.draftPages.repaired < dry.draftPages.repaired || dry.draftPages.repaired === 0);
  } finally {
    await cleanupUser(user.id);
  }
});
