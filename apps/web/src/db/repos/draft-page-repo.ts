import { and, asc, eq, sql } from 'drizzle-orm';
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

  // 轻量版本清单(AI job 基线,Phase 4):只取 pageIndex+version,不拉页面 JSON。
  // 基线记录与回写重验都只要这两个字段。无行(未播种)→ []。
  listVersions: async (
    albumId: string,
    tx: DbOrTx = db,
  ): Promise<Array<{ pageIndex: number; version: number }>> =>
    tx
      .select({ pageIndex: draftPages.pageIndex, version: draftPages.version })
      .from(draftPages)
      .where(eq(draftPages.albumId, albumId))
      .orderBy(asc(draftPages.pageIndex)),

  // Single-row replace of an EXISTING row: overwrites the page content,
  // stamps the new version/updatedBy. Caller passes the open transaction
  // (write path always runs `ensureDraftPagesSeeded` inside the `albums` row
  // lock before this — see the plan's fixed write-transaction order — so the
  // row is expected to already exist). Deliberately a strict UPDATE, not an
  // upsert: a 0-row hit means a caller skipped seeding or passed an
  // out-of-range pageIndex, and that must fail loudly rather than silently
  // create a stray row.
  updateOne: async (
    tx: DbOrTx,
    albumId: string,
    pageIndex: number,
    page: Page,
    version: number,
    updatedBy: string | null,
  ): Promise<void> => {
    const updated = await tx
      .update(draftPages)
      .set({ page, version, updatedBy, updatedAt: new Date() })
      .where(and(eq(draftPages.albumId, albumId), eq(draftPages.pageIndex, pageIndex)))
      .returning({ pageIndex: draftPages.pageIndex });
    if (updated.length === 0) {
      throw new Error(
        `draft_pages.updateOne: row not found (albumId=${albumId}, pageIndex=${pageIndex})`,
      );
    }
  },

  // OCC 条件更新(collab plan §8.1):UPDATE 的 WHERE 同时含 album_id +
  // page_index + **version** —— 版本不匹配时 0 行命中,返回 false 且零写入。
  // 这是页面写事务的最后不变量防线:即便未来某个调用点绕过了相册行锁内的
  // 预比较,数据库本身也不会让陈旧 baseVersion 覆盖新页面。与 updateOne 的
  // 语义差异:updateOne 的 miss 是不变量被破坏(大声失败);这里的 miss 是正常
  // 的 OCC 冲突结局(false → 上层转 409 EDIT_CONFLICT)。
  updateOneIfVersion: async (
    tx: DbOrTx,
    albumId: string,
    pageIndex: number,
    expectedVersion: number,
    page: Page,
    nextVersion: number,
    updatedBy: string | null,
  ): Promise<boolean> => {
    const updated = await tx
      .update(draftPages)
      .set({ page, version: nextVersion, updatedBy, updatedAt: new Date() })
      .where(
        and(
          eq(draftPages.albumId, albumId),
          eq(draftPages.pageIndex, pageIndex),
          eq(draftPages.version, expectedVersion),
        ),
      )
      .returning({ pageIndex: draftPages.pageIndex });
    return updated.length > 0;
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
