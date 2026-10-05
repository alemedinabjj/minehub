/**
 * Deterministic Docker identity derived only from the server UUID: never from names or slugs.
 * See secure-docker-provisioning.
 */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class InvalidServerIdError extends Error {
  constructor() {
    super('invalid server id');
    this.name = 'InvalidServerIdError';
  }
}

function checkedId(serverId: string): string {
  if (!UUID_RE.test(serverId)) throw new InvalidServerIdError();
  return serverId.toLowerCase();
}

export const containerName = (serverId: string) => `hm-mc-${checkedId(serverId)}`;
export const volumeName = (serverId: string) => `hm-data-${checkedId(serverId)}`;

/** Bridge network for tenant containers, created with inter-container communication disabled. */
export const MINECRAFT_NETWORK = 'hm-mc';

export const LABELS = {
  managed: 'com.hubmine.managed',
  serverId: 'com.hubmine.server-id',
  specHash: 'com.hubmine.spec-hash',
} as const;

/** The port the game listens on inside every container; only the host port varies. */
export const GAME_PORT = '25565/tcp';
