import { eq, sql } from 'drizzle-orm';
import { PhotoProfileSchema, type PhotoProfile } from '@yujee/contracts';
import { db, type DbOrTx } from '../client';
import { albumPhotos, type AlbumPhoto } from '../schema';

export type AlbumPhotoUpsert = {
  photoId: string;
  status: 'uploaded' | 'missing';
  // 最后确认 PUT 成功的 Creator(collab rework §3.3)。missing 行不带署名。
  uploadedBy?: string | null;
  width?: number;
  height?: number;
  bytes?: number;
};

export const albumPhotoRepo = {
  // Defaults to the top-level `db` so existing unscoped callers are unchanged;
  // pass the open `tx` explicitly to read inside a transaction (e.g. after a
  // row lock on `albums`, so the read is guaranteed current — see
  // photo-original-service.ts confirm()).
  findByAlbum: async (albumId: string, tx: DbOrTx = db): Promise<AlbumPhoto[]> =>
    tx.select().from(albumPhotos).where(eq(albumPhotos.albumId, albumId)),

  // Aggregate-only count for callers that just need the two totals (e.g.
  // getDetail's polling-hot-path projection) — a GROUP BY instead of
  // fetching every row+column and reducing in JS. Missing statuses (no rows
  // yet, or all rows are one status) default to 0.
  countByStatus: async (albumId: string): Promise<{ uploaded: number; missing: number }> => {
    const rows = await db
      .select({ status: albumPhotos.status, count: sql<number>`count(*)::int` })
      .from(albumPhotos)
      .where(eq(albumPhotos.albumId, albumId))
      .groupBy(albumPhotos.status);
    const byStatus = new Map(rows.map((r) => [r.status, r.count]));
    return {
      uploaded: byStatus.get('uploaded') ?? 0,
      missing: byStatus.get('missing') ?? 0,
    };
  },

  // Upsert on the (albumId, photoId) composite PK. A 'missing' upsert must
  // never downgrade an already-'uploaded' row (nor clobber its
  // width/height/bytes): the gate is on the INCOMING (excluded) status, not
  // the existing row's status. When excluded.status = 'missing', keep the
  // existing row's status/width/height/bytes untouched. Otherwise (incoming
  // is 'uploaded' — including a legitimate re-upload that overwrote the R2
  // object with new dimensions/bytes) take the incoming values, so metadata
  // never goes stale once a row is uploaded.
  upsertMany: async (tx: DbOrTx, albumId: string, rows: AlbumPhotoUpsert[]): Promise<void> => {
    if (rows.length === 0) return;
    await tx
      .insert(albumPhotos)
      .values(
        rows.map((r) => ({
          albumId,
          photoId: r.photoId,
          status: r.status,
          uploadedBy: r.uploadedBy ?? null,
          width: r.width ?? null,
          height: r.height ?? null,
          bytes: r.bytes ?? null,
        })),
      )
      .onConflictDoUpdate({
        target: [albumPhotos.albumId, albumPhotos.photoId],
        set: {
          status: sql`CASE WHEN excluded.status = 'missing' THEN ${albumPhotos.status} ELSE excluded.status END`,
          // 署名随 status 同闸:missing 不动既有署名;uploaded(missing→uploaded
          // 流转,或首次确认)落最后确认者。
          uploadedBy: sql`CASE WHEN excluded.status = 'missing' THEN ${albumPhotos.uploadedBy} ELSE excluded.uploaded_by END`,
          width: sql`CASE WHEN excluded.status = 'missing' THEN ${albumPhotos.width} ELSE excluded.width END`,
          height: sql`CASE WHEN excluded.status = 'missing' THEN ${albumPhotos.height} ELSE excluded.height END`,
          bytes: sql`CASE WHEN excluded.status = 'missing' THEN ${albumPhotos.bytes} ELSE excluded.bytes END`,
          updatedAt: new Date(),
        },
      });
  },

  deleteByAlbum: async (tx: DbOrTx, albumId: string): Promise<void> => {
    await tx.delete(albumPhotos).where(eq(albumPhotos.albumId, albumId));
  },

  /**
   * 批量写照片视觉档案。**只更新已存在的行,不 INSERT** —— 照片行的真相源是上传
   * 流程,档案只是贴上去的附加信息;凭空造行会让 countByStatus 之类的统计错乱。
   */
  setProfiles: async (
    albumId: string,
    profiles: Record<string, PhotoProfile>,
    tx: DbOrTx = db,
  ): Promise<void> => {
    const entries = Object.entries(profiles);
    if (entries.length === 0) return;
    // 单条 UPDATE ... FROM (VALUES ...) —— 一本书上百张照片,逐条 UPDATE 是上百个
    // round trip。
    const values = sql.join(
      entries.map(([photoId, profile]) => sql`(${photoId}, ${JSON.stringify(profile)}::jsonb)`),
      sql`, `,
    );
    await tx.execute(sql`
      UPDATE ${albumPhotos} AS p
         SET profile = v.profile, updated_at = now()
        FROM (VALUES ${values}) AS v(photo_id, profile)
       WHERE p.album_id = ${albumId} AND p.photo_id = v.photo_id
    `);
  },

  /**
   * 读全书档案。**坏档案跳过并 warn,不抛** —— 一张照片的坏数据不该让整本书打不开
   * (契约演进后旧行形状对不上是必然会发生的)。没建档的行不出现在结果里。
   */
  findProfilesByAlbum: async (
    albumId: string,
    tx: DbOrTx = db,
  ): Promise<Record<string, PhotoProfile>> => {
    const rows = await tx
      .select({ photoId: albumPhotos.photoId, profile: albumPhotos.profile })
      .from(albumPhotos)
      .where(eq(albumPhotos.albumId, albumId));

    const out: Record<string, PhotoProfile> = {};
    for (const row of rows) {
      if (row.profile == null) continue;
      const parsed = PhotoProfileSchema.safeParse(row.profile);
      if (parsed.success) out[row.photoId] = parsed.data;
      else console.warn('[album-photo-repo] 跳过形状不合法的档案', { albumId, photoId: row.photoId });
    }
    return out;
  },
};
