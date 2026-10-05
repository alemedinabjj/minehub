import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller.js';
import { CATALOG_CACHE_PREFIX, CATALOG_FETCHER, CatalogService, httpCatalogFetcher } from './catalog.service.js';

@Module({
  controllers: [CatalogController],
  providers: [CatalogService, { provide: CATALOG_FETCHER, useValue: httpCatalogFetcher }, { provide: CATALOG_CACHE_PREFIX, useValue: 'hm:catalog:v1' }],
  exports: [CatalogService],
})
export class CatalogModule {}
