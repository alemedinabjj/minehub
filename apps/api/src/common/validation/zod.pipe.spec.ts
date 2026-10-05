import { registerRequestSchema } from '@hubmine/shared';
import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors/domain-error.js';
import { ZodPipe } from './zod.pipe.js';

describe('ZodPipe', () => {
  const pipe = new ZodPipe(registerRequestSchema);
  const valid = { name: 'Alex', email: ' Alex@Example.COM ', password: 'a-long-password' };

  it('returns parsed, normalized data', () => {
    expect(pipe.transform(valid)).toEqual({ name: 'Alex', email: 'alex@example.com', password: 'a-long-password' });
  });

  it('rejects unknown fields (mass assignment)', () => {
    expect(() => pipe.transform({ ...valid, role: 'ADMIN' })).toThrow(DomainError);
  });

  it('reports field and code but never the submitted value', () => {
    try {
      pipe.transform({ ...valid, password: 'short' });
      expect.unreachable();
    } catch (e) {
      const err = e as DomainError;
      expect(err.code).toBe('VALIDATION_FAILED');
      expect(err.details).toEqual([{ field: 'password', code: 'PASSWORD_TOO_SHORT' }]);
      expect(JSON.stringify(err.details)).not.toContain('short"');
    }
  });
});
