import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { db } from '../client';
import { analyticsEvents, type NewAnalyticsEvent } from '../schema';

// 埋点写入与只读统计。写侧只做 insert;统计全部走 SQL 聚合,不写业务逻辑 ——
// 这样以后加新看板不需要改这张表的语义。
export const analyticsRepo = {
  async insertMany(rows: NewAnalyticsEvent[]): Promise<number> {
    if (rows.length === 0) return 0;
    await db.insert(analyticsEvents).values(rows);
    return rows.length;
  },

  // 某个事件在时间窗内的条数(分母)
  async countSince(name: string, since: Date): Promise<number> {
    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(analyticsEvents)
      .where(and(eq(analyticsEvents.name, name), gte(analyticsEvents.createdAt, since)));
    return rows[0]?.n ?? 0;
  },

  // 按 result 分组计数:一次查出「成功/失败/超时」三个数(分子)
  async countByResultSince(name: string, since: Date): Promise<Record<string, number>> {
    const rows = await db
      .select({
        result: analyticsEvents.result,
        n: sql<number>`count(*)::int`,
      })
      .from(analyticsEvents)
      .where(and(eq(analyticsEvents.name, name), gte(analyticsEvents.createdAt, since)))
      .groupBy(analyticsEvents.result);
    const out: Record<string, number> = {};
    for (const row of rows) out[row.result ?? 'unknown'] = row.n;
    return out;
  },

  // 耗时分位数(导出用):p50 / p95,直接给「慢不慢」一个数
  async durationPercentilesSince(
    name: string,
    since: Date,
  ): Promise<{ p50: number | null; p95: number | null; samples: number }> {
    const rows = await db
      .select({
        p50: sql<number | null>`percentile_cont(0.5) within group (order by ${analyticsEvents.value})`,
        p95: sql<number | null>`percentile_cont(0.95) within group (order by ${analyticsEvents.value})`,
        samples: sql<number>`count(*)::int`,
      })
      .from(analyticsEvents)
      .where(and(eq(analyticsEvents.name, name), gte(analyticsEvents.createdAt, since)));
    const row = rows[0];
    return {
      p50: row?.p50 === null || row?.p50 === undefined ? null : Math.round(row.p50),
      p95: row?.p95 === null || row?.p95 === undefined ? null : Math.round(row.p95),
      samples: row?.samples ?? 0,
    };
  },

  // 最近若干条,排障时看「刚刚谁遇到了什么」
  async recent(name: string, limit = 20): Promise<
    Array<{ createdAt: Date; result: string | null; value: number | null; meta: unknown }>
  > {
    return db
      .select({
        createdAt: analyticsEvents.createdAt,
        result: analyticsEvents.result,
        value: analyticsEvents.value,
        meta: analyticsEvents.meta,
      })
      .from(analyticsEvents)
      .where(eq(analyticsEvents.name, name))
      .orderBy(desc(analyticsEvents.createdAt))
      .limit(limit);
  },

  // 保留期清理:埋点是长期增长的表,不清理迟早成为最大的表
  async deleteOlderThan(cutoff: Date): Promise<number> {
    const res = await db.delete(analyticsEvents).where(sql`${analyticsEvents.createdAt} < ${cutoff}`);
    return Number((res as unknown as { rowCount?: number }).rowCount ?? 0);
  },
};
