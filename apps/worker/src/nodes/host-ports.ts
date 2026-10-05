import { createServer } from 'node:net';

/**
 * True when nothing on this host listens on `ip:port` yet (e.g. the owner's own Minecraft on
 * 25565). Docker would otherwise fail the start with "port is already allocated".
 */
export function isHostPortFree(ip: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.listen({ host: ip, port, exclusive: true }, () => probe.close(() => resolve(true)));
  });
}
