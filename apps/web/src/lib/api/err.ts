export function err(code: string, message: string, status: number, details?: unknown): Response {
  // details 仅在非 undefined 时出现(collab plan §7):保证存量错误响应 JSON
  // 逐字节不变(不多个 "details":undefined 键),只有显式携带 details 的错误
  // (409 EDIT_CONFLICT)才多这个字段。
  return Response.json(
    details === undefined
      ? { ok: false, error: { code, message } }
      : { ok: false, error: { code, message, details } },
    { status },
  );
}
