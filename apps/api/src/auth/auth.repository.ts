import { Inject, Injectable } from '@nestjs/common';
import type { HubmineDb } from '@hubmine/database';
import { PRISMA } from '../database/database.module.js';

const publicUser = { id: true, email: true, name: true } as const;

@Injectable()
export class AuthRepository {
  constructor(@Inject(PRISMA) private readonly prisma: HubmineDb) {}

  createUser(data: { email: string; name: string; passwordHash: string }) {
    return this.prisma.user.create({ data, select: publicUser });
  }

  findCredentialsByEmail(email: string) {
    return this.prisma.user.findFirst({
      where: { email, deletedAt: null },
      select: { ...publicUser, passwordHash: true },
    });
  }

  findActiveUser(id: string) {
    return this.prisma.user.findFirst({ where: { id, deletedAt: null }, select: publicUser });
  }

  createRefreshToken(data: { userId: string; familyId: string; tokenHash: string; expiresAt: Date; userAgent: string | null }) {
    return this.prisma.refreshToken.create({ data, select: { id: true } });
  }

  findRefreshToken(tokenHash: string) {
    return this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, familyId: true, expiresAt: true, revokedAt: true, replacedById: true },
    });
  }

  /**
   * Atomically rotate: revoke the presented token only if it is still active, then issue
   * its replacement in the same family. Returns false when another request rotated it first.
   */
  async rotateRefreshToken(
    current: { id: string; userId: string; familyId: string },
    next: { tokenHash: string; expiresAt: Date; userAgent: string | null },
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.refreshToken.create({
        data: { userId: current.userId, familyId: current.familyId, ...next },
        select: { id: true },
      });
      const { count } = await tx.refreshToken.updateMany({
        where: { id: current.id, revokedAt: null },
        data: { revokedAt: new Date(), replacedById: created.id },
      });
      if (count === 0) throw new RotationRaceError();
      return true;
    }).catch((err: unknown) => {
      if (err instanceof RotationRaceError) return false;
      throw err;
    });
  }

  revokeFamily(familyId: string) {
    return this.prisma.refreshToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date() } });
  }
}

class RotationRaceError extends Error {}
