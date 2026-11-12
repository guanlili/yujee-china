'use client';

// 手动照片备份(photo-snapshot-design.md)的浏览器侧封装:签名 → 直传 R2 → confirm。
// 原图不上传;上传的是 display 档压缩图(photoStore.getTierBlob)。mirror PDF/封面直传。

import type { SnapshotEntry } from '@/services/album/photo-snapshot-util';
import { UnauthorizedError } from '@/lib/generation/client';

export type { SnapshotEntry };

export type SignedSnapshotUpload = SnapshotEntry & {
  putUrl: string;
  r2Key: string;
  publicUrl: string;
};

export type ConfirmedPhotoSnapshot = {
  photoIds: string[];
  renderVersions: Record<string, string>;
};

// ── 超时(2026-11-10)──────────────────────────────────────────
// 浏览器 fetch 没有默认超时:TCP 连上了但链路/服务端不回应时,它会一直挂着不
// 报错。上传链路是 4 个并发 worker + Promise.all(见 lib/generation/client.ts
// backupGenerationPreviews),只要有一张 PUT 卡住,整轮永不 settle —— 用户看到的
// 是"保存中"一直转,重进重出才恢复。这就是"上传偶发挂住"的根因:不是失败,
// 是永不结束的 Promise。
// 这里给每个请求加硬超时,并且**不依赖 fetch 是否尊重 signal**(实测中挂住的
// 请求常常连 abort 都没反应),超时用独立 timer 直接 reject;signal 仍然传下去,
// 让真实 fetch 有机会取消网络请求。
export class RequestTimeoutError extends Error {
  readonly code = 'REQUEST_TIMEOUT';
  readonly timeoutMs: number;
  constructor(timeoutMs: number) {
    super(`request timed out after ${timeoutMs}ms`);
    this.name = 'RequestTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

const SIGN_TIMEOUT_MS = 20_000;
const PUT_TIMEOUT_MS = 45_000;

function withDeadline<T>(run: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      reject(new RequestTimeoutError(ms));
    }, ms);
    run(controller.signal).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function postJson(url: string, body: unknown): Promise<unknown> {
  const res = await withDeadline(
    (signal) =>
      fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      }),
    SIGN_TIMEOUT_MS,
  );
  const json = (await res.json().catch(() => null)) as { ok?: boolean; data?: unknown; error?: { code?: string; message?: string } } | null;
  if (!res.ok || !json?.ok) {
    // 会话过期/游客碰真实账号专属能力:类型化抛出,调用方(保存/分享)引导去登录,
    // 不再糊一个含混的 request failed。
    if (res.status === 401 || json?.error?.code === 'UNAUTHORIZED' || json?.error?.code === 'ANON_UPGRADE_REQUIRED') {
      throw new UnauthorizedError();
    }
    throw new Error(json?.error?.message ?? `request failed (${res.status})`);
  }
  return json.data;
}

export function signPhotoSnapshotUpload(
  albumId: string,
  entries: SnapshotEntry[],
): Promise<SignedSnapshotUpload[]> {
  return postJson(`/api/v1/albums/${albumId}/photo-snapshot-upload-url`, { entries }) as Promise<
    SignedSnapshotUpload[]
  >;
}

export function confirmPhotoSnapshot(
  albumId: string,
  entries: SnapshotEntry[],
): Promise<ConfirmedPhotoSnapshot> {
  return postJson(`/api/v1/albums/${albumId}/photo-snapshot`, { entries }) as Promise<
    ConfirmedPhotoSnapshot
  >;
}

// 直传一张压缩图到 R2 的签名 PUT。content-type 必须与签名时一致(image/jpeg)。
// 失败重试一次:同 key 覆盖写是幂等的,而签名有效期 5 分钟(album-service 里
// signPutUrl(..., 300)),单张 45s + 重试一次仍在窗口内。重试的意义在于单次
// 抖动(移动网络切换、COS 侧瞬时 5xx)不必让用户重来整轮。
export async function putSnapshotBlob(
  putUrl: string,
  blob: Blob,
  opts?: { timeoutMs?: number; retries?: number },
): Promise<void> {
  const timeoutMs = opts?.timeoutMs ?? PUT_TIMEOUT_MS;
  const attempts = Math.max(1, (opts?.retries ?? 1) + 1);
  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const res = await withDeadline(
        (signal) =>
          fetch(putUrl, {
            method: 'PUT',
            headers: { 'content-type': 'image/jpeg' },
            body: blob,
            signal,
          }),
        timeoutMs,
      );
      if (res.ok) return;
      // 4xx 是签名过期/参数错误,重试无意义;5xx 与网络错误才值得再来一次。
      if (res.status >= 400 && res.status < 500) throw new Error(`snapshot PUT failed (${res.status})`);
      lastError = new Error(`snapshot PUT failed (${res.status})`);
    } catch (error) {
      if (error instanceof Error && /snapshot PUT failed \(4\d\d\)/.test(error.message)) throw error;
      lastError = error;
    }
    if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw lastError instanceof Error ? lastError : new Error('snapshot PUT failed');
}
