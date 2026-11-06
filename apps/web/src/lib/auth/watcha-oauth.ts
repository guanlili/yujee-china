import type { GenericOAuthConfig } from 'better-auth/plugins/generic-oauth';
import { logger } from '@/lib/log/logger';
import { env } from '@/lib/env';

// ─── 观猹统一登录(watcha.cn OAuth2.0,2026-11)────────────────────────────────
// 观猹的 OAuth 技术文档不公开(商务通道申请:support@watcha.cn / 微信
// yunyingxiaowanzi),所以这里按「骨架先行」设计:
// - 端点 URL + 密钥全部走 WATCHA_OAUTH_* 环境变量,五件套配齐才挂载(与 Apple
//   四件套同款门控),拿到资料后填 env 即上线,代码不用再动;
// - 观猹 userinfo 的字段名未知,映射做成矩阵式兼容(openid/sub/id、nickname/
//   name、avatar/picture),拿到真实文档后再按需收紧;
// - better-auth 1.7.12 的 genericOAuth 插件把提供方注册成一等 social provider,
//   走标准 signIn.social + /api/auth/callback/watcha,匿名游客并号由 anonymous
//   插件的 onLinkAccount 自动覆盖,无需额外接线。
//
// 占位邮箱:users.email notNull,观猹档案若不含邮箱,合成
// watcha_{accountId}@watcha.yujee.local —— 镜像手机号的 {号码}@phone.yujee.local
// 做法(better-auth.ts 的 PHONE_PLACEHOLDER_DOMAIN):这类账号永远不收邮件,
// emailVerified 置 true,不被邮箱验证墙拦,也不会与真实邮箱撞车。

export const WATCHA_PROVIDER_ID = 'watcha';
export const WATCHA_PLACEHOLDER_EMAIL_DOMAIN = 'watcha.yujee.local';

/** better-auth 传给 getUserInfo 的 tokens 形状(结构兼容 OAuth2Tokens,只取所需;
 *  accessToken 在 OAuth2Tokens 里可空 —— 无 access token 就拉不了 userinfo)。 */
type WatchaTokens = { accessToken?: string | undefined };

/** 归一后的观猹档案:返回形状即 GenericOAuthUserInfo 的标准字段契约。 */
export type NormalizedWatchaProfile = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string;
};

