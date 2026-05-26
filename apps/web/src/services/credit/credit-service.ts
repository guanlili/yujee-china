import type { DB } from '@/db/client';
import { creditHoldRepo } from '@/db/repos/credit-hold-repo';
import { userRepo } from '@/db/repos/user-repo';
import { albumRepo } from '@/db/repos/album-repo';
import { ERRORS } from '@/lib/api/error-codes';
import { db } from '@/db/client';

const COST_PER_ALBUM = 10;

export const creditService = {
  cost: () => COST_PER_ALBUM,

  async precheck(userId: string): Promise<void> {
    const user = await userRepo.findById(userId);
    if (!user) throw ERRORS.UNAUTHORIZED();
    if (user.creditBalance < COST_PER_ALBUM) throw ERRORS.CREDIT_INSUFFICIENT();
  },

  async hold(tx: DB, userId: string, albumId: string): Promise<string> {
    const hold = await creditHoldRepo.create(tx, {
      userId,
      albumId,
      amount: COST_PER_ALBUM,
      status: 'HOLDING',
    });
    await albumRepo.update(tx, albumId, { creditHoldId: hold.id });
    return hold.id;
  },

  async settle(tx: DB, userId: string, holdId: string): Promise<void> {
    const hold = await creditHoldRepo.findById(holdId);
    if (!hold || hold.status !== 'HOLDING') return;
    await creditHoldRepo.update(tx, holdId, { status: 'SETTLED', settledAt: new Date() });
    await userRepo.updateCredit(tx, userId, -hold.amount);
  },

  async release(tx: DB, holdId: string): Promise<void> {
    const hold = await creditHoldRepo.findById(holdId);
    if (!hold || hold.status !== 'HOLDING') return;
    await creditHoldRepo.update(tx, holdId, { status: 'RELEASED' });
  },

  async releaseByAlbum(tx: DB, albumId: string): Promise<void> {
    const album = await albumRepo.findById(albumId);
    if (!album?.creditHoldId) return;
    await this.release(tx, album.creditHoldId);
  },
};

// Helper that wraps single-tx convenience for callers
export const creditTx = db;
