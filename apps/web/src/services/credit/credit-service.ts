import { eq, sql } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { creditHoldRepo } from '@/db/repos/credit-hold-repo';
import { creditLedgerRepo } from '@/db/repos/credit-ledger-repo';
import { albumRepo } from '@/db/repos/album-repo';
import { userRepo } from '@/db/repos/user-repo';
import { users, type CreditLedger } from '@/db/schema';
import { ERRORS } from '@/lib/api/error-codes';
import { creditsForPhotos } from '@/config/pricing';

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
  // Credits a generation of `photoCount` photos costs (§6.7): ceil(N / PHOTOS_PER_CREDIT),
  // floored at 1. The photos-per-credit threshold lives only in pricing.ts.
  cost: (photoCount = 1): number => creditsForPhotos(photoCount),

  async getBalance(userId: string): Promise<number> {
    const user = await userRepo.findById(userId);
    if (!user) throw ERRORS.UNAUTHORIZED();
    return user.creditBalance;
  },

  async listHistory(userId: string, limit = 50) {
    const rows = await creditLedgerRepo.findByUser(userId, limit);
    return rows.map((r) => ({
      id: r.id,
      delta: r.delta,
      reason: r.reason,
      balanceAfter: r.balanceAfter,
      relatedAlbumId: r.relatedAlbumId,
      createdAt: r.createdAt,
    }));
  },

  async precheck(userId: string, amount: number): Promise<void> {
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
    // Conditional transition gates the debit: if a concurrent caller already
    // settled/released this hold, we don't win the UPDATE and skip applyDelta —
    // no double-debit even under a callback race.
    const won = await creditHoldRepo.transitionFromHolding(tx, holdId, 'SETTLED', {
      settledAt: new Date(),
    });
    if (!won) return;
    await this.applyDelta(tx, userId, -hold.amount, 'GENERATION_SETTLE', {
      albumId: hold.albumId,
      holdId,
    });
  },

  // Generation failed: drop the reservation without debiting. Idempotent even
  // under concurrent callers (sweep + cron) — only the winner writes the crumb.
  async release(tx: DbOrTx, holdId: string): Promise<void> {
    const hold = await creditHoldRepo.findById(holdId);
    if (!hold || hold.status !== 'HOLDING') return;
    const won = await creditHoldRepo.transitionFromHolding(tx, holdId, 'RELEASED');
    if (!won) return;
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
