"use client";

import type { ServerEvent } from "@hubmine/shared";
import { useQuery } from "@tanstack/react-query";
import { serversApi } from "../../servers-api";
import { reasonCopy, STATUS_META } from "../../status";

const EVENT_COPY: Record<string, string> = {
  SERVER_CREATED: "Servidor criado",
  SETTINGS_UPDATED: "Configurações alteradas",
  PROVISION_NODE_SELECTED: "Máquina reservada",
  PROVISION_STORAGE_READY: "Espaço do mundo preparado",
  PROVISION_IMAGE_READY: "Minecraft baixado",
  PROVISION_CONTAINER_CREATED: "Servidor montado",
  PROVISION_CONTAINER_STARTED: "Minecraft iniciando",
};

const label = (e: ServerEvent) => (e.type === "STATUS_CHANGED" && e.toStatus ? `Status: ${STATUS_META[e.toStatus].label}` : (EVENT_COPY[e.type] ?? e.type));
const timeFmt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium" });

export function HistoryTab({ serverId }: { serverId: string }) {
  const events = useQuery({
    queryKey: ["server", serverId, "events"],
    queryFn: ({ signal }) => serversApi.events(serverId, signal),
    staleTime: 0,
    refetchInterval: 10_000,
  });

  return (
    <div className="p-4 sm:p-6">
      {events.isPending ? (
        <p className="text-sm text-muted">Carregando…</p>
      ) : events.isError ? (
        <p className="text-sm text-muted">Não foi possível carregar o histórico.</p>
      ) : events.data.length === 0 ? (
        <p className="text-sm text-muted">Nada por aqui ainda.</p>
      ) : (
        <ol className="divide-y divide-border rounded-md border border-border bg-surface">
          {[...events.data].reverse().map((e) => (
            <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5 text-sm">
              <span className="text-foreground">
                {label(e)}
                {e.message ? <span className="text-muted"> · {reasonCopy(e.message)}</span> : null}
              </span>
              <time dateTime={e.createdAt} className="font-mono text-xs tabular-nums text-muted">
                {timeFmt.format(new Date(e.createdAt))}
              </time>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
