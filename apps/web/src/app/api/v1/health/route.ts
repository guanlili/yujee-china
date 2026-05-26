import { ok } from '@/lib/api/ok';

export async function GET() {
  return ok({ ok: true, time: new Date().toISOString() });
}
