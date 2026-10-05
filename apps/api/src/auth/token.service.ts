import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { ApiConfig } from '@hubmine/config';
import { API_CONFIG } from '../config/config.module.js';

export const ACCESS_TOKEN_ISSUER = 'hubmine-api';
export const ACCESS_TOKEN_AUDIENCE = 'hubmine-web';

export interface AccessTokenClaims {
  sub: string;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  get accessTtlSeconds(): number {
    return this.config.JWT_ACCESS_TTL_SECONDS;
  }

  signAccessToken(userId: string): Promise<string> {
    return this.jwt.signAsync({ sub: userId } satisfies AccessTokenClaims);
  }

  /** Returns the user id, or null for any invalid/expired/tampered token. */
  async verifyAccessToken(token: string): Promise<string | null> {
    try {
      const claims = await this.jwt.verifyAsync<AccessTokenClaims>(token);
      return typeof claims.sub === 'string' ? claims.sub : null;
    } catch {
      return null;
    }
  }

  /** Opaque refresh token; only its SHA-256 is stored. */
  newRefreshToken(): { token: string; hash: string } {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: TokenService.hash(token) };
  }

  static hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
