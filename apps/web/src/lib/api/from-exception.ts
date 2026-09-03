import { ZodError } from 'zod';
import { AppError } from './error-codes';
import { err } from './err';
import { logger } from '@/lib/log/logger';

export function fromException(e: unknown): Response {
  if (e instanceof AppError) {
    return err(e.code, e.message, e.status, e.details);
  }
  if (e instanceof ZodError) {
    return err('VALIDATION_FAILED', e.issues.map((i) => i.message).join('; '), 400);
  }
  logger.error({ err: e instanceof Error ? { message: e.message, stack: e.stack } : e }, 'unhandled exception');
  return err('INTERNAL_ERROR', 'Internal server error', 500);
}
