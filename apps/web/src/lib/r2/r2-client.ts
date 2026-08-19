import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '@/lib/env';
import { ERRORS } from '@/lib/api/error-codes';
import { logger } from '@/lib/log/logger';

// Cloudflare R2 is S3-compatible. The server only ever hands out presigned URLs
// (PUT for direct browser uploads, GET for private reads like photo-originals) —
// the Web tier never proxies the actual bytes either direction.
let _client: S3Client | null = null;
function client(): S3Client {
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    throw ERRORS.R2_SIGN_FAILED();
  }
  if (!_client) {
    _client = new S3Client({
      region: 'auto',
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      },
      // AWS SDK v3 (>=3.729) defaults to WHEN_SUPPORTED, which bakes an
      // x-amz-checksum-crc32 of the (empty, at sign time) body into presigned
      // PUT URLs. The browser then uploads a real body → checksum mismatch →
      // R2 rejects the PUT (cover-thumbnail + PDF direct uploads both broke).
      // WHEN_REQUIRED keeps checksums off unless an operation needs them, so
      // presigned PUTs sign cleanly. See r2-presign.test.ts.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }
  return _client;
}

export const r2 = {
  bucket: () => env.R2_BUCKET,

  publicUrl: (key: string): string =>
    `${env.R2_PUBLIC_BASE_URL.replace(/\/+$/, '')}/${key}`,

  async signPutUrl(
    key: string,
    contentType: string,
    expiresInSeconds = 300,
  ): Promise<string> {
    try {
      const cmd = new PutObjectCommand({
        Bucket: env.R2_BUCKET,
        Key: key,
        ContentType: contentType,
      });
      return await getSignedUrl(client(), cmd, { expiresIn: expiresInSeconds });
    } catch {
      throw ERRORS.R2_SIGN_FAILED();
    }
  },

  async signGetUrl(key: string, expiresInSeconds = 300): Promise<string> {
    try {
      const command = new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: key });
      return await getSignedUrl(client(), command, { expiresIn: expiresInSeconds });
    } catch {
      throw ERRORS.R2_SIGN_FAILED();
    }
  },

  // 服务端直接写字节。**这是「不代理字节」那条立场的唯一破例**,只给 AI 生图用:
  // 生成图的字节天生在服务端(上游回给我们的),让浏览器绕一趟意味着海外用户要去
  // 下载国内 TOS 的图,不可行。用户上传的照片仍然一律走预签名 PUT,不许走这里。
  // 设计依据:docs/specs/2026-08-18-ai-image-generation-design.md「实现触点」。
  async putObject(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    try {
      await client().send(
        new PutObjectCommand({
          Bucket: env.R2_BUCKET,
          Key: key,
          Body: bytes,
          ContentType: contentType,
        }),
      );
    } catch (e) {
      logger.error({ err: String(e), key }, 'r2 putObject failed');
      throw e;
    }
  },

  // 唯一一处服务端真的把字节读回来的地方(建书直传:浏览器 PUT 完 800px 预览,
  // Web 取回来拼成 base64 转发给 engine)。其余链路一律只发预签名 URL,不代理字节。
  //
  // 只有「对象不存在」返回 null(调用方按「这张没传上来」处理);其余一律抛。
  // 早先这里 catch-all 返回 null,后果是 R2 挂了/凭证轮换/503 限流都会被翻译成
  // 「请重新上传照片」—— 用户重传多少次都一样失败,而服务端一条日志都没有。
  async getObject(key: string): Promise<Uint8Array | null> {
    try {
      const out = await client().send(
        new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: key }),
      );
      if (!out.Body) return null;
      return await out.Body.transformToByteArray();
    } catch (e) {
      if (isNotFound(e)) return null;
      logger.error({ err: String(e), key }, 'r2 getObject failed');
      throw e;
    }
  },
};

// S3/R2 的「不存在」有好几种形态:SDK 的 NoSuchKey/NotFound 异常名,以及
// HEAD 语义下只有 404 状态码的响应。其余(403/503/网络)都不是「不存在」。
export function isNotFound(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const name = (e as { name?: unknown }).name;
  if (name === 'NoSuchKey' || name === 'NotFound') return true;
  const status = (e as { $metadata?: { httpStatusCode?: unknown } }).$metadata?.httpStatusCode;
  return status === 404;
}
