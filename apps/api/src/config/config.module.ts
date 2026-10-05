import { Global, Module } from '@nestjs/common';
import { apiConfigSchema, loadConfig, type ApiConfig } from '@hubmine/config';

export const API_CONFIG = Symbol('API_CONFIG');

/** Validated once at boot. Inject with @Inject(API_CONFIG); never read process.env elsewhere. */
@Global()
@Module({
  providers: [{ provide: API_CONFIG, useFactory: (): ApiConfig => loadConfig(apiConfigSchema) }],
  exports: [API_CONFIG],
})
export class ConfigModule {}
