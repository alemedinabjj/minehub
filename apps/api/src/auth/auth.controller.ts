import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { ApiConfig } from '@hubmine/config';
import { loginRequestSchema, registerRequestSchema, type AuthSession, type LoginRequest, type RegisterRequest } from '@hubmine/shared';
import type { CookieOptions, Request, Response } from 'express';
import { CurrentUser, Public, type AuthenticatedUser } from '../common/auth/auth.decorators.js';
import { Errors } from '../common/errors/domain-error.js';
import { ZodPipe } from '../common/validation/zod.pipe.js';
import { API_CONFIG } from '../config/config.module.js';
import { AuthService, type IssuedSession, type RequestMeta } from './auth.service.js';

export const REFRESH_COOKIE = 'hm_rt';
const REFRESH_COOKIE_PATH = '/auth';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async register(
    @Body(new ZodPipe(registerRequestSchema)) body: RegisterRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSession> {
    return this.respond(res, await this.auth.register(body, meta(req)));
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async login(
    @Body(new ZodPipe(loginRequestSchema)) body: LoginRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSession> {
    return this.respond(res, await this.auth.login(body, meta(req)));
  }

  /** Cookie-authenticated: guarded by SameSite=Strict plus an explicit Origin check. */
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<AuthSession> {
    this.assertTrustedOrigin(req);
    try {
      return this.respond(res, await this.auth.refresh(readRefreshCookie(req), meta(req)));
    } catch (err) {
      res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
      throw err;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    this.assertTrustedOrigin(req);
    await this.auth.logout(readRefreshCookie(req), meta(req));
    res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
  }

  @Get('me')
  async me(@CurrentUser() user: AuthenticatedUser) {
    return { data: await this.auth.me(user.id) };
  }

  private respond(res: Response, session: IssuedSession): AuthSession {
    res.cookie(REFRESH_COOKIE, session.refreshToken, { ...this.cookieOptions(), expires: session.refreshExpiresAt });
    res.setHeader('Cache-Control', 'no-store');
    return { data: { user: session.user, accessToken: session.accessToken, expiresIn: session.expiresIn } };
  }

  private cookieOptions(): CookieOptions {
    return { httpOnly: true, secure: this.config.COOKIE_SECURE, sameSite: 'strict', path: REFRESH_COOKIE_PATH };
  }

  private assertTrustedOrigin(req: Request) {
    if (req.headers.origin !== new URL(this.config.WEB_ORIGIN).origin) throw Errors.forbiddenOrigin();
  }
}

function readRefreshCookie(req: Request): string | undefined {
  const value: unknown = (req.cookies as Record<string, unknown> | undefined)?.[REFRESH_COOKIE];
  return typeof value === 'string' && value.length > 0 && value.length <= 128 ? value : undefined;
}

function meta(req: Request & { id?: unknown }): RequestMeta {
  const ua = req.headers['user-agent'];
  return {
    ip: req.ip ?? null,
    userAgent: typeof ua === 'string' ? ua.slice(0, 256) : null,
    requestId: typeof req.id === 'string' ? req.id : null,
  };
}
