import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module.js';
import { AuditService } from '../audit/audit.service.js';
import { ServerPanelService } from './server-panel.service.js';
import { ServersController } from './servers.controller.js';
import { ServersRepository } from './servers.repository.js';
import { ServersService } from './servers.service.js';

@Module({
  imports: [CatalogModule],
  controllers: [ServersController],
  providers: [ServersService, ServersRepository, ServerPanelService, AuditService],
})
export class ServersModule {}
