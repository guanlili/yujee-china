import { eq, sql } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { creditHoldRepo } from '@/db/repos/credit-hold-repo';
import { creditLedgerRepo } from '@/db/repos/credit-ledger-repo';
import { albumRepo } from '@/db/repos/album-repo';
import { userRepo } from '@/db/repos/user-repo';
import { users, type CreditLedger } from '@/db/schema';
import { ERRORS } from '@/lib/api/error-codes';
import { CREDIT_COST_PER_ALBUM } from '@/config/pricing';

type LedgerReason =
  | 'SIGNUP_BONUS'
  | 'GENERATION_HOLD'
  | 'GENERATION_SETTLE'
  | 'GENERATION_RELEASE'
  | 'PURCHASE'
  | 'REFUND'
  | 'ADMIN_ADJUST';

type ApplyDeltaRefs = {
  albumId?: string;
  holdId?: string;
  externalEventId?: string;
  meta?: Record<string, unknown>;
};

export const creditService = {
  cost: (): number => CREDIT_COST_PER_ALBUM,

  async precheck(userId: string, amount: number = CREDIT_COST_PER_ALBUM): Promise<void> {
    const user = await userRepo.findById(userId);
    if (!user) throw ERRORS.UNAUTHORIZED();
    if (user.creditBalance < amount) throw ERRORS.CREDIT_INSUFFICIENT();
  },

  // The only sanctioned chokepoint for balance changes. Updates
  // users.credit_balance and writes a credit_ledger row inside the caller's tx,
  // so balance and audit trail commit together (invariant 8).
  //
  // refs.externalEventId — set on PURCHASE / REFUND. The partial UNIQUE index
  //   uq_credit_ledger_external_event then makes webhook re-delivery a no-op.
  async applyDelta(
    tx: DbOrTx,
    userId: string,
    delta: number,
    reason: LedgerReason,
    refs: ApplyDeltaRefs = {},
  ): Promise<CreditLedger> {
    let balanceAfter: number;
    if (delta !== 0) {
      const updated = await tx
        .update(users)
        .set({
          creditBalance: sql`${users.creditBalance} + ${delta}`,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId))
        .returning({ creditBalance: users.creditBalance });
      if (!updated[0]) throw ERRORS.UNAUTHORIZED();
      balanceAfter = updated[0].creditBalance;
    } else {
      const row = await tx
        .select({ creditBalance: users.creditBalance })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!row[0]) throw ERRORS.UNAUTHORIZED();
      balanceAfter = row[0].creditBalance;
    }

    const meta: Record<string, unknown> = { ...(refs.meta ?? {}) };
    if (refs.externalEventId) meta.external_event_id = refs.externalEventId;

    return creditLedgerRepo.create(tx, {
      userId,
      delta,
      reason,
      balanceAfter,
      relatedAlbumId: refs.albumId ?? null,
      relatedHoldId: refs.holdId ?? null,
      meta: Object.keys(meta).length > 0 ? meta : null,
    });
  },

  // AGENT_RUNNING transition: reserve credit. Creates credit_holds row,
  // links it onto albums.credit_hold_id, drops a 0-delta ledger crumb for
  // audit. Balance does not change yet (settle does that).
  async hold(
    tx: DbOrTx,
    userId: string,
    amount: number,
    albumId: string,
  ): Promise<string> {
    const hold = await creditHoldRepo.create(tx, {
      userId,
      albumId,
      amount,
      status: 'HOLDING',
    });
    await albumRepo.update(tx, albumId, { creditHoldId: hold.id });
    await this.applyDelta(tx, userId, 0, 'GENERATION_HOLD', {
      albumId,
      holdId: hold.id,
      meta: { amount },
    });
    return hold.id;
  },

  // Generation completed: debit the user, mark hold SETTLED, record the
  // negative ledger row. Idempotent on already-settled / missing holds.
  async settle(tx: DbOrTx, userId: string, holdId: string): Promise<void> {
    const hold = await creditHoldRepo.findById(holdId);
    if (!hold || hold.status !== 'HOLDING') return;
    await creditHoldRepo.update(tx, holdId, {
      status: 'SETTLED',
      settledAt: new Date(),
    });
    await this.applyDelta(tx, userId, -hold.amount, 'GENERATION_SETTLE', {
      albumId: hold.albumId,
      holdId,
    });
  },

  // Generation failed: drop the reservation without debiting. Idempotent.
  async release(tx: DbOrTx, holdId: string): Promise<void> {
    const hold = await creditHoldRepo.findById(holdId);
    if (!hold || hold.status !== 'HOLDING') return;
    await creditHoldRepo.update(tx, holdId, { status: 'RELEASED' });
    await this.applyDelta(tx, hold.userId, 0, 'GENERATION_RELEASE', {
      albumId: hold.albumId,
      holdId,
    });
  },

  async releaseByAlbum(tx: DbOrTx, albumId: string): Promise<void> {
    const album = await albumRepo.findById(albumId);
    if (!album?.creditHoldId) return;
    await this.release(tx, album.creditHoldId);
  },
};
