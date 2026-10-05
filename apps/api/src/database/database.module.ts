import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { ApiConfig } from '@hubmine/config';
import { createPrismaClient, SecretBox, type HubmineDb } from '@hubmine/database';
import { API_CONFIG } from '../config/config.module.js';

export const PRISMA = Symbol('PRISMA');

@Injectable()
class PrismaLifecycle implements OnApplicationShutdown {
  constructor(@Inject(PRISMA) private readonly prisma: HubmineDb) {}
  async onApplicationShutdown() {
    await this.prisma.$disconnect();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: PRISMA,
      inject: [API_CONFIG],
      useFactory: (config: ApiConfig) =>
        createPrismaClient({ connectionString: config.DATABASE_URL, applicationName: 'hubmine-api' }),
    },
    {
      provide: SecretBox,
      inject: [API_CONFIG],
      useFactory: (config: ApiConfig) => new SecretBox(config.SECRETS_ENCRYPTION_KEY),
    },
    PrismaLifecycle,
  ],
  exports: [PRISMA, SecretBox],
})
export class DatabaseModule {}
