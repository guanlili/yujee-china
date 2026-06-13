import { handleCreemWebhook } from '@/lib/billing/handle-creem-webhook';

// Compatibility entry point: Creem's dashboard was configured to deliver here
// (the better-auth Creem plugin's default path), but this app has no such
// plugin, so the request fell through to /api/auth/[...all] and 404'd — paid
// books never got credited. This static segment is more specific than the
// [...all] catch-all, so Next.js routes Creem's POST here instead. Delegates to
// the same handler as the canonical /api/webhooks/creem route.
export const runtime = 'nodejs';

export const POST = handleCreemWebhook;
