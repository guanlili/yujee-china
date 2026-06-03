import { z } from 'zod';
import { requireAuth } from '@/lib/auth/require-auth';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { creemService } from '@/services/billing/creem-service';
import { ACTIVE_CHECKOUT_PROVIDER } from '@/config/pricing';

// Recharge entry. Server-only because the provider API keys must never reach the
// client bundle. Returns the hosted checkout URL for the browser to redirect to;
// crediting happens later via the Creem webhook.
const schema = z.object({
  packId: z.string().min(1),
  provider: z.literal(ACTIVE_CHECKOUT_PROVIDER).default(ACTIVE_CHECKOUT_PROVIDER),
  locale: z.enum(['en', 'zh']).default('en'),
  from: z.enum(['album', 'create', 'home']).optional(),
});

export async function POST(req: Request) {
  try {
    const user = await requireAuth(req);
    const { packId, locale, from } = await parseBody(schema, req);
    const { url } = await creemService.createPackCheckout(user.id, packId, { locale, from });
    return ok({ url });
  } catch (e) {
    return fromException(e);
  }
}
