import { MAX_PHOTOS_PER_GENERATION } from '@/config/pricing';

export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number = 400,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const ERRORS = {
  UNAUTHORIZED:          () => new AppError('UNAUTHORIZED',          'Login required',              401),
  FORBIDDEN:             () => new AppError('FORBIDDEN',             'Forbidden',                   403),

  // 游客(匿名)账号的门禁:前端把这三个码统一映射成「弹登录」。
  ANON_UPGRADE_REQUIRED: () => new AppError('ANON_UPGRADE_REQUIRED', 'Sign in to continue',         403),
  ANON_ALBUM_LIMIT:      () => new AppError('ANON_ALBUM_LIMIT',      'Guest limit: one album — sign in for more', 403),
  ANON_PHOTO_LIMIT:      () => new AppError('ANON_PHOTO_LIMIT',      'Guest limit: 20 photos — sign in for up to 100', 403),

  ALBUM_NOT_FOUND:       () => new AppError('ALBUM_NOT_FOUND',       'Album not found',             404),
  ALBUM_NOT_OWNED:       () => new AppError('ALBUM_NOT_OWNED',       'Album not owned by user',     403),
  JOB_NOT_FOUND:         () => new AppError('JOB_NOT_FOUND',         'Job not found',               404),
  JOB_NOT_OWNED:         () => new AppError('JOB_NOT_OWNED',         'Job not owned by user',       403),
  PAGE_NOT_FOUND:        () => new AppError('PAGE_NOT_FOUND',        'Page not found',              404),
  USER_NOT_FOUND:        () => new AppError('USER_NOT_FOUND',        'No user with that email',     404),
  USER_EXISTS:           () => new AppError('USER_EXISTS',           'A user with that email already exists', 409),

  CREDIT_INSUFFICIENT:   () => new AppError('CREDIT_INSUFFICIENT',   'Not enough credits',          402),
  CREDIT_HOLD_FAILED:    () => new AppError('CREDIT_HOLD_FAILED',    'Failed to hold credits',      500),

  INVITE_CODE_INVALID:   () => new AppError('INVITE_CODE_INVALID',   'Invite code not found',       404),
  INVITE_CODE_EXPIRED:   () => new AppError('INVITE_CODE_EXPIRED',   'Invite code has expired',     410),
  INVITE_CODE_USED:      () => new AppError('INVITE_CODE_USED',      'You already redeemed this code', 409),
  INVITE_CODE_EXHAUSTED: () => new AppError('INVITE_CODE_EXHAUSTED', 'Invite code fully redeemed',  409),
  INVITE_CODE_EXISTS:    () => new AppError('INVITE_CODE_EXISTS',    'An invite code with that value already exists', 409),

  PHOTO_TOO_MANY:        () => new AppError('PHOTO_TOO_MANY',        `Max ${MAX_PHOTOS_PER_GENERATION} photos per album`, 400),
  PHOTO_TOO_FEW:         () => new AppError('PHOTO_TOO_FEW',         'Need at least 1 photo',       400),
  PHOTO_TOO_LARGE:       () => new AppError('PHOTO_TOO_LARGE',       'Each photo > 800KB',          413),
  PROMPT_TOO_LONG:       () => new AppError('PROMPT_TOO_LONG',       'Prompt > 500 chars',          400),
  VALIDATION_FAILED:     (m: string) => new AppError('VALIDATION_FAILED', m,                        400),
  // Share creation deliberately exposes only the number of page photos whose
  // immutable render snapshot is absent/stale. Never include photo IDs or versions.
  PHOTO_SNAPSHOT_VERSION_MISSING: (count: number) =>
    new AppError('PHOTO_SNAPSHOT_VERSION_MISSING', String(count), 409),
  // 建书直传:客户端说照片都传上去了,服务端去 R2 取却少了几张(PUT 静默失败 /
  // 预签名过期 / 客户端漏传)。同 PHOTO_SNAPSHOT_VERSION_MISSING 的口径,只报个数,
  // 不回 photoId,也不把 R2 的原始错误漏出去。409 = 客户端重传这几张就能好。
  ANALYZE_UPLOAD_INCOMPLETE: (count: number) =>
    new AppError('ANALYZE_UPLOAD_INCOMPLETE', String(count), 409),

  AGENT_TIMEOUT:         () => new AppError('AGENT_TIMEOUT',         'Agent timed out',             504),
  AGENT_VISION_FAILED:   () => new AppError('AGENT_VISION_FAILED',   'Vision API failed',           502),
  AGENT_PLANNING_FAILED: () => new AppError('AGENT_PLANNING_FAILED', 'Planning failed',             502),
  AGENT_INVALID_OUTPUT:  () => new AppError('AGENT_INVALID_OUTPUT',  'Agent output schema invalid', 502),
  AGENT_UNAUTHORIZED:    () => new AppError('AGENT_UNAUTHORIZED',    'Agent shared secret invalid', 401),
  AGENT_INTERNAL_ERROR:  () => new AppError('AGENT_INTERNAL_ERROR',  'Agent internal error',        502),
  AGENT_CHAT_FAILED:     () => new AppError('AGENT_CHAT_FAILED',     'Chat edit failed',            502),

  CHAT_BUSY:             () => new AppError('CHAT_BUSY',             'Another edit is in progress', 409),
  ALBUM_NOT_EDITABLE:    () => new AppError('ALBUM_NOT_EDITABLE',    'Album is not in editing state', 409),
  ALBUM_NOT_RETRIABLE:   () => new AppError('ALBUM_NOT_RETRIABLE',   'Album is not in a failed state', 409),

  PDF_UPLOAD_FAILED:     () => new AppError('PDF_UPLOAD_FAILED',     'PDF upload failed',           500),
  R2_SIGN_FAILED:        () => new AppError('R2_SIGN_FAILED',        'R2 presign failed',           500),
  PDF_TOO_LARGE:         () => new AppError('PDF_TOO_LARGE',         'PDF exceeds 50MB',            413),

  WEBHOOK_SIGNATURE_INVALID: () => new AppError('WEBHOOK_SIGNATURE_INVALID', 'Webhook signature invalid', 400),
  WEBHOOK_NOT_CONFIGURED:    () => new AppError('WEBHOOK_NOT_CONFIGURED',    'Webhook secret not configured', 500),
  BILLING_NOT_CONFIGURED:    () => new AppError('BILLING_NOT_CONFIGURED',    'Billing provider not configured', 503),
  // Upstream (Creem) rejected the call. Surfaces the provider's HTTP status —
  // just the number, never the raw body — so a misconfigured key/URL/product is
  // diagnosable from the client response instead of a generic 500. A 401/403 here
  // almost always means test-vs-live key/URL mismatch; a 404 means a bad base URL
  // or product id.
  // AI 生图。三类分开是因为前端处置不同:UNAVAILABLE 藏入口;
  // BLOCKED 让用户改描述(重试多少次都一样);FAILED 给「重试」按钮。
  IMAGE_GEN_UNAVAILABLE: () => new AppError('IMAGE_GEN_UNAVAILABLE', 'Image generation is not configured', 501),
  IMAGE_GEN_BLOCKED:     () => new AppError('IMAGE_GEN_BLOCKED',     'That description was rejected — try describing it differently', 422),
  IMAGE_GEN_FAILED:      () => new AppError('IMAGE_GEN_FAILED',      'Image generation failed, please try again', 502),

  BILLING_UPSTREAM_ERROR: (status: number) =>
    new AppError('BILLING_UPSTREAM_ERROR', `Checkout provider returned ${status}`, 502),

  RATE_LIMITED:          () => new AppError('RATE_LIMITED',          'Too many requests',           429),
  INTERNAL_ERROR:        () => new AppError('INTERNAL_ERROR',        'Internal server error',       500),
} as const;

// Agent → Web error-code alignment (rebuild-tech-plan §1.6, fix P2-8). The agent
// emits the contract.md §9 namespace (e.g. AGENT_OUTPUT_VALIDATION); Web persists
// the error-codes.ts namespace. Map at the inbound callback boundary so a single
// canonical code lands in agent_jobs.error / albums.error_message. Codes already
// shared by both sides (AGENT_VISION_FAILED, AGENT_PLANNING_FAILED, AGENT_TIMEOUT,
// AGENT_CHAT_FAILED) pass through unchanged. No ALBUM_BUSY is introduced — v2
// concurrency / non-EDITING conflicts reuse ALBUM_NOT_EDITABLE (decided locally
// in generationService, not in this map).
const AGENT_ERROR_CODE_MAP: Record<string, string> = {
  AGENT_OUTPUT_VALIDATION: 'AGENT_INVALID_OUTPUT',
};

export function mapAgentErrorCode(code: string): string {
  return AGENT_ERROR_CODE_MAP[code] ?? code;
}
