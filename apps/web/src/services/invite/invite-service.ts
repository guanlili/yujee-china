import { eq, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { inviteCodes, inviteRedemptions } from '@/db/schema';
import { creditService } from '@/services/credit/credit-service';
import { ERRORS } from '@/lib/api/error-codes';
import { logger } from '@/lib/log/logger';

// 邀请码兑换:共享码,每个用户对每个码只能兑一次(uq_invite_redemptions_code_user 硬闸)。
// 过期 / 停用 / 超总量上限一律拒绝。加分走 creditService.applyDelta(唯一 balance 变更入口)。
export const inviteService = {
  // 用户输入规整:去空白 + 大写(种子码全大写)。控制长度,避免异常输入。
  normalizeCode(input: string): string {
    return input.trim().toUpperCase().slice(0, 64);
  },

  async redeem(userId: string, input: string): Promise<{ credits: number; balance: number }> {
    const code = this.normalizeCode(input);
    if (!code) throw ERRORS.INVITE_CODE_INVALID();

    const result = await db.transaction(async (tx) => {
      // 锁住码行(FOR UPDATE):并发兑同一码时串行化 redeemed_count 与总量上限判断。
      const rows = await tx
        .select()
        .from(inviteCodes)
        .where(eq(inviteCodes.code, code))
        .limit(1)
        .for('update');
      const row = rows[0];
      if (!row || !row.active) throw ERRORS.INVITE_CODE_INVALID();
      if (row.expiresAt.getTime() <= Date.now()) throw ERRORS.INVITE_CODE_EXPIRED();
      if (row.maxRedemptions != null && row.redeemedCount >= row.maxRedemptions) {
        throw ERRORS.INVITE_CODE_EXHAUSTED();
      }

      // 每人限一次:onConflictDoNothing + returning 判断——冲突(已兑过)返回空,不会中止事务。
      const inserted = await tx
        .insert(inviteRedemptions)
        .values({ codeId: row.id, userId })
        .onConflictDoNothing({ target: [inviteRedemptions.codeId, inviteRedemptions.userId] })
        .returning({ id: inviteRedemptions.id });
      if (inserted.length === 0) throw ERRORS.INVITE_CODE_USED();

      await tx
        .update(inviteCodes)
        .set({ redeemedCount: sql`${inviteCodes.redeemedCount} + 1` })
        .where(eq(inviteCodes.id, row.id));

      const ledger = await creditService.applyDelta(tx, userId, row.credits, 'INVITE_REDEEM', {
        meta: { code },
      });
      return { credits: row.credits, balance: ledger.balanceAfter };
    });

    logger.info({ action: 'invite.redeem', userId, code, credits: result.credits }, 'invite code redeemed');
    return result;
  },
};
