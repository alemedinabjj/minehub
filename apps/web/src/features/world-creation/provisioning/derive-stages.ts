import type { Operation, ServerEvent, ServerSummary } from "@hubmine/shared";

/**
 * Visual creation stages. Each one is backed by an observable backend fact;
 * nothing advances on a timer. Stages the backend cannot observe are not shown.
 */
export const PROVISIONING_STAGES = ["RESERVING", "PREPARING", "DOWNLOADING", "BUILDING", "STARTING", "ONLINE"] as const;
export type ProvisioningStage = (typeof PROVISIONING_STAGES)[number];

export type StageState = "done" | "current" | "pending" | "failed";

export interface ProvisioningView {
  stages: Array<{ id: ProvisioningStage; state: StageState }>;
  phase: "in-progress" | "ready" | "failed";
  current: ProvisioningStage;
  error: { code: string; message: string } | null;
}

export interface ProvisioningSnapshot {
  server: ServerSummary | null;
  operation: Operation | null;
  events: ServerEvent[];
}

const STAGE_EVIDENCE: Record<Exclude<ProvisioningStage, "RESERVING" | "ONLINE">, string> = {
  PREPARING: "PROVISION_STORAGE_READY",
  DOWNLOADING: "PROVISION_IMAGE_READY",
  BUILDING: "PROVISION_CONTAINER_CREATED",
  STARTING: "__ONLINE__", // completed only by status ONLINE (health check passed)
};

export function deriveProvisioningView({ server, operation, events }: ProvisioningSnapshot): ProvisioningView {
  const seen = new Set(events.map((e) => e.type));
  const running = server?.status === "ONLINE";
  const failed = operation?.status === "FAILED" || operation?.status === "CANCELLED" || server?.status === "ERROR";

  const done = new Set<ProvisioningStage>();
  if (running || seen.size > 0 || (operation && operation.status !== "PENDING" && operation.status !== "QUEUED")) {
    done.add("RESERVING");
  }
  for (const [stage, evidence] of Object.entries(STAGE_EVIDENCE) as Array<[ProvisioningStage, string]>) {
    if (seen.has(evidence) || running) done.add(stage);
  }
  if (running) done.add("ONLINE");

  // A later milestone implies the earlier ones (e.g. a retry that reuses an existing container).
  let lastDone = -1;
  PROVISIONING_STAGES.forEach((stage, i) => {
    if (done.has(stage)) lastDone = i;
  });
  for (let i = 0; i < lastDone; i++) done.add(PROVISIONING_STAGES[i]!);

  const current = PROVISIONING_STAGES.find((s) => !done.has(s)) ?? "ONLINE";
  const phase: ProvisioningView["phase"] = running ? "ready" : failed ? "failed" : "in-progress";

  return {
    stages: PROVISIONING_STAGES.map((id) => ({
      id,
      state: done.has(id) ? "done" : id === current ? (phase === "failed" ? "failed" : "current") : "pending",
    })),
    phase,
    current,
    error: failed ? (operation?.error ?? { code: "PROVISIONING_FAILED", message: "" }) : null,
  };
}
