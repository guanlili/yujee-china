import { z } from 'zod';
import { requireRealUser } from '@/lib/auth/require-auth';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { defaultLocale, locales } from '@/lib/i18n/routing';
import { creemService } from '@/services/billing/creem-service';

// Billing checkout entry. Server-only because provider API keys must never reach
// the client bundle. Returns a hosted checkout URL; settlement and entitlement
// changes happen later via signed webhooks. Per-book billing (#97): packs only.
const schema = z.object({
  packId: z.string().min(1),
  locale: z.enum(locales).default(defaultLocale),
  from: z.enum(['album', 'create', 'home']).optional(),
});

export async function POST(req: Request) {
  try {
    const user = await requireRealUser(req);
    const body = await parseBody(schema, req);
    const { url } = await creemService.createPackCheckout(user.id, body.packId, {
      locale: body.locale,
      from: body.from,
    });
    return ok({ url });
  } catch (e) {
    return fromException(e);
  }
}
