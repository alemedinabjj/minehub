import { Injectable, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { Errors } from '../errors/domain-error.js';

/**
 * Validates input against the shared zod contracts (@hubmine/shared), so the web client and
 * the API use the exact same rules. Unknown keys are rejected (strict), not silently dropped.
 * Error details expose field paths and codes, never the submitted values.
 */
@Injectable()
export class ZodPipe<S extends z.ZodObject> implements PipeTransform<unknown, z.infer<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.infer<S> {
    const result = this.schema.strict().safeParse(value);
    if (result.success) return result.data as z.infer<S>;
    throw Errors.validation(result.error.issues.map((i) => ({ field: i.path.join('.'), code: i.message })));
  }
}
