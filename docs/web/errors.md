# Web 错误处理

> **前置阅读**: `CLAUDE.md` → `docs/architecture.md` → `docs/web/layering.md` → `docs/web/conventions.md`
>
> 谁读这份: 写 route 或 service 的人。

---

## 1. AppError 定义

```ts
// lib/api/error-codes.ts
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number = 400
  ) {
    super(message);
    this.name = 'AppError';
  }
}
```

---

## 2. 错误码集中表(权威)

```ts
// lib/api/error-codes.ts(与代码逐字段对齐)
export const ERRORS = {
  // 鉴权 / 授权
  UNAUTHORIZED:          () => new AppError('UNAUTHORIZED',          'Login required',              401),
  FORBIDDEN:             () => new AppError('FORBIDDEN',             'Forbidden',                   403),

  // 资源 / 归属
  ALBUM_NOT_FOUND:       () => new AppError('ALBUM_NOT_FOUND',       'Album not found',             404),
  ALBUM_NOT_OWNED:       () => new AppError('ALBUM_NOT_OWNED',       'Album not owned by user',     403),
  JOB_NOT_FOUND:         () => new AppError('JOB_NOT_FOUND',         'Job not found',               404),
  JOB_NOT_OWNED:         () => new AppError('JOB_NOT_OWNED',         'Job not owned by user',       403),
  PAGE_NOT_FOUND:        () => new AppError('PAGE_NOT_FOUND',        'Page not found',              404),

  // 积分
  CREDIT_INSUFFICIENT:   () => new AppError('CREDIT_INSUFFICIENT',   'Not enough credits',          402),
  CREDIT_HOLD_FAILED:    () => new AppError('CREDIT_HOLD_FAILED',    'Failed to hold credits',      500),

  // 输入校验
  PHOTO_TOO_MANY:        () => new AppError('PHOTO_TOO_MANY',        'Max 30 photos per album',     400),
  PHOTO_TOO_FEW:         () => new AppError('PHOTO_TOO_FEW',         'Need at least 1 photo',       400),
  PHOTO_TOO_LARGE:       () => new AppError('PHOTO_TOO_LARGE',       'Each photo > 800KB',          413),
  PROMPT_TOO_LONG:       () => new AppError('PROMPT_TOO_LONG',       'Prompt > 500 chars',          400),
  VALIDATION_FAILED:     (m: string) => new AppError('VALIDATION_FAILED', m,                        400),

  // Agent / 外部
  AGENT_TIMEOUT:         () => new AppError('AGENT_TIMEOUT',         'Agent timed out',             504),
  AGENT_VISION_FAILED:   () => new AppError('AGENT_VISION_FAILED',   'Vision API failed',           502),
  AGENT_PLANNING_FAILED: () => new AppError('AGENT_PLANNING_FAILED', 'Planning failed',             502),
  AGENT_INVALID_OUTPUT:  () => new AppError('AGENT_INVALID_OUTPUT',  'Agent output schema invalid', 502),
  AGENT_UNAUTHORIZED:    () => new AppError('AGENT_UNAUTHORIZED',    'Agent shared secret invalid', 401),
  AGENT_INTERNAL_ERROR:  () => new AppError('AGENT_INTERNAL_ERROR',  'Agent internal error',        502),
  AGENT_CHAT_FAILED:     () => new AppError('AGENT_CHAT_FAILED',     'Chat edit failed',            502),

  // 编辑期状态机(章节故事 chat / 重试)
  CHAT_BUSY:             () => new AppError('CHAT_BUSY',             'Another edit is in progress', 409),
  ALBUM_NOT_EDITABLE:    () => new AppError('ALBUM_NOT_EDITABLE',    'Album is not in editing state', 409),
  ALBUM_NOT_RETRIABLE:   () => new AppError('ALBUM_NOT_RETRIABLE',   'Album is not in a failed state', 409),

  // PDF / 上传
  PDF_UPLOAD_FAILED:     () => new AppError('PDF_UPLOAD_FAILED',     'PDF upload failed',           500),
  R2_SIGN_FAILED:        () => new AppError('R2_SIGN_FAILED',        'R2 presign failed',           500),
  PDF_TOO_LARGE:         () => new AppError('PDF_TOO_LARGE',         'PDF exceeds 50MB',            413),

  // 支付 / webhook
  WEBHOOK_SIGNATURE_INVALID: () => new AppError('WEBHOOK_SIGNATURE_INVALID', 'Webhook signature invalid',     400),
  WEBHOOK_NOT_CONFIGURED:    () => new AppError('WEBHOOK_NOT_CONFIGURED',    'Webhook secret not configured', 500),
  BILLING_NOT_CONFIGURED:    () => new AppError('BILLING_NOT_CONFIGURED',    'Billing provider not configured', 503),

  // 限流 / 其他
  RATE_LIMITED:          () => new AppError('RATE_LIMITED',          'Too many requests',           429),
  INTERNAL_ERROR:        () => new AppError('INTERNAL_ERROR',        'Internal server error',       500),
} as const;
```

