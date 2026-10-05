import { describe, expect, it } from 'vitest';
import { formatServerAddress } from '../contracts/server.js';
import { slugifyWorldName, validateWorldName } from './world.js';

describe('validateWorldName', () => {
  it.each([
    ['ab', 'NAME_TOO_SHORT'],
    ['  ab  ', 'NAME_TOO_SHORT'],
    ['a'.repeat(33), 'NAME_TOO_LONG'],
    ['Medina<script>', 'NAME_INVALID_CHARS'],
    ['../../etc', 'NAME_INVALID_CHARS'],
    ['nome\nquebrado', 'NAME_INVALID_CHARS'],
  ])('rejects %j with %s', (name, code) => {
    expect(validateWorldName(name)).toBe(code);
  });

  it.each(['MedinaCraft', 'Mundo do João', 'smp_2026', 'Vila-Nova'])('accepts %j', (name) => {
    expect(validateWorldName(name)).toBeNull();
  });
});

describe('slugifyWorldName', () => {
  it('produces a DNS-safe slug', () => {
    expect(slugifyWorldName('Mundo do João!!')).toBe('mundo-do-joao');
    expect(slugifyWorldName('  MedinaCraft  ')).toBe('medinacraft');
  });
});

describe('formatServerAddress', () => {
  it('shows host:port while there is no hostname', () => {
    expect(formatServerAddress({ host: '192.168.0.10', port: 25570 })).toBe('192.168.0.10:25570');
  });
  it('omits the default port', () => {
    expect(formatServerAddress({ host: 'play.local', port: 25565 })).toBe('play.local');
  });
  it('prefers the SRV hostname when present', () => {
    expect(formatServerAddress({ host: '10.0.0.1', port: 25570, hostname: 'medinacraft.hubmine.com.br' })).toBe(
      'medinacraft.hubmine.com.br',
    );
  });
});
