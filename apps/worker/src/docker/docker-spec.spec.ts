import type { ContainerCreateOptions } from 'dockerode';
import { describe, expect, it } from 'vitest';
import { assertSafeCreateOptions, ContainerPolicyViolation } from './container-policy.js';
import { buildCreateOptions, specHash, type HostSettings, type ServerRuntimeSpec } from './container-spec.builder.js';
import { containerName, InvalidServerIdError, volumeName } from './names.js';
import { InvalidResourceError, toDockerLimits } from './resource-limits.js';

const SERVER_ID = '019a0000-0000-7000-8000-000000000001';
const OTHER_ID = '019a0000-0000-7000-8000-000000000002';
const host: HostSettings = { uid: 1000, gid: 1000, bindIp: '0.0.0.0', ioWeight: 300 };
const runtimeSpec = (overrides: Partial<ServerRuntimeSpec> = {}): ServerRuntimeSpec => ({
  serverId: SERVER_ID,
  image: 'itzg/minecraft-server:java21',
  env: ['EULA=TRUE', 'RCON_PASSWORD=secret-one', 'TYPE=PAPER'],
  hostPort: 25570,
  limits: toDockerLimits({ heapMb: 2048, cpuMillis: 1500 }),
  startPeriodSec: 300,
  stopTimeoutSec: 60,
  readOnlyRootfs: true,
  ...overrides,
});
const safe = () => buildCreateOptions(runtimeSpec(), host);

describe('names', () => {
  it('derives container and volume names from the UUID only', () => {
    expect(containerName(SERVER_ID)).toBe(`hm-mc-${SERVER_ID}`);
    expect(volumeName(SERVER_ID.toUpperCase())).toBe(`hm-data-${SERVER_ID}`);
  });

  it.each(['../../etc', 'meu-mundo', '', `${SERVER_ID}/x`])('rejects %j', (id) => {
    expect(() => volumeName(id)).toThrow(InvalidServerIdError);
  });
});

describe('toDockerLimits', () => {
  it('adds JVM overhead, disables swap math and converts CPU to nanos', () => {
    expect(toDockerLimits({ heapMb: 4096, cpuMillis: 2000 })).toEqual({
      memoryBytes: (4096 + 1024) * 1024 * 1024,
      nanoCpus: 2_000_000_000,
      pidsLimit: 1024,
      heapEnv: '4096M',
    });
    expect(toDockerLimits({ heapMb: 1024, cpuMillis: 500 }).memoryBytes).toBe((1024 + 512) * 1024 * 1024);
  });

  it.each([
    [{ heapMb: 999_999, cpuMillis: 1000 }],
    [{ heapMb: 2048.5, cpuMillis: 1000 }],
    [{ heapMb: 2048, cpuMillis: 333.33 }],
    [{ heapMb: 2048, cpuMillis: 1000, pids: 0 }],
    [{ heapMb: Number.NaN, cpuMillis: 1000 }],
  ])('rejects %j', (r) => {
    expect(() => toDockerLimits(r)).toThrow(InvalidResourceError);
  });
});

describe('buildCreateOptions', () => {
  it('produces options that pass the policy', () => {
    expect(() => assertSafeCreateOptions(safe())).not.toThrow();
  });

  it('applies the hardened defaults', () => {
    const o = safe();
    expect(o).toMatchObject({ name: `hm-mc-${SERVER_ID}`, User: '1000:1000', Tty: false, OpenStdin: false });
    expect(o.HostConfig).toMatchObject({
      Privileged: false,
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges:true'],
      ReadonlyRootfs: true,
      NetworkMode: 'hm-mc',
      RestartPolicy: { Name: 'no' },
      PortBindings: { '25565/tcp': [{ HostIp: '0.0.0.0', HostPort: '25570' }] },
      Mounts: [{ Type: 'volume', Source: `hm-data-${SERVER_ID}`, Target: '/data', ReadOnly: false }],
    });
    expect(o.HostConfig?.MemorySwap).toBe(o.HostConfig?.Memory);
    expect(o.HostConfig?.BlkioWeight).toBe(300);
  });

  it('omits the IO weight where the host cannot enforce it', () => {
    const o = buildCreateOptions(runtimeSpec(), { ...host, ioWeight: undefined });
    expect(o.HostConfig).not.toHaveProperty('BlkioWeight');
    expect(() => assertSafeCreateOptions(o)).not.toThrow();
  });

  it('keeps secrets out of the spec hash', () => {
    const a = specHash(runtimeSpec(), host);
    const b = specHash(runtimeSpec({ env: ['EULA=TRUE', 'RCON_PASSWORD=another', 'TYPE=PAPER'] }), host);
    const c = specHash(runtimeSpec({ hostPort: 25571 }), host);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(JSON.stringify(safe().Labels)).not.toContain('secret-one');
  });
});

