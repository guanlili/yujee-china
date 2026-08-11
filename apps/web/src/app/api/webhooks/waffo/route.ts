import { handleWaffoWebhook } from '@/lib/billing/handle-waffo-webhook';

export const runtime = 'nodejs';

export const POST = handleWaffoWebhook;
