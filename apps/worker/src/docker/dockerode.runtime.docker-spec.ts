import { randomUUID } from 'node:crypto';
import { WORLD_PRESETS } from '@hubmine/shared';
import Docker from 'dockerode';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildEnv } from '../minecraft/env-mapper.js';
import { imageFor } from '../minecraft/java-image.js';
import { detectIoWeight } from '../nodes/cgroup.js';
import { isHostPortFree } from '../nodes/host-ports.js';
import { ContainerSpecDriftError } from './container-runtime.js';
import type { ServerRuntimeSpec } from './container-spec.builder.js';
import { DockerodeRuntime } from './dockerode.runtime.js';
import { containerName, volumeName } from './names.js';
import { toDockerLimits } from './resource-limits.js';

/**
 * Security regression suite against the real daemon (secure-docker-provisioning). Gated:
 *   HUBMINE_DOCKER_TESTS=1 pnpm --filter @hubmine/worker test:docker
 * Creates one real Vanilla server, asserts the isolation options from a raw inspect, waits
 * for Minecraft to become healthy, then removes the container and its volume.
 */
const enabled = process.env.HUBMINE_DOCKER_TESTS === '1';
const socketPath = process.env.DOCKER_SOCKET_PATH ?? '/var/run/docker.sock';
const serverId = randomUUID();
const raw = new Docker({ socketPath });
const runtime = new DockerodeRuntime(socketPath, { uid: 1000, gid: 1000, bindIp: '127.0.0.1', ioWeight: detectIoWeight() }, true);
let spec: ServerRuntimeSpec;

async function freePort() {
  for (let p = 41000; p < 41100; p++) if (await isHostPortFree('127.0.0.1', p)) return p;
  throw new Error('no free port for the docker test');
}

describe.runIf(enabled)('DockerodeRuntime against a real daemon', () => {
  beforeAll(async () => {
    const limits = toDockerLimits({ heapMb: 1024, cpuMillis: 1000 });
    spec = {
      serverId,
      image: imageFor('1.21.11', 'VANILLA'),
      env: buildEnv({
        name: 'Docker Contract',
        software: 'VANILLA',
        minecraftVersion: '1.21.11',
        loaderVersion: null,
        modpack: null,
        settings: { ...WORLD_PRESETS.CREATIVE.settings, viewDistance: 4, simulationDistance: 4 },
        heapEnv: limits.heapEnv,
        eulaAcceptedAt: new Date(),
        rconPassword: 'contract-test-only',
      }),
      hostPort: await freePort(),
      limits,
      startPeriodSec: 300,
      stopTimeoutSec: 30,
      readOnlyRootfs: true,
    };
  });

  afterAll(async () => {
    await runtime.stop(serverId, { timeoutSec: 5 }).catch(() => undefined);
    await runtime.remove(serverId).catch(() => undefined);
    await runtime.removeVolume(serverId).catch(() => undefined);
  });

  it('runs on a daemon with user-namespace remapping', async () => {
    await expect(runtime.assertSecureDaemon()).resolves.toBeUndefined();
  });

  it('creates the network, volume and container idempotently', async () => {
    await runtime.ensureNetwork();
    await runtime.ensureNetwork();
    await runtime.ensureVolume(serverId);
    await runtime.ensureVolume(serverId);
    await runtime.ensureImage(spec.image, { timeoutMs: 10 * 60_000 });
    const first = await runtime.create(spec);
    const again = await runtime.create(spec);
    expect(first.created).toBe(true);
    expect(again).toEqual({ containerId: first.containerId, created: false });
    await expect(runtime.create({ ...spec, hostPort: spec.hostPort + 1 })).rejects.toThrow(ContainerSpecDriftError);
  });

  it('applies every isolation option (raw inspect)', async () => {
    const info = await raw.getContainer(containerName(serverId)).inspect();
    const h = info.HostConfig;
    expect(h.Privileged).toBe(false);
    expect(h.CapDrop).toEqual(['ALL']);
    expect(h.CapAdd ?? []).toEqual([]);
    expect(h.SecurityOpt).toEqual(['no-new-privileges:true']);
    expect(h.ReadonlyRootfs).toBe(true);
    expect(h.NetworkMode).toBe('hm-mc');
    expect(h.Memory).toBe(spec.limits.memoryBytes);
    expect(h.MemorySwap).toBe(h.Memory);
    expect(h.PidsLimit).toBe(1024);
    expect(h.RestartPolicy?.Name).toBe('no');
    expect(Object.keys(h.PortBindings ?? {})).toEqual(['25565/tcp']);
    expect(info.Config.User).toBe('1000:1000');
    expect(info.Mounts).toHaveLength(1);
    expect(info.Mounts[0]).toMatchObject({ Type: 'volume', Name: volumeName(serverId), Destination: '/data' });
    const network = await raw.getNetwork('hm-mc').inspect();
    expect(network.Options?.['com.docker.network.bridge.enable_icc']).toBe('false');
  });

  it('starts, becomes healthy with a read-only rootfs, and stops/starts idempotently', async () => {
    await runtime.start(serverId);
    await runtime.start(serverId); // 304 → no-op
    const deadline = Date.now() + 10 * 60_000;
    let observed = await runtime.inspect(serverId);
    while (observed.exists && observed.running && observed.health !== 'healthy' && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5_000));
      observed = await runtime.inspect(serverId);
    }
    if (!(observed.exists && observed.health === 'healthy')) {
      const logs = await raw.getContainer(containerName(serverId)).logs({ stdout: true, stderr: true, tail: 60 });
      throw new Error(`server did not become healthy: ${JSON.stringify(observed)}\n${logs.toString('utf8')}`);
    }

    await runtime.stop(serverId, { timeoutSec: 30 });
    await runtime.stop(serverId, { timeoutSec: 30 }); // 304 → no-op
    expect(await runtime.inspect(serverId)).toMatchObject({ exists: true, running: false });
  });

  it('removes container and volume idempotently', async () => {
    await runtime.remove(serverId);
    await runtime.remove(serverId);
    await runtime.removeVolume(serverId);
    await runtime.removeVolume(serverId);
    expect(await runtime.inspect(serverId)).toEqual({ exists: false });
  });
});
