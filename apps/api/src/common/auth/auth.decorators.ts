import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';

export const IS_PUBLIC = 'hubmine:isPublic';
/** Opt a route out of the global auth guard. Every use needs a reason in review. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export interface AuthenticatedUser {
  id: string;
}

/** The authenticated user from the verified access token. Never read user ids from body/query. */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthenticatedUser => {
  const req = ctx.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
  if (!req.user) throw new Error('CurrentUser used on a public route');
  return req.user;
});
