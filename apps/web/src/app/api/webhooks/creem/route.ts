import { handleCreemWebhook } from '@/lib/billing/handle-creem-webhook';

export const runtime = 'nodejs';

export const POST = handleCreemWebhook;
