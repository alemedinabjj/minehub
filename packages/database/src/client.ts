import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';

export interface CreatePrismaClientOptions {
  connectionString: string;
  /** Pool size per process. Keep API + worker totals below Postgres max_connections. */
  maxConnections?: number;
  applicationName?: string;
}

/**
 * One client (one pool) per process. Never create clients per request.
 * The `?schema=` URL parameter (used by the Prisma CLI) is not understood by `pg`, so it is
 * stripped from the connection string and passed to the adapter explicitly.
 */
export function createPrismaClient({ connectionString, maxConnections = 10, applicationName = 'hubmine' }: CreatePrismaClientOptions) {
  const url = new URL(connectionString);
  const schema = url.searchParams.get('schema') ?? undefined;
  url.searchParams.delete('schema');
  const adapter = new PrismaPg(
    { connectionString: url.toString(), max: maxConnections, application_name: applicationName },
    schema ? { schema } : undefined,
  );
  return new PrismaClient({ adapter });
}

export type HubmineDb = ReturnType<typeof createPrismaClient>;
