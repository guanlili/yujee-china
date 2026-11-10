import { currentAdmin } from '@/lib/auth/require-admin';
import { adminService } from '@/services/admin/admin-service';
import { getMessages } from '@/lib/i18n/messages';
import type { Locale } from '@/lib/i18n/routing';
import { AdminNav } from '@/components/admin/AdminNav';
import { AdminForbidden } from '@/components/admin/AdminForbidden';

const ALBUM_STATUSES = ['AGENT_RUNNING', 'EDITING', 'COMPLETED', 'FAILED'] as const;
const JOB_STATUSES = ['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED'] as const;

// 看板口径:一屏看完「有没有人来 / 有没有做成 / 卡在哪 / 出了什么错」。
// 上半是账号与相册的基本盘(原先就有),下半是新接的产品行为。
export default async function AdminAnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<{ days?: string }>;
}) {
  const { locale } = await params;
  const admin = await currentAdmin();
  if (!admin) return <AdminForbidden locale={locale} />;

  const [{ days: rawDays }, data] = await Promise.all([searchParams, adminService.getAnalytics(admin.id)]);
  const days = Number(rawDays) === 30 || Number(rawDays) === 90 ? Number(rawDays) : 7;
  const product = await adminService.getProductInsights(days);

  const t = getMessages(locale).admin.analytics;
  const p = t.product;
  const n = (v: number) => v.toLocaleString(locale);
  const pct = (v: number | null) => (v === null ? '—' : `${v}%`);

  // 漏斗条:以第一个能取到数的环节为 100%,后面的按比例缩 —— 一眼看出掉在哪一格
  const funnelStages = [
    { key: 'funnelLanding', value: product.funnel.landingVisitors, wired: true },
    { key: 'funnelBook', value: product.funnel.bookStarters, wired: false },
    { key: 'funnelExport', value: product.funnel.exporters, wired: true },
    { key: 'funnelCheckout', value: product.funnel.buyers, wired: true },
  ] as const;
  const funnelTop = Math.max(1, ...funnelStages.map((s) => s.value));

  // 趋势:把稀疏的 (day, name, n) 补成连续日期序列,缺的补 0
  const trendSeries = ['landing_view', 'export_ok', 'client_error'] as const;
  const dayMap = new Map<string, Record<string, number>>();
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dayMap.set(d.toISOString().slice(0, 10), {});
  }
  for (const row of product.daily) {
    const bucket = dayMap.get(row.day);
    if (bucket) bucket[row.name] = row.n;
  }
  const trend = [...dayMap.entries()].map(([day, values]) => ({ day, values }));
  const trendPeak = Math.max(
    1,
    ...trend.map((row) => trendSeries.reduce((sum, name) => sum + (row.values[name] ?? 0), 0)),
  );

  const card = 'rounded-xl border border-[var(--border)] bg-white p-5';
  const label = 'text-xs uppercase tracking-widest text-[var(--muted)] mb-3';

  return (
    <main className="min-h-screen max-w-6xl mx-auto px-6 py-12">
      <AdminNav locale={locale} active="analytics" />
      <div className="flex items-end justify-between mb-8 flex-wrap gap-4">
        <h1 className="serif text-4xl">{t.title}</h1>
        {/* 时间窗口:三个链接,不回写 state,刷新后仍停在同一窗口 */}
        <nav className="flex gap-1 text-sm" aria-label={p.window}>
          {[7, 30, 90].map((d) => (
            <a
              key={d}
              href={`?days=${d}`}
              className={
                d === days
                  ? 'px-3 py-1.5 rounded-lg bg-[var(--ink)] text-white'
                  : 'px-3 py-1.5 rounded-lg border border-[var(--border)] text-[var(--muted)] hover:text-[var(--ink)]'
              }
              aria-current={d === days ? 'page' : undefined}
            >
              {d === 7 ? p.days7 : d === 30 ? p.days30 : p.days90}
            </a>
          ))}
        </nav>
      </div>

      {/* ─── 产品行为:埋点读出来的四个数 ─── */}
      <section className="mb-3">
        <p className={label}>{p.title}</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {[
            { k: p.kpiVisitors, v: n(product.funnel.landingVisitors) },
            { k: p.kpiBookStarters, v: n(product.funnel.bookStarters) },
            { k: p.kpiExports, v: n(product.export.oks) },
            { k: p.kpiSuccess, v: pct(product.export.successRate) },
            { k: p.kpiUploadFails, v: n(product.upload.failPhotos) },
            { k: p.kpiErrors, v: n(product.totals.errors) },
          ].map((item) => (
            <div key={item.k} className={card}>
              <p className="text-xs uppercase tracking-widest text-[var(--muted)]">{item.k}</p>
              <p className="serif text-3xl mt-2">{item.v}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ─── 漏斗 ─── */}
      <section className={`${card} mb-3`}>
        <p className={label}>{p.funnel}</p>
        <dl className="space-y-3">
          {funnelStages.map((stage) => (
            <div key={stage.key}>
              <div className="flex justify-between text-sm mb-1">
                <dt>
                  {p[stage.key]}
                  {stage.wired ? null : (
                    <span className="ml-2 text-xs text-[var(--muted)]">({p.notWired})</span>
                  )}
                </dt>
                <dd className="tabular-nums">
                  {n(stage.value)}
                  <span className="text-[var(--muted)] ml-2 text-xs">
                    {product.funnel.landingVisitors > 0
                      ? `${Math.round((stage.value / product.funnel.landingVisitors) * 100)}%`
                      : '—'}
                  </span>
                </dd>
              </div>
              <div className="h-2 rounded-full bg-[var(--border)] overflow-hidden">
                <div
                  className="h-full bg-[var(--ink)]"
                  style={{ width: `${Math.round((stage.value / funnelTop) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </dl>
        {product.funnel.landingVisitors === 0 ? (
          <p className="text-xs text-[var(--muted)] mt-3">{p.noData}</p>
        ) : null}
      </section>

      <div className="grid md:grid-cols-2 gap-3 mb-3">
        {/* ─── 导出健康 ─── */}
        <section className={card}>
          <p className={label}>{p.exportHealth}</p>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-[var(--muted)]">{p.starts}</dt>
              <dd className="tabular-nums">{n(product.export.starts)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[var(--muted)]">{p.oks}</dt>
              <dd className="tabular-nums">{n(product.export.oks)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[var(--muted)]">{p.renderFails}</dt>
              <dd className="tabular-nums">{n(product.export.renderFails)}</dd>
            </div>
            {/* 云端上传失败发生在用户已拿到文件之后,单独一行,避免污染成功率 */}
            <div className="flex justify-between">
              <dt className="text-[var(--muted)]">{p.uploadFails}</dt>
              <dd className="tabular-nums">{n(product.export.uploadFails)}</dd>
            </div>
            <div className="flex justify-between border-t border-[var(--border)] pt-2">
              <dt className="text-[var(--muted)]">{p.latency}</dt>
              <dd className="tabular-nums">
                {product.export.p50 === null ? '—' : `${n(product.export.p50)} ms`}
                {' / '}
                {product.export.p95 === null ? '—' : `${n(product.export.p95)} ms`}
              </dd>
            </div>
          </dl>
        </section>

        {/* ─── 云端备份 ─── */}
        <section className={card}>
          <p className={label}>{p.backup}</p>
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-[var(--muted)]">{p.okPhotos}</dt>
              <dd className="serif text-2xl mt-1">{n(product.upload.okPhotos)}</dd>
              <dd className="text-xs text-[var(--muted)] mt-1">
                {p.okBatches}: {n(product.upload.okBatches)}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">{p.failPhotos}</dt>
              <dd className="serif text-2xl mt-1">{n(product.upload.failPhotos)}</dd>
              <dd className="text-xs text-[var(--muted)] mt-1">
                {p.failBatches}: {n(product.upload.failBatches)}
              </dd>
            </div>
          </dl>
        </section>
      </div>

      {/* ─── 每日趋势:每天三根柱,同比例缩放 ─── */}
      <section className={`${card} mb-3`}>
        <p className={label}>{p.trend}</p>
        <div className="flex items-end gap-[2px] h-28">
          {trend.map((row) => {
            const total = trendSeries.reduce((sum, name) => sum + (row.values[name] ?? 0), 0);
            return (
              <div
                key={row.day}
                className="flex-1 flex items-end gap-[1px] group relative"
                style={{ minWidth: 2 }}
                title={`${row.day} · ${p.trendLanding} ${row.values.landing_view ?? 0} · ${p.trendExport} ${row.values.export_ok ?? 0} · ${p.trendErrors} ${row.values.client_error ?? 0}`}
              >
                <div
                  className="flex-1 bg-[var(--muted)]/40"
                  style={{ height: `${Math.round(((row.values.landing_view ?? 0) / trendPeak) * 100)}%`, minHeight: total > 0 ? 2 : 0 }}
                />
                <div
                  className="flex-1 bg-[var(--ink)]"
                  style={{ height: `${Math.round(((row.values.export_ok ?? 0) / trendPeak) * 100)}%` }}
                />
                <div
                  className="flex-1 bg-red-600"
                  style={{ height: `${Math.round(((row.values.client_error ?? 0) / trendPeak) * 100)}%` }}
                />
              </div>
            );
          })}
        </div>
        <div className="flex gap-4 text-xs text-[var(--muted)] mt-3">
          <span>■ {p.trendLanding}</span>
          <span className="text-[var(--ink)]">■ {p.trendExport}</span>
          <span className="text-red-600">■ {p.trendErrors}</span>
        </div>
      </section>

      {/* ─── 前端错误 Top ─── */}
      <section className={card}>
        <p className={label}>{p.errorTop}</p>
        {product.errors.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">{p.noData}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-widest text-[var(--muted)] text-left">
                <th className="py-2 font-normal">{p.errorMessage}</th>
                <th className="py-2 font-normal">{p.errorKind}</th>
                <th className="py-2 font-normal text-right">{p.errorHits}</th>
                <th className="py-2 font-normal text-right">{p.errorLast}</th>
              </tr>
            </thead>
            <tbody>
              {product.errors.map((err) => (
                <tr key={`${err.kind}:${err.message}`} className="border-t border-[var(--border)]">
                  <td className="py-2 pr-3 font-mono text-xs break-all">{err.message}</td>
                  <td className="py-2 pr-3 text-[var(--muted)]">{err.kind}</td>
                  <td className="py-2 text-right tabular-nums">{n(err.hits)}</td>
                  <td className="py-2 text-right text-[var(--muted)] text-xs">
                    {new Date(err.lastAt).toLocaleString(locale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* ─── 原有基本盘 ─── */}
      <div className="grid md:grid-cols-2 gap-3 mt-3">
        <div className={card}>
          <p className={label}>{t.users}</p>
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between"><dt>{t.total}</dt><dd className="serif text-lg">{n(data.users.total)}</dd></div>
            <div className="flex justify-between"><dt className="text-[var(--muted)]">{t.last7d}</dt><dd>{n(data.users.last7d)}</dd></div>
            <div className="flex justify-between"><dt className="text-[var(--muted)]">{t.last30d}</dt><dd>{n(data.users.last30d)}</dd></div>
          </dl>
        </div>
        <div className={card}>
          <p className={label}>{t.albums}</p>
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between"><dt>{t.total}</dt><dd className="serif text-lg">{n(data.albums.total)}</dd></div>
            <div className="flex justify-between"><dt className="text-[var(--muted)]">{t.last7d}</dt><dd>{n(data.albums.last7d)}</dd></div>
            <div className="flex justify-between"><dt className="text-[var(--muted)]">{t.last30d}</dt><dd>{n(data.albums.last30d)}</dd></div>
          </dl>
        </div>
        <div className={card}>
          <p className={label}>{t.albumsByStatus}</p>
          <dl className="space-y-1.5 text-sm">
            {ALBUM_STATUSES.map((s) => (
              <div key={s} className="flex justify-between">
                <dt className="text-[var(--muted)]">{t.albumStatus[s]}</dt>
                <dd>{n(data.albumsByStatus[s])}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className={card}>
          <p className={label}>{t.jobsByStatus}</p>
          <dl className="space-y-1.5 text-sm">
            {JOB_STATUSES.map((s) => (
              <div key={s} className="flex justify-between">
                <dt className="text-[var(--muted)]">{t.jobStatus[s]}</dt>
                <dd>{n(data.jobsByStatus[s])}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <div className={`${card} mt-3`}>
        <p className={label}>{t.credits}</p>
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-[var(--muted)]">{t.purchased}</dt>
            <dd className="serif text-2xl mt-1 text-emerald-700">+{n(data.credits.purchased30d)}</dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">{t.consumed}</dt>
            <dd className="serif text-2xl mt-1">{n(data.credits.consumed30d)}</dd>
          </div>
        </dl>
      </div>
    </main>
  );
}
