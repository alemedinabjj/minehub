"use client";

import { formatServerAddress, type ServerDetails } from "@hubmine/shared";
import { useQuery } from "@tanstack/react-query";
import { Cpu, MemoryStick, Users } from "lucide-react";
import { serversApi } from "../../servers-api";
import { SOFTWARE_LABEL } from "../../status";

const dateFmt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" });
const gb = (mb: number) => `${(mb / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} GB`;

export function OverviewTab({ server }: { server: ServerDetails }) {
  const online = server.status === "ONLINE";
  const stats = useQuery({
    queryKey: ["server", server.id, "stats"],
    queryFn: ({ signal }) => serversApi.stats(server.id, signal),
    enabled: online,
    refetchInterval: 5_000,
    retry: false,
  });
  const players = useQuery({
    queryKey: ["server", server.id, "players"],
    queryFn: ({ signal }) => serversApi.players(server.id, signal),
    enabled: online,
    refetchInterval: 5_000,
    retry: false,
  });

  const memPct = stats.data && stats.data.memoryLimitMb > 0 ? Math.min(100, (stats.data.memoryUsedMb / stats.data.memoryLimitMb) * 100) : 0;
  const offline = <span className="text-muted">Servidor desligado</span>;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="grid gap-3 md:grid-cols-3">
        <Metric icon={MemoryStick} label="Memória em uso">
          {!online ? offline : stats.data ? (
            <>
              <p className="text-2xl font-semibold tabular-nums text-foreground">
                {gb(stats.data.memoryUsedMb)} <span className="text-base font-normal text-muted">de {gb(stats.data.memoryLimitMb)}</span>
              </p>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-raised" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(memPct)} aria-label="Uso de memória">
                {/* A JVM normally sits close to its limit (heap + overhead): only near-OOM is alarming. */}
                <div className={`h-full ${memPct > 97 ? "bg-danger" : "bg-accent"}`} style={{ width: `${memPct}%` }} />
              </div>
            </>
          ) : (
            <Loading failed={stats.isError} />
          )}
        </Metric>
        <Metric icon={Cpu} label="Processador">
          {!online ? offline : stats.data ? (
            <p className="text-2xl font-semibold tabular-nums text-foreground">
              {stats.data.cpuPercent.toLocaleString("pt-BR")}%{" "}
              <span className="text-base font-normal text-muted">de {(server.cpuMillis / 1000).toLocaleString("pt-BR")} vCPU</span>
            </p>
          ) : (
            <Loading failed={stats.isError} />
          )}
        </Metric>
        <Metric icon={Users} label="Jogadores online">
          {!online ? offline : players.data ? (
            <>
              <p className="text-2xl font-semibold tabular-nums text-foreground">
                {players.data.online} <span className="text-base font-normal text-muted">de {players.data.max}</span>
              </p>
              {players.data.players.length ? <p className="mt-1 truncate text-sm text-muted">{players.data.players.join(", ")}</p> : null}
            </>
          ) : (
            <Loading failed={players.isError} />
          )}
        </Metric>
      </div>

      <section aria-labelledby="info-title" className="rounded-md border border-border bg-surface">
        <h2 id="info-title" className="border-b border-border px-4 py-3 text-sm font-semibold text-foreground">
          Informações
        </h2>
        <dl className="grid gap-x-6 sm:grid-cols-2 xl:grid-cols-3">
          <Info label="Endereço" value={server.address ? formatServerAddress(server.address) : "Disponível após a criação"} mono />
          <Info label="Servidor" value={`${SOFTWARE_LABEL[server.software] ?? server.software}${server.loaderVersion ? ` (loader ${server.loaderVersion})` : ""}`} />
          <Info label="Versão do Minecraft" value={server.minecraftVersion} />
          {server.modpack ? <Info label="Modpack (Modrinth)" value={`${server.modpack.projectId} · ${server.modpack.versionId}`} mono /> : null}
          <Info label="Memória reservada" value={gb(server.heapMb)} />
          <Info label="Processador" value={`${(server.cpuMillis / 1000).toLocaleString("pt-BR")} vCPU`} />
          <Info label="Contas aceitas" value={server.settings.onlineMode ? "Só originais (Microsoft)" : "Originais e não originais (TLauncher)"} />
          <Info label="Criado em" value={dateFmt.format(new Date(server.createdAt))} />
          <Info label="Última vez ligado" value={server.lastStartedAt ? dateFmt.format(new Date(server.lastStartedAt)) : "Nunca"} />
        </dl>
      </section>
    </div>
  );
}

function Metric({ icon: Icon, label, children }: { icon: typeof Cpu; label: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-border bg-surface p-4">
      <h2 className="mb-2 flex items-center gap-2 text-sm text-muted">
        <Icon className="size-4" aria-hidden /> {label}
      </h2>
      {children}
    </section>
  );
}

function Loading({ failed }: { failed: boolean }) {
  return failed ? <span className="text-sm text-muted">Indisponível no momento</span> : <span className="block h-8 w-24 animate-pulse rounded-sm bg-surface-raised motion-reduce:animate-none" aria-label="Carregando" />;
}

function Info({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="border-b border-border px-4 py-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`mt-0.5 break-all text-sm text-foreground ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}
