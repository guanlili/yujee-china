import { stripeService } from '@/services/billing/stripe-service';
import { fromException } from '@/lib/api/from-exception';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    // Signature verification requires the raw body bytes Stripe signed.
    const rawBody = await req.text();
    const signature = req.headers.get('stripe-signature');
    await stripeService.handleWebhook(rawBody, signature);
    return Response.json({ received: true });
  } catch (e) {
    return fromException(e);
  }
}
