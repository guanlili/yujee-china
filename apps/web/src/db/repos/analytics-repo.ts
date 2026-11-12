import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
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

  // ===== 后台看板用:一次查询拿一整类数据,避免页面里发 N 条 SQL =====

  // 各事件条数(分母/总量)
  async countByNameSince(since: Date): Promise<Record<string, number>> {
    const rows = await db
      .select({ name: analyticsEvents.name, n: sql<number>`count(*)::int` })
      .from(analyticsEvents)
      .where(gte(analyticsEvents.createdAt, since))
      .groupBy(analyticsEvents.name);
    return Object.fromEntries(rows.map((r) => [r.name, r.n]));
  },

  // 各事件的独立主体数(漏斗用「人」而不是「次」,否则一个人反复导出会虚高)
  async distinctSubjectsByNameSince(since: Date): Promise<Record<string, number>> {
    const rows = await db
      .select({
        name: analyticsEvents.name,
        n: sql<number>`count(distinct ${analyticsEvents.subjectId})::int`,
      })
      .from(analyticsEvents)
      .where(gte(analyticsEvents.createdAt, since))
      .groupBy(analyticsEvents.name);
    return Object.fromEntries(rows.map((r) => [r.name, r.n]));
  },

  // 导出四态:开始次数、成功次数、渲染失败、云端上传失败。
  // 渲染失败与上传失败必须分开 —— 后者用户已经拿到文件(见 events.ts 的口径说明)。
  async exportOutcomesSince(since: Date): Promise<{
    starts: number;
    oks: number;
    renderFails: number;
    uploadFails: number;
  }> {
    const rows = await db
      .select({
        name: analyticsEvents.name,
        step: sql<string | null>`${analyticsEvents.meta}->>'step'`,
        n: sql<number>`count(*)::int`,
      })
      .from(analyticsEvents)
      .where(and(gte(analyticsEvents.createdAt, since), sql`${analyticsEvents.name} in ('export_start','export_ok','export_fail')`))
      .groupBy(analyticsEvents.name, sql`${analyticsEvents.meta}->>'step'`);

    let starts = 0;
    let oks = 0;
    let renderFails = 0;
    let uploadFails = 0;
    for (const row of rows) {
      if (row.name === 'export_start') starts += row.n;
      else if (row.name === 'export_ok') oks += row.n;
      else if (row.name === 'export_fail' && row.step === 'render') renderFails += row.n;
      else if (row.name === 'export_fail' && row.step === 'upload') uploadFails += row.n;
    }
    return { starts, oks, renderFails, uploadFails };
  },

  // 云端备份:批次与张数(evalue 在 upload_* 事件里就是张数)
  async uploadTotalsSince(since: Date): Promise<{
    okBatches: number;
    okPhotos: number;
    failBatches: number;
    failPhotos: number;
  }> {
    const rows = await db
      .select({
        name: analyticsEvents.name,
        batches: sql<number>`count(*)::int`,
        photos: sql<number>`coalesce(sum(${analyticsEvents.value}), 0)::int`,
      })
      .from(analyticsEvents)
      .where(and(gte(analyticsEvents.createdAt, since), sql`${analyticsEvents.name} in ('upload_ok','upload_fail')`))
      .groupBy(analyticsEvents.name);

    let okBatches = 0;
    let okPhotos = 0;
    let failBatches = 0;
    let failPhotos = 0;
    for (const row of rows) {
      if (row.name === 'upload_ok') {
        okBatches = row.batches;
        okPhotos = row.photos;
      } else {
        failBatches = row.batches;
        failPhotos = row.photos;
      }
    }
    return { okBatches, okPhotos, failBatches, failPhotos };
  },

  // 前端错误 Top:按脱敏后的 message 聚合,给出次数与最近一次时间
  async errorTopSince(
    since: Date,
    limit = 10,
  ): Promise<Array<{ message: string; kind: string; hits: number; lastAt: Date }>> {
    const rows = await db
      .select({
        message: sql<string>`coalesce(${analyticsEvents.meta}->>'message', '(no message)')`,
        kind: sql<string>`coalesce(${analyticsEvents.meta}->>'kind', 'error')`,
        hits: sql<number>`count(*)::int`,
        lastAt: sql<Date>`max(${analyticsEvents.createdAt})`,
      })
      .from(analyticsEvents)
      .where(and(eq(analyticsEvents.name, 'client_error'), gte(analyticsEvents.createdAt, since)))
      .groupBy(sql`1, 2`)
      .orderBy(sql`3 desc`)
      .limit(limit);
    return rows;
  },

  // 按天趋势:返回 [{day, name, n}],由调用方决定怎么画
  async dailyCountsSince(
    since: Date,
  ): Promise<Array<{ day: string; name: string; n: number }>> {
    const rows = await db
      .select({
        day: sql<string>`to_char(date_trunc('day', ${analyticsEvents.createdAt}), 'YYYY-MM-DD')`,
        name: analyticsEvents.name,
        n: sql<number>`count(*)::int`,
      })
      .from(analyticsEvents)
      .where(
        and(
          gte(analyticsEvents.createdAt, since),
          sql`${analyticsEvents.name} in ('landing_view','export_ok','client_error')`,
        ),
      )
      .groupBy(sql`1, 2`)
      .orderBy(sql`1`);
    return rows;
  },

  // 回访率的基础数据:每个主体在这个窗口里出现在几个不同的自然日。
  // 不在 SQL 里直接算比率:主体数很小(当前十几个),拉回来用 JS 算更好读,
  // 而且「出现在几个不同日子」这件事在 SQL 里容易把分母写错。
  async subjectDayCountsSince(since: Date): Promise<Array<{ days: number }>> {
    const rows = await db
      .select({
        days: sql<number>`count(distinct date_trunc('day', ${analyticsEvents.createdAt}))::int`,
      })
      .from(analyticsEvents)
      .where(and(gte(analyticsEvents.createdAt, since), sql`${analyticsEvents.subjectId} is not null`))
      .groupBy(analyticsEvents.subjectId);
    return rows;
  },

  // 环比:上一个等长窗口的相同统计。单独一个方法,而不是给 countByNameSince
  // 加个 until 参数 —— 读代码的人不该为了拿上期先理解一个三参签名。
  async countByNameBetween(from: Date, to: Date): Promise<Record<string, number>> {
    const rows = await db
      .select({ name: analyticsEvents.name, n: sql<number>`count(*)::int` })
      .from(analyticsEvents)
      .where(and(gte(analyticsEvents.createdAt, from), lt(analyticsEvents.createdAt, to)))
      .groupBy(analyticsEvents.name);
    return Object.fromEntries(rows.map((r) => [r.name, r.n]));
  },

  // 环比用「人」口径,和漏斗同一套:用次数比会让「一个人刷五次」看起来像增长。
  async distinctSubjectsByNameBetween(from: Date, to: Date): Promise<Record<string, number>> {
    const rows = await db
      .select({
        name: analyticsEvents.name,
        n: sql<number>`count(distinct ${analyticsEvents.subjectId})::int`,
      })
      .from(analyticsEvents)
      .where(and(gte(analyticsEvents.createdAt, from), lt(analyticsEvents.createdAt, to)))
      .groupBy(analyticsEvents.name);
    return Object.fromEntries(rows.map((r) => [r.name, r.n]));
  },

  // 相册打开与分享:album_open 按 source(owner/visitor) 分,share_click 按 result 分。
  // 「分享出去 → 有人真的打开」是这个产品唯一的外部增长路径,分子分母必须分开算。
  async albumShareSince(since: Date): Promise<{
    openOwner: number;
    openVisitor: number;
    shareOk: number;
    shareFail: number;
  }> {
    const rows = await db
      .select({
        name: analyticsEvents.name,
        source: sql<string | null>`${analyticsEvents.meta}->>'source'`,
        result: analyticsEvents.result,
        n: sql<number>`count(*)::int`,
      })
      .from(analyticsEvents)
      .where(
        and(
          gte(analyticsEvents.createdAt, since),
          sql`${analyticsEvents.name} in ('album_open','share_click')`,
        ),
      )
      .groupBy(analyticsEvents.name, sql`${analyticsEvents.meta}->>'source'`, analyticsEvents.result);

    let openOwner = 0;
    let openVisitor = 0;
    let shareOk = 0;
    let shareFail = 0;
    for (const row of rows) {
      if (row.name === 'album_open') {
        if (row.source === 'visitor') openVisitor += row.n;
        else openOwner += row.n;
      } else if (row.result === 'ok') {
        shareOk += row.n;
      } else {
        shareFail += row.n;
      }
    }
    return { openOwner, openVisitor, shareOk, shareFail };
  },

  // 失败原因 Top:export_fail / upload_fail 的 meta.code 分布。
  // 有了这张表,"失败了几次"才变成"该修什么" —— code 来自封闭词表,不含原文。
  async failureCodesSince(
    since: Date,
    limit = 10,
  ): Promise<Array<{ name: string; code: string; step: string; hits: number }>> {
    const rows = await db
      .select({
        name: analyticsEvents.name,
        code: sql<string>`coalesce(${analyticsEvents.meta}->>'code', '(none)')`,
        step: sql<string>`coalesce(${analyticsEvents.meta}->>'step', '-')`,
        hits: sql<number>`count(*)::int`,
      })
      .from(analyticsEvents)
      .where(
        and(
          gte(analyticsEvents.createdAt, since),
          sql`${analyticsEvents.name} in ('export_fail','upload_fail')`,
        ),
      )
      .groupBy(analyticsEvents.name, sql`${analyticsEvents.meta}->>'code'`, sql`${analyticsEvents.meta}->>'step'`)
      .orderBy(sql`count(*) desc`)
      .limit(limit);
    return rows;
  },
};
