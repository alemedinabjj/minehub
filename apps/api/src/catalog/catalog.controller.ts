import { Controller, Get, Header, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { listModpacksQuerySchema, softwareQuerySchema, type ListModpacksQuery } from '@hubmine/shared';
import { ZodPipe } from '../common/validation/zod.pipe.js';
import { CatalogService } from './catalog.service.js';

/** Authenticated (global guard): the catalog fans out to third-party APIs, so it is not public. */
@Controller('catalog')
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('versions')
  @Header('Cache-Control', 'private, max-age=300')
  async versions() {
    return { data: await this.catalog.versions() };
  }

  @Get('software')
  @Header('Cache-Control', 'private, max-age=300')
  async software(@Query(new ZodPipe(softwareQuerySchema)) query: { version: string }) {
    return { data: await this.catalog.software(query.version) };
  }

  @Get('modpacks')
  @Header('Cache-Control', 'private, max-age=120')
  modpacks(@Query(new ZodPipe(listModpacksQuerySchema)) query: ListModpacksQuery) {
    return this.catalog.modpacks(query);
  }
}
