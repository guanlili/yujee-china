import { eq, sql } from 'drizzle-orm';
import type { Page } from '@yujee/contracts';
import { db } from '@/db/client';
import { albums, albumShares } from '@/db/schema';
import { draftPageRepo } from '@/db/repos/draft-page-repo';
import { bumpDraftRevision } from './draft-store';
import { logger } from '@/lib/log/logger';
import { repairMag09Html } from './repair-mag09-html';

// mag-09 老书修复(2026-08-23,一次性维护)。病因与补丁口径见 repair-mag09-html.ts。
//
// 页面 html 存三处,三处都要过:
//   1. draft_pages.page.html          —— 编辑器 / PDF / Live / 单页 JPG 读的活草稿真相
//   2. albums.draft_json.pages[].html —— legacy 数组(只读回退)。不修的话,某天
//      ensureDraftPagesSeeded 从它 verbatim 播种,坏 html 会重新长回 draft_pages
//   3. album_shares.snapshot_json.pages[].htmlJson —— 已经发出去的分享链接快照
// 定稿的 album_pages 不存 html(读时现渲),已经自动吃到模板修复,不在此列。
//
// 幂等:补丁认不出/已是新形态就跳过,重复调用安全。

export interface Mag09RepairStats {
  apply: boolean;
  draftPages: { scanned: number; repaired: number; albums: number };
  legacyDraftJson: { scanned: number; repaired: number; albums: number };
  shareSnapshots: { scanned: number; repaired: number; shares: number };
}

/** 一个页对象(draft_pages.page 或 legacy 数组元素)按需补丁,返回新对象或 null。 */
function repairPage(page: unknown): Page | null {
  if (!page || typeof page !== 'object') return null;
  const p = page as { templateId?: unknown; html?: unknown };
  if (p.templateId !== 'mag-09' || typeof p.html !== 'string') return null;
  const html = repairMag09Html(p.html);
  return html === null ? null : ({ ...(page as object), html } as Page);
}

export async function repairMag09Pages(
  actorId: string,
  apply: boolean,
): Promise<Mag09RepairStats> {
  const stats: Mag09RepairStats = {
    apply,
    draftPages: { scanned: 0, repaired: 0, albums: 0 },
    legacyDraftJson: { scanned: 0, repaired: 0, albums: 0 },
    shareSnapshots: { scanned: 0, repaired: 0, shares: 0 },
  };

  // ── 1. draft_pages ────────────────────────────────────────────────────────
  const draftRows = (await db.execute(sql`
    SELECT album_id AS "albumId", page_index AS "pageIndex", page
    FROM draft_pages
    WHERE page->>'templateId' = 'mag-09'
    ORDER BY album_id, page_index`)) as unknown as Array<{
    albumId: string;
    pageIndex: number;
    page: unknown;
  }>;
  const byAlbum = new Map<string, Array<{ pageIndex: number; page: Page }>>();
  for (const row of draftRows) {
    stats.draftPages.scanned += 1;
    const repaired = repairPage(row.page);
    if (!repaired) continue;
    const list = byAlbum.get(row.albumId) ?? [];
    list.push({ pageIndex: row.pageIndex, page: repaired });
    byAlbum.set(row.albumId, list);
  }
  stats.draftPages.albums = byAlbum.size;
  stats.draftPages.repaired = [...byAlbum.values()].reduce((n, l) => n + l.length, 0);

  if (apply) {
    for (const [albumId, pages] of byAlbum) {
      // 每册一个事务:先锁 album 行(与所有 draft 写点同序 —— 先锁 albums 再写子行),
      // 拿到当前 revision 后 +1,把修好的行按新 revision 打版本戳。
      await db.transaction(async (tx) => {
        const locked = (await tx.execute(sql`
          SELECT draft_revision AS "draftRevision" FROM albums WHERE id = ${albumId} FOR UPDATE`)) as
          unknown as Array<{ draftRevision: number }>;
        const current = locked[0]?.draftRevision;
        if (current === undefined) return; // 期间被删了,跳过
        const next = await bumpDraftRevision(tx, albumId, Number(current));
        for (const { pageIndex, page } of pages) {
          await draftPageRepo.updateOne(tx, albumId, pageIndex, page, next, null);
        }
      });
    }
  }

  // ── 2. legacy albums.draft_json.pages[] ───────────────────────────────────
  const legacyRows = (await db.execute(sql`
    SELECT id, draft_json AS "draftJson"
    FROM albums
    WHERE jsonb_typeof(draft_json->'pages') = 'array'
      AND draft_json::text LIKE '%"mag-09"%'`)) as unknown as Array<{
    id: string;
    draftJson: { pages?: unknown[] } | null;
  }>;
  for (const row of legacyRows) {
    const pages = row.draftJson?.pages;
    if (!Array.isArray(pages)) continue;
    let touched = 0;
    const nextPages = pages.map((page) => {
      const p = page as { templateId?: unknown };
      if (p?.templateId === 'mag-09') stats.legacyDraftJson.scanned += 1;
      const repaired = repairPage(page);
      if (!repaired) return page;
      touched += 1;
      return repaired;
    });
    if (touched === 0) continue;
    stats.legacyDraftJson.repaired += touched;
    stats.legacyDraftJson.albums += 1;
    if (apply) {
      await db
        .update(albums)
        .set({ draftJson: { ...row.draftJson, pages: nextPages } })
        .where(eq(albums.id, row.id));
    }
  }

  // ── 3. album_shares.snapshot_json.pages[].htmlJson ────────────────────────
  const shareRows = await db
    .select({ id: albumShares.id, snapshotJson: albumShares.snapshotJson })
    .from(albumShares);
  for (const row of shareRows) {
    const pages = row.snapshotJson?.pages;
    if (!Array.isArray(pages)) continue;
    let touched = 0;
    const nextPages = pages.map((page) => {
      if (page?.templateId !== 'mag-09') return page;
      stats.shareSnapshots.scanned += 1;
      if (typeof page.htmlJson !== 'string') return page;
      const html = repairMag09Html(page.htmlJson);
      if (html === null) return page;
      touched += 1;
      return { ...page, htmlJson: html };
    });
    if (touched === 0) continue;
    stats.shareSnapshots.repaired += touched;
    stats.shareSnapshots.shares += 1;
    if (apply) {
      await db
        .update(albumShares)
        .set({ snapshotJson: { ...row.snapshotJson, pages: nextPages }, updatedAt: new Date() })
        .where(eq(albumShares.id, row.id));
    }
  }

  logger.info({ actorId, action: 'admin.repairMag09Pages', ...stats }, 'mag-09 pages repaired');
  return stats;
}
