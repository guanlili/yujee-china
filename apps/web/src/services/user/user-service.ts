import { userRepo } from '@/db/repos/user-repo';
import { ERRORS } from '@/lib/api/error-codes';

export const userService = {
  async getMe(userId: string) {
    const user = await userRepo.findById(userId);
    if (!user) throw ERRORS.UNAUTHORIZED();
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
      isAdmin: user.isAdmin,
      creditBalance: user.creditBalance,
      createdAt: user.createdAt,
      plan: {
        id: 'free' as const,
        label: 'Free',
        cycle: null,
        currentPeriodEnd: null,
      },
    };
  },
};
