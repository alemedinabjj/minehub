import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { IDEMPOTENCY_KEY_RE } from '@hubmine/shared';
import type { Request } from 'express';
import { Errors } from '../errors/domain-error.js';

/** Optional `Idempotency-Key` header: absent → undefined, malformed → 400. */
export function parseIdempotencyKey(value: unknown): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || !IDEMPOTENCY_KEY_RE.test(value)) throw Errors.invalidIdempotencyKey();
  return value;
}

/** `@Headers()` takes no pipes in Nest 12, so the header is read and validated here. */
export const IdempotencyKey = createParamDecorator((_: unknown, ctx: ExecutionContext) =>
  parseIdempotencyKey(ctx.switchToHttp().getRequest<Request>().headers['idempotency-key']),
);
