import { Prisma } from './generated/prisma/client.js';

/**
 * Name of the violated unique constraint/index for a P2002 error, across the classic
 * engine (`meta.target`) and driver adapters (`meta.driverAdapterError.cause.constraint`).
 * Callers branch on constraint NAMES, because one table can have several uniques with
 * different meanings (idempotency vs one-active-operation).
 */
export function uniqueViolationTarget(error: unknown): string | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return null;
  const meta = error.meta as Record<string, unknown> | undefined;
  const cause = (meta?.driverAdapterError as { cause?: { constraint?: { index?: string } | string } } | undefined)?.cause;
  const constraint = typeof cause?.constraint === 'string' ? cause.constraint : cause?.constraint?.index;
  if (constraint) return constraint;
  const target = meta?.target;
  if (typeof target === 'string') return target;
  if (Array.isArray(target)) return target.join(',');
  return 'unknown';
}

export const isUniqueViolation = (error: unknown, name?: string): boolean => {
  const target = uniqueViolationTarget(error);
  return target !== null && (name === undefined || target.includes(name));
};

export const isNotFound = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';

/** Serialization failure / deadlock: safe to retry the whole transaction. */
export const isRetryableTransactionError = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
