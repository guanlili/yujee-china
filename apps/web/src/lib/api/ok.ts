export function ok<T>(data: T): Response {
  return Response.json({ ok: true, data });
}
