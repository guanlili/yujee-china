import { asc, eq, sql } from 'drizzle-orm';
import type { Page } from '@yujee/contracts';
import { db, type DbOrTx } from '../client';
import { draftPages, type DraftPage } from '../schema';

// draft_pages 拆表(Phase 1a):per-page repo for the `draft_pages` table —
// the per-page truth for V3 draft pages (docs/plans/2026-08-03-draft-pages-split.md).
export const draftPageRepo = {
  // Defaults to the top-level `db` (mirrors albumPhotoRepo.findByAlbum) so
  // unscoped callers are unchanged; pass an open `tx` to read inside a
  // transaction (e.g. after an `albums` row lock, so the read is current).
  findByAlbum: async (albumId: string, tx: DbOrTx = db): Promise<DraftPage[]> =>
    tx
      .select()
      .from(draftPages)
      .where(eq(draftPages.albumId, albumId))
      .orderBy(asc(draftPages.pageIndex)),

  countByAlbum: async (albumId: string, tx: DbOrTx = db): Promise<number> => {
    const rows = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(draftPages)
      .where(eq(draftPages.albumId, albumId));
    return rows[0]?.total ?? 0;
  },

  // Single-row replace: overwrites the page content, stamps the new
  // version/updatedBy. Caller passes the open transaction (write path always
  // runs inside an `albums` row lock — see the plan's fixed write-transaction
  // order).
  updateOne: async (
    tx: DbOrTx,
    albumId: string,
    pageIndex: number,
    page: Page,
    version: number,
    updatedBy: string | null,
  ): Promise<void> => {
    await tx
      .insert(draftPages)
      .values({ albumId, pageIndex, page, version, updatedBy })
      .onConflictDoUpdate({
        target: [draftPages.albumId, draftPages.pageIndex],
        set: { page, version, updatedBy, updatedAt: new Date() },
      });
  },

  // Full-book replace = deleteByAlbum + bulk insert, same transaction (the
  // brief's stated shape — reorder/select-layout/compose/design-chat all
  // replace the whole page set at once).
  replaceAll: async (
    tx: DbOrTx,
    albumId: string,
    pages: Page[],
    version: number,
    updatedBy: string | null,
  ): Promise<void> => {
    await tx.delete(draftPages).where(eq(draftPages.albumId, albumId));
    if (pages.length === 0) return;
    await tx.insert(draftPages).values(
      pages.map((page) => ({
        albumId,
        pageIndex: page.pageIndex,
        page,
        version,
        updatedBy,
      })),
    );
  },

  deleteByAlbum: async (tx: DbOrTx, albumId: string): Promise<void> => {
    await tx.delete(draftPages).where(eq(draftPages.albumId, albumId));
  },
};
