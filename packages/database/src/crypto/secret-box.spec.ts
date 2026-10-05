import { describe, expect, it } from 'vitest';
import { SecretBox, randomSecret } from './secret-box.js';

const key = Buffer.alloc(32, 7).toString('base64');

describe('SecretBox', () => {
  it('round-trips and uses a fresh IV each time', () => {
    const box = new SecretBox(key);
    const a = box.encrypt('rcon-secret');
    const b = box.encrypt('rcon-secret');
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
    expect(box.decrypt(a)).toBe('rcon-secret');
  });

  it('rejects tampered ciphertext', () => {
    const box = new SecretBox(key);
    const payload = box.encrypt('rcon-secret');
    payload[payload.length - 1]! ^= 0xff;
    expect(() => box.decrypt(payload)).toThrow();
  });

  it('rejects the wrong key', () => {
    const payload = new SecretBox(key).encrypt('x');
    expect(() => new SecretBox(Buffer.alloc(32, 9).toString('base64')).decrypt(payload)).toThrow();
  });

  it('refuses short keys', () => {
    expect(() => new SecretBox(Buffer.alloc(16).toString('base64'))).toThrow();
  });

  it('generates url-safe secrets', () => {
    expect(randomSecret()).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });
});
