import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ApiConfig } from '@hubmine/config';
import { isUniqueViolation } from '@hubmine/database';
import type { AuthUser, LoginRequest, RegisterRequest } from '@hubmine/shared';
import { AuditService } from '../audit/audit.service.js';
import { Errors } from '../common/errors/domain-error.js';
import { API_CONFIG } from '../config/config.module.js';
import { AuthRepository } from './auth.repository.js';
import { PasswordService } from './password.service.js';
import { TokenService } from './token.service.js';

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

export interface IssuedSession {
  user: AuthUser;
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
}

/** A rotated token presented again within this window is treated as a benign race (two tabs). */
const ROTATION_GRACE_MS = 15_000;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly repo: AuthRepository,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  async register(input: RegisterRequest, meta: RequestMeta): Promise<IssuedSession> {
    const passwordHash = await this.passwords.hash(input.password);
    let user: AuthUser;
    try {
      user = await this.repo.createUser({ email: input.email, name: input.name, passwordHash });
    } catch (err) {
      if (isUniqueViolation(err)) throw Errors.emailInUse();
      throw err;
    }
    await this.audit.record({ action: 'user.registered', actorType: 'USER', actorId: user.id, targetType: 'user', targetId: user.id, ip: meta.ip, requestId: meta.requestId });
    return this.issueSession(user, randomUUID(), meta);
  }

  async login(input: LoginRequest, meta: RequestMeta): Promise<IssuedSession> {
    const found = await this.repo.findCredentialsByEmail(input.email);
    const ok = await this.passwords.verify(found?.passwordHash ?? null, input.password);
    if (!found || !ok) {
      await this.audit.record({ action: 'user.login_failed', actorType: 'USER', actorId: found?.id ?? null, targetType: 'user', targetId: found?.id ?? null, ip: meta.ip, requestId: meta.requestId });
      throw Errors.invalidCredentials();
    }
    const user: AuthUser = { id: found.id, email: found.email, name: found.name };
    await this.audit.record({ action: 'user.login', actorType: 'USER', actorId: user.id, targetType: 'user', targetId: user.id, ip: meta.ip, requestId: meta.requestId });
    return this.issueSession(user, randomUUID(), meta);
  }

  async refresh(presentedToken: string | undefined, meta: RequestMeta): Promise<IssuedSession> {
    if (!presentedToken) throw Errors.sessionExpired();
    const stored = await this.repo.findRefreshToken(TokenService.hash(presentedToken));
    if (!stored) throw Errors.sessionExpired();

    if (stored.revokedAt) {
      const recentlyRotated = stored.replacedById !== null && Date.now() - stored.revokedAt.getTime() < ROTATION_GRACE_MS;
      if (!recentlyRotated) {
        // A rotated token came back long after rotation: assume theft, kill the whole session family.
        await this.repo.revokeFamily(stored.familyId);
        this.logger.warn({ userId: stored.userId, familyId: stored.familyId }, 'Refresh token reuse detected; family revoked');
        await this.audit.record({ action: 'session.reuse_detected', actorType: 'SYSTEM', targetType: 'user', targetId: stored.userId, ip: meta.ip, requestId: meta.requestId });
      }
      throw Errors.sessionExpired();
    }
    if (stored.expiresAt.getTime() <= Date.now()) throw Errors.sessionExpired();

    const user = await this.repo.findActiveUser(stored.userId);
    if (!user) {
      await this.repo.revokeFamily(stored.familyId);
      throw Errors.sessionExpired();
    }

    const next = this.tokens.newRefreshToken();
    const refreshExpiresAt = this.refreshExpiry();
    const rotated = await this.repo.rotateRefreshToken(stored, { tokenHash: next.hash, expiresAt: refreshExpiresAt, userAgent: meta.userAgent });
    if (!rotated) throw Errors.sessionExpired();

    return {
      user,
      accessToken: await this.tokens.signAccessToken(user.id),
      expiresIn: this.tokens.accessTtlSeconds,
      refreshToken: next.token,
      refreshExpiresAt,
    };
  }

  async logout(presentedToken: string | undefined, meta: RequestMeta): Promise<void> {
    if (!presentedToken) return;
    const stored = await this.repo.findRefreshToken(TokenService.hash(presentedToken));
    if (!stored) return;
    await this.repo.revokeFamily(stored.familyId);
    await this.audit.record({ action: 'user.logout', actorType: 'USER', actorId: stored.userId, targetType: 'user', targetId: stored.userId, ip: meta.ip, requestId: meta.requestId });
  }

  async me(userId: string): Promise<AuthUser> {
    const user = await this.repo.findActiveUser(userId);
    if (!user) throw Errors.unauthorized();
    return user;
  }

  private async issueSession(user: AuthUser, familyId: string, meta: RequestMeta): Promise<IssuedSession> {
    const refresh = this.tokens.newRefreshToken();
    const refreshExpiresAt = this.refreshExpiry();
    await this.repo.createRefreshToken({ userId: user.id, familyId, tokenHash: refresh.hash, expiresAt: refreshExpiresAt, userAgent: meta.userAgent });
    return {
      user,
      accessToken: await this.tokens.signAccessToken(user.id),
      expiresIn: this.tokens.accessTtlSeconds,
      refreshToken: refresh.token,
      refreshExpiresAt,
    };
  }

  private refreshExpiry(): Date {
    return new Date(Date.now() + this.config.REFRESH_TTL_DAYS * 24 * 3600 * 1000);
  }
}
