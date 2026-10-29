import { currentAdmin } from '@/lib/auth/require-admin';
import { AdminNav } from '@/components/admin/AdminNav';
import { AdminForbidden } from '@/components/admin/AdminForbidden';
import ChangelogAdmin from '@/components/admin/ChangelogAdmin';
import type { Locale } from '@/lib/i18n/routing';

export default async function AdminChangelogPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  const admin = await currentAdmin();
  if (!admin) return <AdminForbidden locale={locale} />;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <AdminNav locale={locale} active="changelog" />
      <ChangelogAdmin />
    </div>
  );
}