/** 依序取第一个非空字符串值(数字也收,转字符串)。 */
function pickString(raw: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

/**
 * 观猹档案归一(纯函数,测试钉矩阵):字段名未知时代的宽容映射。
 * 拿不到稳定主体标识(id/openid/sub/userId/uid 全缺)返回 null —— 拿不到
 * accountId 就无法落 accounts 行,宁可不登录也不能编一个。
 */
export function normalizeWatchaProfile(raw: Record<string, unknown>): NormalizedWatchaProfile | null {
  const id = pickString(raw, ['id', 'openid', 'sub', 'userId', 'uid']);
  if (!id) return null;

  // 邮箱:真实邮箱才算(简单形状校验,不追求 RFC 全集);否则占位。
  const rawEmail = pickString(raw, ['email']);
  const email = rawEmail && rawEmail.includes('@') ? rawEmail : `watcha_${id}@${WATCHA_PLACEHOLDER_EMAIL_DOMAIN}`;
  const hasRealEmail = email === rawEmail;
  // 占位邮箱 verified=true(与手机占位同款,不收邮件也不该被验证墙拦);
  // 真实邮箱只信提供方的 email_verified 显式真值(布尔或 'true' 字符串)。
  const emailVerified = hasRealEmail ? raw.email_verified === true || raw.email_verified === 'true' : true;

  return {
    id,
    name: pickString(raw, ['name', 'nickname', 'username', 'displayName']) ?? `观猹用户${id.slice(-4)}`,
    email,
    // email_verified 收布尔真或字符串 'true'(urlencoded 解析路径全是字符串)。
    emailVerified: emailVerified || raw.email_verified === 'true',
    image: pickString(raw, ['avatar', 'picture', 'avatar_url', 'headimgurl']),
  };
}

/** scope 解析:空格或逗号分隔;没配返回空数组(按对方文档填,如 "openid profile")。 */
export function parseWatchaScopes(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(/[\s,]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

/** getWatchaOAuthConfig 的可注入 env 切片(生产默认真 env,测试显式传参)。 */
export type WatchaOAuthEnvSource = Pick<
  typeof env,
  | 'WATCHA_OAUTH_CLIENT_ID'
  | 'WATCHA_OAUTH_CLIENT_SECRET'
  | 'WATCHA_OAUTH_AUTHORIZATION_URL'
  | 'WATCHA_OAUTH_TOKEN_URL'
  | 'WATCHA_OAUTH_USER_INFO_URL'
  | 'WATCHA_OAUTH_SCOPES'
  | 'WEB_BASE_URL'
>;

/**
 * 五件套齐才返回观猹 provider 配置,否则 null(登录页无按钮、插件不挂载)。
 * redirectURI 显式钉死 ${WEB_BASE_URL}/api/auth/callback/watcha —— 这是
 * better-auth 标准 social 回调路径,也是要在观猹侧注册的回调地址,不赌库内默认值。
 */
export function getWatchaOAuthConfig(source: WatchaOAuthEnvSource = env): GenericOAuthConfig<typeof WATCHA_PROVIDER_ID> | null {
  const {
    WATCHA_OAUTH_CLIENT_ID: clientId,
    WATCHA_OAUTH_CLIENT_SECRET: clientSecret,
    WATCHA_OAUTH_AUTHORIZATION_URL: authorizationUrl,
    WATCHA_OAUTH_TOKEN_URL: tokenUrl,
    WATCHA_OAUTH_USER_INFO_URL: userInfoUrl,
    WATCHA_OAUTH_SCOPES: scopesRaw,
    WEB_BASE_URL: webBaseUrl,
  } = source;

  if (!clientId?.trim() || !clientSecret?.trim() || !authorizationUrl || !tokenUrl || !userInfoUrl) {
    return null;
  }

  return {
    providerId: WATCHA_PROVIDER_ID,
    name: '观猹',
    clientId: clientId.trim(),
    clientSecret: clientSecret.trim(),
    authorizationUrl,
    tokenUrl,
    userInfoUrl,
    scopes: parseWatchaScopes(scopesRaw),
    redirectURI: `${webBaseUrl.replace(/\/+$/, '')}/api/auth/callback/${WATCHA_PROVIDER_ID}`,
    // 自定义 userinfo 拉取+归一:默认实现假定 id/email 字段名且允许 email 缺失
    //(我们的 users.email notNull 不允许),这里一处收口宽容映射。
    getUserInfo: async (tokens: WatchaTokens): Promise<NormalizedWatchaProfile | null> => {
      if (!tokens.accessToken) {
        logger.error({}, 'watcha oauth: no access token to fetch userinfo');
        return null;
      }
      let response: Response;
      try {
        response = await fetch(userInfoUrl, {
          headers: { Authorization: `Bearer ${tokens.accessToken}`, Accept: 'application/json' },
        });
      } catch (error) {
        logger.error({ error }, 'watcha oauth: userinfo fetch failed');
        return null;
      }
      if (!response.ok) {
        logger.error({ status: response.status }, 'watcha oauth: userinfo endpoint returned error status');
        return null;
      }
      const text = await response.text();
      let raw: Record<string, unknown>;
      try {
        raw = JSON.parse(text) as Record<string, unknown>;
      } catch {
        // 少数 provider 回 urlencoded;解析失败按无档案处理。
        try {
          raw = Object.fromEntries(new URLSearchParams(text));
        } catch {
          logger.error({ body: text.slice(0, 200) }, 'watcha oauth: userinfo body unparseable');
          return null;
        }
      }
      return normalizeWatchaProfile(raw);
    },
  };
}
