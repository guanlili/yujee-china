import { creemService } from '@/services/billing/creem-service';
import { fromException } from '@/lib/api/from-exception';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get('creem-signature');
    await creemService.handleWebhook(rawBody, signature);
    return Response.json({ received: true });
  } catch (e) {
    return fromException(e);
  }
}
