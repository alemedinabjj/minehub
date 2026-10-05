import type { ServerStatus } from "@hubmine/shared";

export type StatusTone = "success" | "warning" | "neutral" | "info" | "danger";

/** Exactly the backend ServerStatus (minecraft-ui-design status table); never invented states. */
export const STATUS_META: Record<ServerStatus, { label: string; tone: StatusTone; busy: boolean }> = {
  ONLINE: { label: "Online", tone: "success", busy: false },
  STARTING: { label: "Iniciando", tone: "warning", busy: true },
  CREATING: { label: "Criando", tone: "warning", busy: true },
  STOPPING: { label: "Parando", tone: "warning", busy: true },
  STOPPED: { label: "Parado", tone: "neutral", busy: false },
  SUSPENDED: { label: "Hibernando", tone: "info", busy: false },
  CRASHED: { label: "Caiu", tone: "danger", busy: false },
  ERROR: { label: "Erro", tone: "danger", busy: false },
  DELETING: { label: "Excluindo", tone: "danger", busy: true },
  DELETED: { label: "Excluído", tone: "neutral", busy: false },
};

/** Statuses the worker is still converging: poll fast while any server is in one. */
export const isTransitional = (status: ServerStatus) => STATUS_META[status].busy;

export type ServerAction = "start" | "stop" | "restart" | "delete";

/**
 * Mirrors the API's transition rules (apps/api servers.service ACTIONS), so buttons are
 * disabled with an explanation instead of failing. The API remains the authority (409).
 */
const ACTION_FROM: Record<ServerAction, readonly ServerStatus[]> = {
  start: ["STOPPED", "SUSPENDED", "ERROR", "CRASHED"],
  stop: ["ONLINE", "STARTING"],
  restart: ["ONLINE"],
  delete: ["CREATING", "STARTING", "ONLINE", "STOPPING", "STOPPED", "SUSPENDED", "CRASHED", "ERROR"],
};

export const canRun = (action: ServerAction, status: ServerStatus) => ACTION_FROM[action].includes(status);

/** Why an action is unavailable, for the disabled button's description. */
export function unavailableReason(action: ServerAction, status: ServerStatus): string {
  if (status === "CREATING") return "Aguarde a criação terminar.";
  if (isTransitional(status)) return "Aguarde a operação atual terminar.";
  if (action === "start") return "O servidor já está ligado.";
  if (action === "stop" || action === "restart") return "O servidor não está ligado.";
  return "Indisponível agora.";
}

/** Sanitized `statusReason` codes from the worker → copy. Unknown codes get a generic line. */
const REASON_COPY: Record<string, string> = {
  START_TIMEOUT: "O servidor demorou demais para ficar pronto.",
  SERVER_EXITED: "O servidor encerrou sozinho enquanto iniciava.",
  OUT_OF_MEMORY: "O servidor ficou sem memória. Tente aumentar a RAM.",
  NODE_CAPACITY: "Não há memória livre suficiente nesta máquina.",
  NO_PORT_AVAILABLE: "Não há portas livres para o servidor.",
  IMAGE_PULL_FAILED: "Não foi possível baixar o Minecraft. Verifique a conexão.",
  DOCKER_UNAVAILABLE: "O Docker não está respondendo nesta máquina.",
  DOCKER_INSECURE: "O Docker desta máquina não está configurado com isolamento seguro.",
  INVALID_CONFIGURATION: "A configuração do servidor é inválida.",
};

export const reasonCopy = (reason: string | null) => (reason ? (REASON_COPY[reason] ?? "Algo deu errado com o servidor.") : null);

export const SOFTWARE_LABEL: Record<string, string> = {
  VANILLA: "Vanilla",
  PAPER: "Paper",
  PURPUR: "Purpur",
  FABRIC: "Fabric",
  FORGE: "Forge",
  NEOFORGE: "NeoForge",
};
