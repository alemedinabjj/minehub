import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC, type AuthenticatedUser } from '../common/auth/auth.decorators.js';
import { Errors } from '../common/errors/domain-error.js';
import { TokenService } from './token.service.js';

/** Global guard: every route requires a valid Bearer access token unless marked @Public(). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw Errors.unauthorized();
    const userId = await this.tokens.verifyAccessToken(header.slice('Bearer '.length).trim());
    if (!userId) throw Errors.unauthorized();
    req.user = { id: userId };
    return true;
  }
}
