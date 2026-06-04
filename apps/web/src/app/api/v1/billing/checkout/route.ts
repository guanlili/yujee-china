import { z } from 'zod';
import { requireAuth } from '@/lib/auth/require-auth';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { creemService } from '@/services/billing/creem-service';

// Billing checkout entry. Server-only because provider API keys must never reach
// the client bundle. Returns a hosted checkout URL; settlement and entitlement
// changes happen later via signed webhooks.
const schema = z.object({
  kind: z.enum(['pack', 'subscription']).default('pack'),
  packId: z.string().min(1).optional(),
  planId: z.enum(['pro', 'studio']).optional(),
  cycle: z.enum(['monthly', 'yearly']).optional(),
  locale: z.enum(['en', 'zh']).default('en'),
  from: z.enum(['album', 'create', 'home']).optional(),
}).superRefine((data, ctx) => {
  if (data.kind === 'pack' && !data.packId) {
    ctx.addIssue({ code: 'custom', path: ['packId'], message: 'packId is required' });
  }
  if (data.kind === 'subscription') {
    if (!data.planId) {
      ctx.addIssue({ code: 'custom', path: ['planId'], message: 'planId is required' });
    }
    if (!data.cycle) {
      ctx.addIssue({ code: 'custom', path: ['cycle'], message: 'cycle is required' });
    }
  }
});

export async function POST(req: Request) {
  try {
    const user = await requireAuth(req);
    const body = await parseBody(schema, req);
    const { url } = body.kind === 'subscription'
      ? await creemService.createSubscriptionCheckout(user.id, body.planId!, body.cycle!, { locale: body.locale })
      : await creemService.createPackCheckout(user.id, body.packId!, { locale: body.locale, from: body.from });
    return ok({ url });
  } catch (e) {
    return fromException(e);
  }
}
