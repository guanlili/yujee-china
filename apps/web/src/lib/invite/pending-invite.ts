// 注册时填的邀请码没法当场兑换:邮箱注册要先验证邮箱才有会话,而兑换接口要登录。
// 所以把码暂存本地,等用户验证/登录、首次进 app 时由 PendingInviteRedeemer 自动兑换。
// 社交登录(Google/Apple)即时有会话,进 app 也走同一条自动兑换。
const PENDING_INVITE_KEY = 'yujee.pendingInviteCode';

export function stashPendingInvite(rawCode: string): void {
  const code = rawCode.trim();
  if (!code) return;
  try {
    localStorage.setItem(PENDING_INVITE_KEY, code);
  } catch {
    // 隐私模式/存储禁用:静默放弃,不阻断注册。
  }
}

export function takePendingInvite(): string | null {
  try {
    return localStorage.getItem(PENDING_INVITE_KEY);
  } catch {
    return null;
  }
}

export function clearPendingInvite(): void {
  try {
    localStorage.removeItem(PENDING_INVITE_KEY);
  } catch {
    // 忽略:清不掉也只是下次再尝试兑换,兑换接口本身对已兑过的码是幂等拒绝。
  }
}
