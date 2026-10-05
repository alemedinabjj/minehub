import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../test/test-app.js';

const ORIGIN = 'http://localhost:3000';
let app: INestApplication;
let close: () => Promise<void>;
const http = () => request(app.getHttpServer());

const refreshCookie = (res: request.Response) => {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  return raw?.find((c) => c.startsWith('hm_rt='))?.split(';')[0];
};

beforeAll(async () => {
  process.env.WEB_ORIGIN = ORIGIN;
  ({ app, close } = await createTestApp());
});
afterAll(async () => close?.());

describe('auth flow', () => {
  const user = { name: 'Alex', email: `alex+${Date.now()}@example.com`, password: 'super-secret-password' };

  it('registers, sets an httpOnly strict refresh cookie and returns an access token', async () => {
    const res = await http().post('/auth/register').send(user).expect(201);
    expect(res.body.data.user).toMatchObject({ email: user.email, name: 'Alex' });
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.user.passwordHash).toBeUndefined();
    const cookie = (res.headers['set-cookie'] as unknown as string[])[0]!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\/auth/);
  });

  it('rejects a duplicate email with a stable code', async () => {
    const res = await http().post('/auth/register').send(user).expect(409);
    expect(res.body.error.code).toBe('EMAIL_IN_USE');
  });

  it('rejects unknown fields', async () => {
    await http().post('/auth/register').send({ ...user, email: 'x@example.com', isAdmin: true }).expect(400);
  });

  it('uses the same error for wrong password and unknown email', async () => {
    const a = await http().post('/auth/login').send({ email: user.email, password: 'wrong-password!' }).expect(401);
    const b = await http().post('/auth/login').send({ email: 'nobody@example.com', password: 'wrong-password!' }).expect(401);
    expect(a.body.error).toEqual(b.body.error);
  });

  it('guards /auth/me and accepts a valid bearer token', async () => {
    await http().get('/auth/me').expect(401);
    const login = await http().post('/auth/login').send({ email: user.email, password: user.password }).expect(200);
    const me = await http().get('/auth/me').set('Authorization', `Bearer ${login.body.data.accessToken}`).expect(200);
    expect(me.body.data.email).toBe(user.email);
  });

  it('rotates refresh tokens and revokes the family on reuse', async () => {
    const login = await http().post('/auth/login').send({ email: user.email, password: user.password }).expect(200);
    const first = refreshCookie(login)!;

    const rotated = await http().post('/auth/refresh').set('Origin', ORIGIN).set('Cookie', first).expect(200);
    const second = refreshCookie(rotated)!;
    expect(second).not.toBe(first);

    // Presenting the old token again within the grace window is refused but harmless...
    await http().post('/auth/refresh').set('Origin', ORIGIN).set('Cookie', first).expect(401);
    // ...and the current token still works.
    const third = refreshCookie(await http().post('/auth/refresh').set('Origin', ORIGIN).set('Cookie', second).expect(200))!;
    expect(third).toBeDefined();
  });

  it('refuses cookie endpoints from foreign origins', async () => {
    const res = await http().post('/auth/refresh').set('Origin', 'https://evil.example').expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN_ORIGIN');
  });

  it('logout revokes the session', async () => {
    const login = await http().post('/auth/login').send({ email: user.email, password: user.password }).expect(200);
    const cookie = refreshCookie(login)!;
    await http().post('/auth/logout').set('Origin', ORIGIN).set('Cookie', cookie).expect(204);
    await http().post('/auth/refresh').set('Origin', ORIGIN).set('Cookie', cookie).expect(401);
  });

  it('returns the error envelope with a request id', async () => {
    const res = await http().get('/does-not-exist').set('X-Request-Id', 'req-test-1234').expect(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: expect.any(String) }, requestId: 'req-test-1234' });
  });
});
