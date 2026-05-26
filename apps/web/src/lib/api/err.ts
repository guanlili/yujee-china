export function err(code: string, message: string, status: number): Response {
  return Response.json({ ok: false, error: { code, message } }, { status });
}
