import { describe, expect, it } from 'vitest';
import { demuxDockerStream, sanitizeLine, sanitizeOutput } from '../docker/output.js';
import { parsePlayerList, ServerCommands } from './server-commands.js';

describe('parsePlayerList', () => {
  it.each([
    ['There are 2 of a max of 10 players online: Steve, Alex', { online: 2, max: 10, players: ['Steve', 'Alex'] }],
    ['There are 0 of a max of 5 players online: ', { online: 0, max: 5, players: [] }],
    ['There are 1 of a max 20 players online: Notch', { online: 1, max: 20, players: ['Notch'] }],
  ])('%s', (text, expected) => {
    expect(parsePlayerList(text)).toEqual(expected);
  });

  it('ignores names that are not player names', () => {
    expect(parsePlayerList('There are 2 of a max of 10 players online: Steve, <script>')?.players).toEqual(['Steve']);
  });

  it('returns null for unexpected output', () => {
    expect(parsePlayerList('Unknown command')).toBeNull();
  });
});

describe('container output sanitizing', () => {
  it('strips ANSI, § formatting and control characters', () => {
    expect(sanitizeLine('\u001b[32m[INFO]\u001b[0m §aHello§r\u0007 world\u0000')).toBe('[INFO] Hello world');
  });

  it('caps line and total length', () => {
    expect(sanitizeLine('x'.repeat(10_000))).toHaveLength(4096);
    expect(sanitizeOutput('a\nb\nc', 3)).toBe('a\nb');
  });

  it('demultiplexes Docker stdout/stderr frames', () => {
    const frame = (type: number, text: string) => {
      const body = Buffer.from(text);
      const head = Buffer.alloc(8);
      head[0] = type;
      head.writeUInt32BE(body.length, 4);
      return Buffer.concat([head, body]);
    };
    expect(demuxDockerStream(Buffer.concat([frame(1, 'out\n'), frame(2, 'err\n')]))).toBe('out\nerr\n');
    expect(demuxDockerStream(Buffer.from('plain text'))).toBe('plain text');
  });
});

describe('logs', () => {
  it("hides the panel's own RCON connection noise", async () => {
    const runtime = { logs: async () => ['[03:43:14 INFO]: Thread RCON Client /0:0:0:0:0:0:0:1 started', '[03:43:15 INFO]: [Rcon] Ola', '[03:43:15 INFO]: Thread RCON Client /127.0.0.1 shutting down'] };
    const prisma = { server: { findFirst: async () => ({ status: 'ONLINE' }) } };
    const commands = new ServerCommands(prisma as never, runtime as never, { warn: () => undefined } as never);
    expect(await commands.handle({ kind: 'logs', serverId: '019a0000-0000-7000-8000-000000000001', tail: 10 })).toEqual({ ok: true, data: { lines: ['[03:43:15 INFO]: [Rcon] Ola'] } });
  });
});
