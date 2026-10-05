import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';

export interface CreatePrismaClientOptions {
  connectionString: string;
  /** Pool size per process. Keep API + worker totals below Postgres max_connections. */
  maxConnections?: number;
  applicationName?: string;
}

/** One client (one pool) per process. Never create clients per request. */
export function createPrismaClient({ connectionString, maxConnections = 10, applicationName = 'hubmine' }: CreatePrismaClientOptions) {
  const adapter = new PrismaPg({ connectionString, max: maxConnections, application_name: applicationName });
  return new PrismaClient({ adapter });
}

export type HubmineDb = ReturnType<typeof createPrismaClient>;
