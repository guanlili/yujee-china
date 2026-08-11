import type { AT } from '@/lib/i18n/pick';

type ApiErrorLike = {
  code?: unknown;
  message?: unknown;
} | null | undefined;

export function photoSnapshotVersionMissingHint(
  error: ApiErrorLike,
  aT: AT,
): string | null {
  if (
    error?.code !== 'PHOTO_SNAPSHOT_VERSION_MISSING'
    || typeof error.message !== 'string'
    || !/^[1-9]\d*$/.test(error.message)
  ) {
    return null;
  }
  const count = Number(error.message);
  if (!Number.isSafeInteger(count)) return null;
  return aT(
    `还有 ${count} 张照片需要按当前风格重新备份`,
    count === 1
      ? '1 photo still needs to be backed up using the current style'
      : `${count} photos still need to be backed up using the current style`,
  );
}