> 这是 `error-codes.ts` 的**完整**表(非摘要)。新增错误码先加进这张表再用。

**新增错误码的规则**:
- 不在表里就**先加进表**,再用。绝不直接 `throw new AppError('XXX', ...)`。
- 一个业务概念一个 code,不要复用("UNAUTHORIZED" 不能拿来做"forbidden")。
- HTTP status 严格按语义(401 鉴权失败 / 403 鉴权成功但无权 / 404 资源不存在 / 402 缺钱 / 409 状态冲突 / 413 太大 / 429 太频 / 5xx 服务端)。

---

## 2a. Agent → Web 错误码映射

Agent 用自己命名空间的错误码(`docs/agent/contract.md §9`),Web 持久化的是上面 `error-codes.ts` 的命名空间。在入站 callback 边界做一次映射,保证落 `agent_jobs.error` / `albums.error_message` 的是单一规范 code。

```ts
// lib/api/error-codes.ts
const AGENT_ERROR_CODE_MAP: Record<string, string> = {
  AGENT_OUTPUT_VALIDATION: 'AGENT_INVALID_OUTPUT',
};
export function mapAgentErrorCode(code: string): string {
  return AGENT_ERROR_CODE_MAP[code] ?? code;
}
```

- 同步端点的 output validation 错误:Agent 返回 `422 + AGENT_OUTPUT_VALIDATION`,Web client 映射成 `AGENT_INVALID_OUTPUT`(502)。
- 两侧已共用的码(`AGENT_VISION_FAILED` / `AGENT_PLANNING_FAILED` / `AGENT_TIMEOUT` / `AGENT_CHAT_FAILED`)原样透传,不进映射表。

---

## 3. 抛错的位置

**Service 抛**,Route 不抛。

```ts
// services/album/album-service.ts
async findOwned(userId: string, albumId: string) {
  const album = await albumRepo.findById(albumId);
  if (!album) throw ERRORS.ALBUM_NOT_FOUND();
  if (album.userId !== userId) throw ERRORS.ALBUM_NOT_OWNED();
  return album;
}
```

Route 只做 `try/catch`,把异常交给 `fromException(e)` 转响应:

```ts
// Next.js 15: params 是 Promise,await 后取段
export async function GET(req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  try {
    const user = await requireAuth(req);
    const { uuid } = await ctx.params;
    const album = await albumService.findOwned(user.id, uuid);
    return ok(album);
  } catch (e) {
    return fromException(e);
  }
}
```

---

## 4. `fromException` 实现

```ts
// lib/api/from-exception.ts
import { ZodError } from 'zod';
import { AppError } from './error-codes';
import { err } from './err';
import { logger } from '@/lib/log/logger';

export function fromException(e: unknown): Response {
  if (e instanceof AppError) {
    return err(e.code, e.message, e.status);
  }
  if (e instanceof ZodError) {
    return err('VALIDATION_FAILED', e.issues.map((i) => i.message).join('; '), 400);
  }
  // 未知异常: 必须打日志(带 stack),响应统一 500
  logger.error({ err: e instanceof Error ? { message: e.message, stack: e.stack } : e }, 'unhandled exception');
  return err('INTERNAL_ERROR', 'Internal server error', 500);
}
```

---

## 5. 响应辅助函数

```ts
// lib/api/ok.ts
export function ok<T>(data: T): Response {
  return Response.json({ ok: true, data });
}

// lib/api/err.ts
export function err(code: string, message: string, status: number): Response {
  return Response.json({ ok: false, error: { code, message } }, { status });
}
```

---

## 6. 客户端如何消费错误

```ts
const res = await fetch('/api/v1/albums/xxx'); // 或 /api/v3/albums/xxx/...
const json = await res.json();
if (!json.ok) {
  // json.error = { code: 'ALBUM_NOT_OWNED', message: '...' }
  toast.error(getI18nMessage(json.error.code));
}
```

**前端不要硬编码错误码**,统一走 i18n:`messages/en.json` 里 `errors.ALBUM_NOT_OWNED = "..."`。

---

## 7. 日志策略

- AppError(已知错误)**不打 error 日志**,只在 service 层适当地打 info(如"album.create").
- 未知异常 → `logger.error({ err })` 必须打,带 stack。
- 永远不要 `console.log`(生产环境会污染)。

---

## 8. 自查

- [ ] 我新加的错误码在 ERRORS 表里吗?
- [ ] HTTP status 选对了吗?(401 vs 403 vs 404 vs 402)
- [ ] Service 是不是用 `throw ERRORS.XXX()` 抛?
- [ ] Route 是不是统一 `fromException(e)`?
- [ ] 未知异常打了 error 日志吗?
- [ ] 前端是用 code 映射 i18n,不是硬编码英文?
