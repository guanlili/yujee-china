import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '@/lib/env';
import { ERRORS } from '@/lib/api/error-codes';

// Cloudflare R2 is S3-compatible. We only ever sign PUTs from server →
// browser uploads direct, so the Web tier never proxies PDF bytes.
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
};
