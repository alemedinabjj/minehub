import { z } from 'zod';

/**
 * Auth API contracts.
 *
 *   POST /auth/register   RegisterRequest -> 201 AuthSession      (sets refresh cookie)
 *   POST /auth/login      LoginRequest    -> 200 AuthSession      (sets refresh cookie)
 *   POST /auth/refresh    (refresh cookie) -> 200 AuthSession     (rotates refresh cookie)
 *   POST /auth/logout     (refresh cookie) -> 204                 (revokes the token family)
 *   GET  /auth/me         (Bearer)        -> 200 { data: AuthUser }
 *
 * The access token travels in `Authorization: Bearer`, lives in memory on the client,
 * and is short-lived. The refresh token is only ever an httpOnly cookie.
 */

export const PASSWORD = { min: 10, max: 128 } as const;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, 'EMAIL_TOO_LONG')
  .pipe(z.email('EMAIL_INVALID'));

export const passwordSchema = z
  .string()
  .min(PASSWORD.min, 'PASSWORD_TOO_SHORT')
  .max(PASSWORD.max, 'PASSWORD_TOO_LONG');

export const displayNameSchema = z
  .string()
  .trim()
  .min(2, 'NAME_TOO_SHORT')
  .max(64, 'NAME_TOO_LONG')
  .regex(/^[\p{L}\p{N} .'_-]+$/u, 'NAME_INVALID_CHARS');

export const registerRequestSchema = z.object({
  name: displayNameSchema,
  email: emailSchema,
  password: passwordSchema,
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(PASSWORD.max),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const authUserSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  name: z.string(),
});
export type AuthUser = z.infer<typeof authUserSchema>;

export const authSessionSchema = z.object({
  data: z.object({
    user: authUserSchema,
    accessToken: z.string(),
    /** Seconds until the access token expires. */
    expiresIn: z.number().int().positive(),
  }),
});
export type AuthSession = z.infer<typeof authSessionSchema>;
