import { z } from 'zod';
import { requireAuth } from '@/lib/auth/require-auth';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { stripeService } from '@/services/billing/stripe-service';
import { creemService } from '@/services/billing/creem-service';

// Recharge entry. Server-only because the provider API keys must never reach the
// client bundle. Returns the hosted checkout URL for the browser to redirect to;
// crediting happens later via the Stripe/Creem webhook (migration §8).
const schema = z.object({
  packId: z.string().min(1),
  provider: z.enum(['stripe', 'creem']).default('creem'),
  locale: z.enum(['en', 'zh']).default('en'),
  from: z.enum(['album', 'create', 'home']).optional(),
});

export async function POST(req: Request) {
  try {
    const user = await requireAuth(req);
    const { packId, provider, locale, from } = await parseBody(schema, req);
    const svc = provider === 'stripe' ? stripeService : creemService;
    const { url } = await svc.createPackCheckout(user.id, packId, { locale, from });
    return ok({ url });
  } catch (e) {
    return fromException(e);
  }
}
