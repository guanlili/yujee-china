import { creemService } from '@/services/billing/creem-service';
import { fromException } from '@/lib/api/from-exception';

// Shared Creem webhook request handler. Mounted at two routes so it works no
// matter which path Creem is configured to deliver to:
//   - /api/webhooks/creem            (canonical)
//   - /api/auth/creem/webhook        (better-auth plugin default; some Creem
//                                     dashboards were pointed here and 404'd on
//                                     the better-auth [...all] catch-all)
// Keeping a single function means the verification + entitlement logic never
// diverges between the two entry points.
export async function handleCreemWebhook(req: Request): Promise<Response> {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get('creem-signature');
    await creemService.handleWebhook(rawBody, signature);
    return Response.json({ received: true });
  } catch (e) {
    return fromException(e);
  }
}
