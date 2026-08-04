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
      // 游客(匿名影子账号):前端据此把用户菜单换成「登录」CTA、关掉自动上云。
      isAnonymous: user.isAnonymous,
      creditBalance: user.creditBalance,
      createdAt: user.createdAt,
    };
  },
};
