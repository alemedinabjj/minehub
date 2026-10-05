import { Inject, Injectable, Logger } from '@nestjs/common';
import type { HubmineDb, Prisma } from '@hubmine/database';
import { PRISMA } from '../database/database.module.js';

export interface AuditEntry {
  action: string;
  actorType: 'USER' | 'SYSTEM' | 'ADMIN';
  actorId?: string | null;
  targetType: string;
  targetId?: string | null;
  serverId?: string | null;
  metadata?: Prisma.InputJsonValue;
  ip?: string | null;
  requestId?: string | null;
}

/** Append-only audit trail. Never pass secrets, tokens, passwords or raw request bodies. */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@Inject(PRISMA) private readonly prisma: HubmineDb) {}

  async record(entry: AuditEntry, tx: Pick<HubmineDb, 'auditLog'> = this.prisma): Promise<void> {
    try {
      await tx.auditLog.create({ data: entry });
    } catch (err) {
      // Audit must not break the user flow, but a failure is itself worth an alert.
      this.logger.error({ err, action: entry.action }, 'Failed to write audit log');
    }
  }
}
