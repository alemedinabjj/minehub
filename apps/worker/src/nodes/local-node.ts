import { statfs } from 'node:fs/promises';
import os from 'node:os';
import type { WorkerConfig } from '@hubmine/config';
import type { HubmineDb } from '@hubmine/database';
import type { Logger } from '../logger.js';

/**
 * MVP data plane: this worker process is also the node agent for the machine it runs on.
 * It registers itself as a ServerNode and reports capacity on every heartbeat.
 * Future: a remote `hubmine-agent` reports the same shape over mTLS.
 */
export class LocalNode {
  constructor(
    private readonly prisma: HubmineDb,
    private readonly config: WorkerConfig,
    private readonly log: Logger,
  ) {}

  private async snapshot() {
    const disk = await statfs('/');
    const totalStorageMb = Math.floor((disk.blocks * disk.bsize) / 1024 / 1024);
    const freeStorageMb = Math.floor((disk.bavail * disk.bsize) / 1024 / 1024);
    return {
      totalCpuMillis: os.availableParallelism() * 1000,
      totalMemoryMb: Math.floor(os.totalmem() / 1024 / 1024),
      totalStorageMb,
      heartbeat: {
        freeMemoryMb: Math.floor(os.freemem() / 1024 / 1024),
        freeStorageMb,
        load1: Number(os.loadavg()[0]?.toFixed(2) ?? 0),
        uptimeSec: Math.floor(os.uptime()),
      },
    };
  }

  /** Upsert by name; idempotent, safe to call on every boot and heartbeat. */
  async heartbeat(): Promise<void> {
    const s = await this.snapshot();
    const now = new Date();
    const common = {
      publicHost: this.config.MC_PUBLIC_HOST,
      dockerEndpoint: `unix://${this.config.DOCKER_SOCKET_PATH}`,
      totalCpuMillis: s.totalCpuMillis,
      totalMemoryMb: s.totalMemoryMb,
      totalStorageMb: s.totalStorageMb,
      lastHeartbeat: s.heartbeat,
      lastHeartbeatAt: now,
    };
    await this.prisma.serverNode.upsert({
      where: { name: this.config.NODE_NAME },
      create: { name: this.config.NODE_NAME, ...common },
      update: common,
    });
    this.log.debug({ node: this.config.NODE_NAME, ...s.heartbeat }, 'node heartbeat');
  }
}
