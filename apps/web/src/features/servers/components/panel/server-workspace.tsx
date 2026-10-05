"use client";

import type { ServerDetails } from "@hubmine/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Play, RotateCw, Square } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { ApiRequestError } from "@/lib/api/http";
import { serversApi } from "../../servers-api";
import { canRun, isTransitional, reasonCopy, SOFTWARE_LABEL, unavailableReason, type ServerAction } from "../../status";
import { CopyAddress } from "../copy-address";
import { ServerStatusBadge } from "../server-status-badge";
import { ConsoleTab } from "./console-tab";
import { HistoryTab } from "./history-tab";
import { OverviewTab } from "./overview-tab";
import { PlayersTab } from "./players-tab";
import { SettingsTab } from "./settings-tab";

const TABS = [
  { id: "overview", label: "Visão geral" },
  { id: "console", label: "Console" },
  { id: "players", label: "Jogadores" },
  { id: "settings", label: "Configurações" },
  { id: "history", label: "Histórico" },
] as const;
export type TabId = (typeof TABS)[number]["id"];

export function useServerDetails(serverId: string) {
  return useQuery({
    queryKey: ["server", serverId, "details"],
    queryFn: ({ signal }) => serversApi.details(serverId, signal),
    staleTime: 0,
    retry: (count, err) => !(err instanceof ApiRequestError && err.status === 404) && count < 2,
    refetchInterval: (q) => (q.state.error ? false : q.state.data && isTransitional(q.state.data.status) ? 2_000 : 8_000),
  });
}

export function ServerWorkspace({ serverId, justCreated }: { serverId: string; justCreated: boolean }) {
  const details = useServerDetails(serverId);
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const tab: TabId = TABS.some((t) => t.id === search.get("tab")) ? (search.get("tab") as TabId) : "overview";

  const selectTab = (id: TabId) => {
    const params = new URLSearchParams(search);
    params.set("tab", id);
    params.delete("created");
    router.replace(`${pathname}?${params}`, { scroll: false });
  };

  if (details.isPending) {
    return (
      <div className="space-y-4 p-6" aria-busy="true" aria-label="Carregando servidor">
        <div className="h-9 w-1/3 animate-pulse rounded-sm bg-surface motion-reduce:animate-none" />
        <div className="h-10 w-2/3 animate-pulse rounded-sm bg-surface motion-reduce:animate-none" />
        <div className="h-64 animate-pulse rounded-md bg-surface motion-reduce:animate-none" />
      </div>
    );
  }
  if (details.isError) {
    const notFound = details.error instanceof ApiRequestError && details.error.status === 404;
    return (
      <div role="alert" className="space-y-3 p-6">
        <h1 className="text-2xl font-semibold">{notFound ? "Não encontramos esse mundo." : "Não conseguimos carregar esse servidor."}</h1>
        <p className="text-muted">{notFound ? "Ele pode ter sido excluído ou você não tem acesso a ele." : "Verifique sua conexão e tente de novo."}</p>
        {notFound ? (
          <Link href="/servers" className="text-accent underline">
            Ver meus servidores
          </Link>
        ) : (
          <Button variant="secondary" onClick={() => details.refetch()}>
            Tentar de novo
          </Button>
        )}
      </div>
    );
  }

  const server = details.data;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ServerHeader server={server} justCreated={justCreated} />
      <div role="tablist" aria-label="Seções do servidor" className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-4 sm:px-6">
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => selectTab(t.id)}
            onKeyDown={(e) => {
              if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
              const next = (i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length;
              selectTab(TABS[next]!.id);
              tabRefs.current[next]?.focus();
            }}
            className={`-mb-px shrink-0 border-b-2 px-3 py-3 text-sm font-medium ${tab === t.id ? "border-primary text-foreground" : "border-transparent text-muted hover:text-foreground"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="min-h-0 flex-1 overflow-y-auto">
        {tab === "overview" ? <OverviewTab server={server} /> : null}
        {tab === "console" ? <ConsoleTab server={server} /> : null}
        {tab === "players" ? <PlayersTab server={server} /> : null}
        {tab === "settings" ? <SettingsTab key={server.id} server={server} /> : null}
        {tab === "history" ? <HistoryTab serverId={server.id} /> : null}
      </div>
    </div>
  );
}

export function useServerAction(serverId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (a: ServerAction) => serversApi.run(serverId, a),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["servers"] });
      void queryClient.invalidateQueries({ queryKey: ["server", serverId] });
    },
  });
}

function ServerHeader({ server, justCreated }: { server: ServerDetails; justCreated: boolean }) {
  const action = useServerAction(server.id);
  const status = server.status;
  const problem = status === "ERROR" || status === "CRASHED" ? (reasonCopy(server.statusReason) ?? "Algo deu errado com o servidor.") : null;
  const actionError = action.error instanceof ApiRequestError ? action.error.message : action.error ? "Não foi possível concluir a ação." : null;
  const busy = action.isPending ? action.variables : null;
  const showStop = canRun("stop", status) || status === "STOPPING";

  const button = (a: "start" | "stop" | "restart", label: string, Icon: typeof Play, variant: "primary" | "secondary") => {
    const allowed = canRun(a, status);
    return (
      <Button variant={variant} onClick={() => action.mutate(a)} disabled={!allowed || action.isPending} loading={busy === a} title={allowed ? undefined : unavailableReason(a, status)}>
        <Icon className="size-4" aria-hidden />
        {label}
      </Button>
    );
  };

  return (
    <header className="shrink-0 space-y-3 border-b border-border px-4 py-4 sm:px-6">
      {justCreated && status === "ONLINE" ? <p className="text-sm font-medium text-accent">Seu mundo está pronto. Bom jogo!</p> : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="truncate font-display text-2xl text-foreground sm:text-3xl">{server.name}</h1>
            <div aria-live="polite">
              <ServerStatusBadge status={status} />
            </div>
          </div>
          <p className="text-sm text-muted">
            {SOFTWARE_LABEL[server.software] ?? server.software} · Minecraft {server.minecraftVersion}
            {server.settings.onlineMode ? "" : " · aceita contas não originais"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {server.address ? (
            <div className="rounded-sm border border-border bg-surface pl-3">
              <CopyAddress address={server.address} size="sm" />
            </div>
          ) : null}
          {showStop ? button("stop", "Parar", Square, "secondary") : button("start", status === "ERROR" || status === "CRASHED" ? "Tentar de novo" : "Iniciar", Play, "primary")}
          {button("restart", "Reiniciar", RotateCw, "secondary")}
        </div>
      </div>
      {server.restartRequired ? (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-info/40 bg-info/10 px-3 py-2 text-sm">
          <span className="text-foreground">Há configurações salvas que só valem depois de reiniciar o servidor.</span>
          <Button variant="secondary" onClick={() => action.mutate("restart")} disabled={!canRun("restart", status) || action.isPending} loading={busy === "restart"}>
            <RotateCw className="size-4" aria-hidden /> Reiniciar agora
          </Button>
        </div>
      ) : null}
      {problem ? (
        <div role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-foreground">
          {problem} Tente iniciar de novo; se continuar, revise as configurações.
        </div>
      ) : null}
      {actionError ? (
        <div role="alert" className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-foreground">
          {actionError}
        </div>
      ) : null}
      {status === "STARTING" || status === "CREATING" ? (
        <p className="text-sm text-muted">Ligar o servidor pode levar alguns minutos (com mods, mais). Acompanhe pelo Console.</p>
      ) : null}
    </header>
  );
}
