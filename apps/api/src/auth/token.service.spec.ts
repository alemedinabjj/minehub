import { JwtService } from '@nestjs/jwt';
import type { ApiConfig } from '@hubmine/config';
import { describe, expect, it } from 'vitest';
import { ACCESS_TOKEN_AUDIENCE, ACCESS_TOKEN_ISSUER, TokenService } from './token.service.js';

const secret = 'test-secret-'.padEnd(48, 'x');
const jwtFor = (s = secret, aud = ACCESS_TOKEN_AUDIENCE) =>
  new JwtService({
    secret: s,
    signOptions: { algorithm: 'HS256', expiresIn: 900, issuer: ACCESS_TOKEN_ISSUER, audience: aud },
    verifyOptions: { algorithms: ['HS256'], issuer: ACCESS_TOKEN_ISSUER, audience: ACCESS_TOKEN_AUDIENCE },
  });
const config = { JWT_ACCESS_TTL_SECONDS: 900 } as ApiConfig;

describe('TokenService', () => {
  const tokens = new TokenService(jwtFor(), config);

  it('round-trips the user id', async () => {
    const token = await tokens.signAccessToken('0199e2a4-0000-7000-8000-000000000001');
    expect(await tokens.verifyAccessToken(token)).toBe('0199e2a4-0000-7000-8000-000000000001');
  });

  it('rejects tampered tokens, other secrets and other audiences', async () => {
    const token = await tokens.signAccessToken('u1');
    expect(await tokens.verifyAccessToken(`${token.slice(0, -2)}xx`)).toBeNull();
    const foreign = await new TokenService(jwtFor('other-secret'.padEnd(48, 'y')), config).signAccessToken('u1');
    expect(await tokens.verifyAccessToken(foreign)).toBeNull();
    const wrongAud = await new TokenService(jwtFor(secret, 'someone-else'), config).signAccessToken('u1');
    expect(await tokens.verifyAccessToken(wrongAud)).toBeNull();
  });

  it('rejects alg=none tokens', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: 'u1', iss: ACCESS_TOKEN_ISSUER, aud: ACCESS_TOKEN_AUDIENCE })).toString('base64url');
    expect(await tokens.verifyAccessToken(`${header}.${payload}.`)).toBeNull();
  });

  it('creates opaque refresh tokens and stores only their hash', () => {
    const { token, hash } = tokens.newRefreshToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toBe(TokenService.hash(token));
    expect(hash).not.toContain(token);
  });
});
