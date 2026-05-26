import { z, type ZodSchema } from 'zod';
import { ERRORS } from './error-codes';

export async function parseBody<T>(schema: ZodSchema<T>, req: Request): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw ERRORS.VALIDATION_FAILED('invalid json body');
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw ERRORS.VALIDATION_FAILED(result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  }
  return result.data;
}
