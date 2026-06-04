import { userRepo } from '@/db/repos/user-repo';
import { planLabel, subscriptionService } from '@/services/billing/subscription-service';
import { ERRORS } from '@/lib/api/error-codes';

export const userService = {
  async getMe(userId: string) {
    const user = await userRepo.findById(userId);
    if (!user) throw ERRORS.UNAUTHORIZED();
    const subscription = await subscriptionService.getCurrent(userId);
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
      isAdmin: user.isAdmin,
      creditBalance: user.creditBalance,
      createdAt: user.createdAt,
      plan: {
        id: subscription?.planId ?? 'free',
        label: planLabel(subscription?.planId as any),
        cycle: subscription?.billingCycle ?? null,
        currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
      },
    };
  },
};
