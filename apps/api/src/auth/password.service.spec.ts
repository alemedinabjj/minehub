import { describe, expect, it } from 'vitest';
import { PasswordService } from './password.service.js';

describe('PasswordService', () => {
  const passwords = new PasswordService();

  it('hashes with argon2id and verifies', async () => {
    const hash = await passwords.hash('correct horse battery');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await passwords.verify(hash, 'correct horse battery')).toBe(true);
    expect(await passwords.verify(hash, 'wrong password!!')).toBe(false);
  });

  it('returns false for unknown users while still doing the work', async () => {
    expect(await passwords.verify(null, 'anything-at-all')).toBe(false);
  });
});
