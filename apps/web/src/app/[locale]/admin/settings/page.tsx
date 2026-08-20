import { currentAdmin } from '@/lib/auth/require-admin';
import { getMessages } from '@/lib/i18n/messages';
import type { Locale } from '@/lib/i18n/routing';
import { env } from '@/lib/env';
import { PHOTOS_PER_CREDIT } from '@/config/pricing';
import { AdminNav } from '@/components/admin/AdminNav';
import { AdminForbidden } from '@/components/admin/AdminForbidden';
import { resolveImageProvider } from '@/lib/imagegen/provider';
import { AdminMaintenance } from '@/components/admin/AdminMaintenance';

export default async function AdminSettingsPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  const admin = await currentAdmin();
  if (!admin) return <AdminForbidden locale={locale} />;

  const t = getMessages(locale).admin.settings;

  const providers = [
    { name: 'Waffo', on: Boolean(env.WAFFO_MERCHANT_ID) },
    { name: 'Creem(兜底)', on: Boolean(env.CREEM_API_KEY) },
  ];

  // 生图 provider 的**生效状态**,不是配置值的回显:resolveImageProvider 返回 null 就
  // 表示这套环境下生图不可用(选了 gemini 却只配了 ARK_API_KEY 是最常见的一种)。
  // 它不做跨家回落 —— 那是合规问题,不是可用性问题 —— 所以配错时用户点「生成」会直接
  // 拿到 501,而不是悄悄发去另一个国家的服务商。
  //
  // 单独把它显示出来,是因为这些 key 在 Vercel 上是 sensitive env,面板里读不回明文,
  // 线上到底生效的是哪一家、能不能用,以前只能靠真去生一张图才知道。
  const imageProvider = resolveImageProvider(env);

  return (
    <main className="min-h-screen max-w-3xl mx-auto px-6 py-12">
      <AdminNav locale={locale} active="settings" />
      <h1 className="serif text-4xl mb-8">{t.title}</h1>

      <section className="rounded-xl border border-[var(--border)] bg-white p-6 mb-8">
        <h2 className="text-lg font-semibold mb-4">{t.config}</h2>
        <dl className="space-y-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-[var(--muted)]">{t.creditCost}</dt>
            <dd>{PHOTOS_PER_CREDIT.toLocaleString(locale)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-[var(--muted)]">{t.agent}</dt>
            <dd className="font-mono text-xs">{env.AGENT_BASE_URL}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-[var(--muted)]">{t.imageGen}</dt>
            <dd>
              <span
                className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
                  imageProvider
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-red-100 text-red-800'
                }`}
              >
                {imageProvider
                  ? `${imageProvider.name} · ${t.configured}`
                  : `${env.IMAGE_PROVIDER} · ${t.imageGenBroken}`}
              </span>
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-[var(--muted)]">{t.providers}</dt>
            <dd className="flex gap-2">
              {providers.map((p) => (
                <span
                  key={p.name}
                  className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
                    p.on ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {p.name} · {p.on ? t.configured : t.disabled}
                </span>
              ))}
            </dd>
          </div>
        </dl>
      </section>

      <AdminMaintenance locale={locale} />
    </main>
  );
}
