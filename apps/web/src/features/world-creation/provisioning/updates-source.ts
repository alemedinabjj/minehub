import type { ServerEvent } from "@hubmine/shared";
import type { WorldCreationApi } from "../api/types";
import type { ProvisioningSnapshot } from "./derive-stages";

/**
 * Real-time updates for one provisioning operation. Polling today; an SSE adapter
 * (GET /servers/:id/events/stream) can implement the same interface later.
 */
export interface ProvisioningUpdatesSource {
  subscribe(
    target: { serverId: string; operationId: string },
    listener: (snapshot: ProvisioningSnapshot) => void,
    onError: (error: unknown) => void,
  ): () => void;
}

const TERMINAL = new Set(["SUCCEEDED", "FAILED", "CANCELLED"]);

export class PollingUpdatesSource implements ProvisioningUpdatesSource {
  constructor(
    private readonly api: WorldCreationApi,
    private readonly options = { fastMs: 1200, slowMs: 4000, slowAfterMs: 60_000, maxConsecutiveErrors: 5 },
  ) {}

  subscribe(
    { serverId, operationId }: { serverId: string; operationId: string },
    listener: (snapshot: ProvisioningSnapshot) => void,
    onError: (error: unknown) => void,
  ) {
    const controller = new AbortController();
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let events: ServerEvent[] = [];
    let errors = 0;

    const tick = async () => {
      try {
        const after = events.at(-1)?.id ?? null;
        const [server, operation, newEvents] = await Promise.all([
          this.api.getServer(serverId, controller.signal),
          this.api.getOperation(serverId, operationId, controller.signal),
          this.api.listEvents(serverId, after, controller.signal),
        ]);
        if (controller.signal.aborted) return;
        errors = 0;
        events = [...events, ...newEvents];
        listener({ server, operation, events });
        // Stop once the operation is finished and the server reached a settled status.
        if (TERMINAL.has(operation.status) && server.status !== "STARTING" && server.status !== "CREATING") return;
      } catch (error) {
        if (controller.signal.aborted) return;
        errors += 1;
        if (errors >= this.options.maxConsecutiveErrors) {
          onError(error);
          return;
        }
      }
      const delay = Date.now() - startedAt > this.options.slowAfterMs ? this.options.slowMs : this.options.fastMs;
      timer = setTimeout(tick, delay * Math.min(4, 1 + errors));
    };

    void tick();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }
}
