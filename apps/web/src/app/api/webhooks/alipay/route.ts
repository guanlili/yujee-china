import { handleAlipayWebhook } from '@/lib/billing/handle-alipay-webhook';

export const runtime = 'nodejs';

// Alipay POSTs application/x-www-form-urlencoded and expects the literal body
// `success`, so this route must not use the shared JSON envelope.
export const POST = handleAlipayWebhook;
