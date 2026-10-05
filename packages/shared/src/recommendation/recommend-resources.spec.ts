import { describe, expect, it } from 'vitest';
import { PLAYER_BUCKETS, RESOURCE_LIMITS } from '../domain/resources.js';
import { SOFTWARE } from '../domain/software.js';
import { recommendResources } from './recommend-resources.js';

describe('recommendResources', () => {
  it('recommends 2 GB for a solo vanilla world', () => {
    expect(recommendResources({ software: 'VANILLA', players: 'SOLO' }).heapMb).toBe(2048);
  });

  it('recommends more memory for modded than for Paper with the same players', () => {
    const paper = recommendResources({ software: 'PAPER', players: 'MEDIUM' });
    const fabric = recommendResources({ software: 'FABRIC', players: 'MEDIUM' });
    expect(fabric.heapMb).toBeGreaterThan(paper.heapMb);
    expect(fabric.cpuMillis).toBeGreaterThan(paper.cpuMillis);
  });

  it('grows with player count', () => {
    const heaps = PLAYER_BUCKETS.map((players) => recommendResources({ software: 'PAPER', players }).heapMb);
    expect([...heaps].sort((a, b) => a - b)).toEqual(heaps);
    expect(new Set(heaps).size).toBe(heaps.length);
  });

  it('adds memory for large modpacks but caps the extra', () => {
    const small = recommendResources({ software: 'NEOFORGE', players: 'SMALL', modpack: { modCount: 30 } });
    const big = recommendResources({ software: 'NEOFORGE', players: 'SMALL', modpack: { modCount: 120 } });
    const huge = recommendResources({ software: 'NEOFORGE', players: 'SMALL', modpack: { modCount: 900 } });
    expect(small.reasons).not.toContain('MODPACK_SIZE');
    expect(big.heapMb - small.heapMb).toBe(4096);
    expect(huge.heapMb - small.heapMb).toBe(8192);
  });

  it('treats an unknown modpack size as modded base', () => {
    const r = recommendResources({ software: 'FORGE', players: 'SOLO', modpack: { modCount: undefined } });
    expect(r.heapMb).toBe(4096);
  });

  it.each(SOFTWARE.flatMap((software) => PLAYER_BUCKETS.map((players) => [software, players] as const)))(
    'stays within limits and steps for %s / %s',
    (software, players) => {
      const r = recommendResources({ software, players, modpack: { modCount: 5000 } });
      expect(r.heapMb).toBeGreaterThanOrEqual(RESOURCE_LIMITS.heapMb.min);
      expect(r.heapMb).toBeLessThanOrEqual(RESOURCE_LIMITS.heapMb.max);
      expect(r.heapMb % RESOURCE_LIMITS.heapMb.step).toBe(0);
      expect(r.cpuMillis % RESOURCE_LIMITS.cpuMillis.step).toBe(0);
    },
  );
});
