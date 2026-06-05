import { createHmac, timingSafeEqual } from 'node:crypto';
import { db } from '@/db/client';
import { customerRepo } from '@/db/repos/customer-repo';
import { userRepo } from '@/db/repos/user-repo';
import { creditLedgerRepo } from '@/db/repos/credit-ledger-repo';
import { creditService } from '@/services/credit/credit-service';
import {
  ADDON_PACKS,
  CREEM_PRODUCT_ENV_BY_PACK_ID,
  buildCheckoutReturnUrls,
  type CheckoutReturnContext,
} from '@/config/pricing';
import { env } from '@/lib/env';
import { ERRORS } from '@/lib/api/error-codes';
import { logger } from '@/lib/log/logger';

// Creem.io — hosted checkout for international markets. Uses the shared
// applyDelta + external_event_id idempotency contract. Creem product mapping
// (Creem requires products created in their dashboard) is intentionally
// is pack-id-keyed so the client can stay provider-agnostic.

type CreemEvent = {
  id: string;
  type: string; // e.g. 'checkout.completed'
  createdAt?: unknown;
  object?: {
    id?: string;
    status?: string;
    customer?: { id?: string; email?: string };
    metadata?: Record<string, string>;
    amount?: number; // cents
    order?: { amount?: number }; // cents, Creem's real checkout payload
  };
};

async function postJson<T>(path: string, body: unknown): Promise<T> {
  if (!env.CREEM_API_KEY) throw ERRORS.BILLING_NOT_CONFIGURED();
  const res = await fetch(`${env.CREEM_API_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'x-api-key': env.CREEM_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    logger.warn({ status: res.status, body: text, path }, 'creem api error');
    throw ERRORS.INTERNAL_ERROR();
  }
  return res.json() as Promise<T>;
}

export const creemService = {
  async createPackCheckout(
    userId: string,
    packId: string,
    context: CheckoutReturnContext = {},
  ): Promise<{ url: string }> {
    const pack = ADDON_PACKS.find((p) => p.id === packId);
    if (!pack) throw ERRORS.VALIDATION_FAILED(`Unknown pack: ${packId}`);
    const user = await userRepo.findById(userId);
    if (!user) throw ERRORS.UNAUTHORIZED();

    const existing = await customerRepo.findByUserAndProvider(userId, 'creem');
    const { successUrl } = buildCheckoutReturnUrls(
      env.WEB_BASE_URL,
      'creem',
      context,
    );

    // Creem checkout payload. The exact field names mirror Creem's REST API
    // (see https://docs.creem.io/api-reference/checkout-sessions/create-checkout-session).
    // Product mapping lives on Creem's side; we pass our pack id through metadata.
    const session = await postJson<{ id: string; checkout_url: string }>(
      '/v1/checkouts',
      {
        product_id: resolveCreemProductId(pack.id),
        customer: existing
          ? { id: existing.externalCustomerId }
          : { email: user.email },
        success_url: successUrl,
        metadata: { userId, kind: 'pack', packId },
      },
    );

    if (!session.checkout_url) throw ERRORS.INTERNAL_ERROR();
    return { url: session.checkout_url };
  },

  async handleWebhook(rawBody: string, signature: string | null): Promise<void> {
    if (!env.CREEM_WEBHOOK_SECRET) throw ERRORS.WEBHOOK_NOT_CONFIGURED();
    if (!signature) throw ERRORS.WEBHOOK_SIGNATURE_INVALID();
    if (!verifyHmac(rawBody, signature, env.CREEM_WEBHOOK_SECRET)) {
      logger.warn({}, 'creem webhook signature failed');
      throw ERRORS.WEBHOOK_SIGNATURE_INVALID();
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      throw ERRORS.VALIDATION_FAILED('creem payload not json');
    }
    const event = normalizeCreemEvent(payload);
    if (!event) {
      throw ERRORS.VALIDATION_FAILED('creem payload missing id/type');
    }

    const existing = await creditLedgerRepo.findByExternalEventId(event.id);
    if (existing) {
      logger.info({ eventId: event.id, type: event.type }, 'creem webhook duplicate, skipped');
      return;
    }

    if (event.type === 'checkout.completed') {
      await applyCheckoutCompleted(event);
    } else {
      logger.info({ type: event.type, eventId: event.id }, 'creem webhook ignored');
    }
  },
};

function resolveCreemProductId(packId: keyof typeof CREEM_PRODUCT_ENV_BY_PACK_ID): string {
  const envKey = CREEM_PRODUCT_ENV_BY_PACK_ID[packId];
  const productId = env[envKey];
  if (!productId) {
    logger.warn({ packId, envKey }, 'creem product id missing');
    throw ERRORS.BILLING_NOT_CONFIGURED();
  }
  return productId;
}

function verifyHmac(body: string, signature: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(body).digest('hex');
  if (expected.length !== signature.length) return false;
  try {
    const a = new Uint8Array(Buffer.from(expected, 'utf8'));
    const b = new Uint8Array(Buffer.from(signature, 'utf8'));
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function normalizeCreemEvent(payload: unknown): CreemEvent | null {
  if (!isRecord(payload)) return null;
  const id = typeof payload.id === 'string' ? payload.id : null;
  const type =
    typeof payload.type === 'string'
      ? payload.type
      : typeof payload.eventType === 'string'
        ? payload.eventType
        : null;
  if (!id || !type) return null;

  const dataObject = isRecord(payload.data) ? payload.data.object : undefined;
  const object = isRecord(dataObject)
    ? dataObject
    : isRecord(payload.object)
      ? payload.object
      : undefined;
  return { id, type, createdAt: payload.created_at ?? payload.createdAt, object: object as CreemEvent['object'] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function applyCheckoutCompleted(event: CreemEvent): Promise<void> {
  const obj = event.object;
  const meta = obj?.metadata ?? {};
  const userId = meta.userId;
  const packId = meta.packId;
  if (!userId || meta.kind !== 'pack' || !packId) {
    logger.warn({ eventId: event.id }, 'creem checkout metadata incomplete');
    return;
  }
  const pack = ADDON_PACKS.find((p) => p.id === packId);
  if (!pack) {
    logger.warn({ eventId: event.id, packId }, 'creem pack unknown');
    return;
  }

  await db.transaction(async (tx) => {
    if (obj?.customer?.id) {
      const existing = await customerRepo.findByUserAndProvider(userId, 'creem');
      if (!existing) {
        await customerRepo.create(tx, {
          userId,
          provider: 'creem',
          externalCustomerId: obj.customer.id,
          email: obj.customer.email ?? null,
        });
      }
    }
    await creditService.applyDelta(tx, userId, pack.books, 'PURCHASE', {
      externalEventId: event.id,
      meta: {
        provider: 'creem',
        session_id: obj?.id ?? null,
        pack_id: pack.id,
        amount_cents: obj?.amount ?? obj?.order?.amount ?? Math.round(pack.priceUsd * 100),
      },
    });
  });

  logger.info(
    { userId, packId, books: pack.books, eventId: event.id },
    'creem purchase credited',
  );
}
