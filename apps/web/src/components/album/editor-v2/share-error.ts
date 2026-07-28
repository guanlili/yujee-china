type ApiErrorLike = {
  code?: unknown;
  message?: unknown;
} | null | undefined;

export function photoSnapshotVersionMissingHint(
  error: ApiErrorLike,
  zh: boolean,
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
  if (zh) return `还有 ${count} 张照片需要按当前风格重新备份`;
  return count === 1
    ? '1 photo still needs to be backed up using the current style'
    : `${count} photos still need to be backed up using the current style`;
}
