import { pino } from 'pino';

export function createLogger(level: string, pretty: boolean) {
  return pino({
    level,
    base: { service: 'hubmine-worker' },
    redact: { paths: ['*.password', '*.rconPassword', '*.token', '*.env'], censor: '[redacted]' },
    ...(pretty ? { transport: { target: 'pino-pretty', options: { singleLine: true } } } : {}),
  });
}
export type Logger = ReturnType<typeof createLogger>;