type Mutation = (o: ContainerCreateOptions) => void;
const hc = (o: ContainerCreateOptions) => o.HostConfig as Record<string, unknown>;

// One case per rule: each unsafe option must be rejected on its own.
const VIOLATIONS: [string, Mutation][] = [
  ['privileged', (o) => void (hc(o).Privileged = true)],
  ['CapAdd', (o) => void (hc(o).CapAdd = ['SYS_ADMIN'])],
  ['partial CapDrop', (o) => void (hc(o).CapDrop = ['NET_RAW'])],
  ['seccomp unconfined', (o) => void (hc(o).SecurityOpt = ['no-new-privileges:true', 'seccomp=unconfined'])],
  ['missing no-new-privileges', (o) => void (hc(o).SecurityOpt = [])],
  ['host network', (o) => void (hc(o).NetworkMode = 'host')],
  ['container network', (o) => void (hc(o).NetworkMode = `container:${OTHER_ID}`)],
  ['host pid namespace', (o) => void (hc(o).PidMode = 'host')],
  ['host ipc namespace', (o) => void (hc(o).IpcMode = 'host')],
  ['userns host', (o) => void (hc(o).UsernsMode = 'host')],
  ['devices', (o) => void (hc(o).Devices = [{ PathOnHost: '/dev/kmsg', PathInContainer: '/dev/kmsg', CgroupPermissions: 'rwm' }])],
  ['sysctls', (o) => void (hc(o).Sysctls = { 'net.ipv4.ip_forward': '1' })],
  ['binds', (o) => void (hc(o).Binds = ['/:/host'])],
  ['docker socket mount', (o) => void (hc(o).Mounts = [{ Type: 'bind', Source: '/var/run/docker.sock', Target: '/data' }])],
  ['another server volume', (o) => void (hc(o).Mounts = [{ Type: 'volume', Source: volumeName(OTHER_ID), Target: '/data' }])],
  ['second mount', (o) => void (hc(o).Mounts = [...(o.HostConfig!.Mounts ?? []), { Type: 'volume', Source: 'x', Target: '/x' }])],
  ['volume driver options', (o) => void (o.HostConfig!.Mounts![0]!.VolumeOptions = { NoCopy: false, Labels: {}, DriverConfig: { Name: 'local', Options: { device: '/etc' } } })],
  ['restart always', (o) => void (hc(o).RestartPolicy = { Name: 'always' })],
  ['rcon port published', (o) => void (hc(o).PortBindings = { '25565/tcp': [{ HostIp: '0.0.0.0', HostPort: '25570' }], '25575/tcp': [{ HostPort: '25575' }] })],
  ['publish all ports', (o) => void (hc(o).PublishAllPorts = true)],
  ['privileged host port', (o) => void (hc(o).PortBindings = { '25565/tcp': [{ HostIp: '0.0.0.0', HostPort: '22' }] })],
  ['swap allowed', (o) => void (hc(o).MemorySwap = -1)],
  ['no memory limit', (o) => void (hc(o).Memory = 0)],
  ['float cpu', (o) => void (hc(o).NanoCpus = 1.5)],
  ['unlimited pids', (o) => void (hc(o).PidsLimit = -1)],
  ['oom kill disabled', (o) => void (hc(o).OomKillDisable = true)],
  ['uncapped logs', (o) => void (hc(o).LogConfig = { Type: 'json-file' })],
  ['root user', (o) => void (o.User = '0:0')],
  ['named user', (o) => void (o.User = 'root')],
  ['uid outside userns range', (o) => void (o.User = '70000:70000')],
  ['foreign image', (o) => void (o.Image = 'evil/miner:latest')],
  ['floating latest tag', (o) => void (o.Image = 'itzg/minecraft-server:latest')],
  ['entrypoint override', (o) => void (Object.assign(o, { Entrypoint: ['sh', '-c', 'id'] }))],
  ['cmd override', (o) => void (Object.assign(o, { Cmd: ['sh'] }))],
  ['newline in env', (o) => void (o.Env = ['MOTD=a\nJVM_OPTS=x'])],
  ['name/label mismatch', (o) => void (o.name = containerName(OTHER_ID))],
  ['non-uuid label', (o) => void (o.Labels![`com.hubmine.server-id`] = '../x')],
  ['extra label', (o) => void (o.Labels!['traefik.enable'] = 'true')],
  ['tty', (o) => void (o.Tty = true)],
  ['out-of-range io weight', (o) => void (hc(o).BlkioWeight = 5000)],
];

describe('assertSafeCreateOptions', () => {
  it.each(VIOLATIONS)('rejects %s', (_, mutate) => {
    const options = safe();
    mutate(options);
    expect(() => assertSafeCreateOptions(options)).toThrow(ContainerPolicyViolation);
  });
});
