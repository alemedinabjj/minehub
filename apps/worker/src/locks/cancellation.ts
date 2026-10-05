import { cancelChannel } from '@hubmine/queue';
import type { Redis } from 'ioredis';
import type { Logger } from '../logger.js';

export class OperationCancelledError extends Error {
  constructor() {
    super('operation cancelled');
    this.name = 'OperationCancelledError';
  }
}

/**
 * Turns "this operation was superseded" into an AbortSignal for the running handler.
 * Primary path: the API publishes on `hm:cancel:<operationId>` after committing.
 * Fallback: polling the operation's status, so a lost pub/sub message only delays the abort.
 */
export class CancellationHub {
  private readonly running = new Map<string, AbortController>();
  private readonly prefix = cancelChannel('');

  constructor(
    private readonly subscriber: Redis,
    private readonly isCancelled: (operationId: string) => Promise<boolean>,
    private readonly log: Logger,
    private readonly pollMs = 3_000,
  ) {}

  async start(): Promise<void> {
    this.subscriber.on('pmessage', (_pattern: string, channel: string) => {
      this.running.get(channel.slice(this.prefix.length))?.abort(new OperationCancelledError());
    });
    await this.subscriber.psubscribe(`${this.prefix}*`);
  }

  async track<T>(operationId: string, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    this.running.set(operationId, controller);
    const poll = setInterval(() => {
      this.isCancelled(operationId)
        .then((cancelled) => cancelled && controller.abort(new OperationCancelledError()))
        .catch((err: unknown) => this.log.warn({ err, operationId }, 'cancellation poll failed'));
    }, this.pollMs);
    try {
      return await fn(controller.signal);
    } finally {
      clearInterval(poll);
      this.running.delete(operationId);
    }
  }

  async close(): Promise<void> {
    await this.subscriber.quit().catch(() => this.subscriber.disconnect());
  }
}
