import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';

/** OWASP-recommended argon2id parameters (19 MiB, 2 iterations, 1 lane). */
const OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

@Injectable()
export class PasswordService {
  /** Verified against when the user does not exist, so timing doesn't reveal registered emails. */
  private dummyHash: Promise<string> | null = null;

  hash(password: string): Promise<string> {
    return argon2.hash(password, OPTIONS);
  }

  async verify(hash: string | null, password: string): Promise<boolean> {
    const target = hash ?? (await (this.dummyHash ??= argon2.hash('hubmine-timing-equalizer', OPTIONS)));
    try {
      const ok = await argon2.verify(target, password);
      return hash !== null && ok;
    } catch {
      return false;
    }
  }
}
