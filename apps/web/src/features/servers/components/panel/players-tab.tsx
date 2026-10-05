"use client";

import { playerNameSchema, type PlayerAction, type ServerDetails } from "@hubmine/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Crown, DoorOpen, UserPlus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ApiRequestError } from "@/lib/api/http";
import { serversApi } from "../../servers-api";

const ACTION_LABEL: Record<PlayerAction, string> = {
  kick: "Expulsar",
  ban: "Banir",
  pardon: "Desbanir",
  op: "Tornar operador",
  deop: "Remover operador",
  whitelist_add: "Adicionar à whitelist",
  whitelist_remove: "Remover da whitelist",
};

export function PlayersTab({ server }: { server: ServerDetails }) {
  const online = server.status === "ONLINE";
  const queryClient = useQueryClient();
  const players = useQuery({
    queryKey: ["server", server.id, "players"],
    queryFn: ({ signal }) => serversApi.players(server.id, signal),
    enabled: online,
    refetchInterval: 5_000,
    retry: false,
  });
  const [feedback, setFeedback] = useState<{ text: string; failed: boolean } | null>(null);
  const act = useMutation({
    mutationFn: (req: { action: PlayerAction; player: string }) => serversApi.playerAction(server.id, req),
    onSuccess: (res, req) => {
      setFeedback({ text: `${ACTION_LABEL[req.action]} · ${req.player}: ${res.output || "feito"}`, failed: false });
      void queryClient.invalidateQueries({ queryKey: ["server", server.id, "players"] });
    },
    onError: (err) => setFeedback({ text: err instanceof ApiRequestError ? err.message : "Não foi possível concluir.", failed: true }),
  });

  if (!online) {
    return (
      <div className="p-4 sm:p-6">
        <p className="rounded-md border border-border bg-surface p-4 text-sm text-muted">Ligue o servidor para ver e gerenciar os jogadores.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-6 p-4 sm:p-6 xl:grid-cols-[1fr_380px]">
      <section aria-labelledby="online-title" className="rounded-md border border-border bg-surface">
        <h2 id="online-title" className="flex items-center justify-between border-b border-border px-4 py-3 text-sm font-semibold text-foreground">
          Jogadores online
          {players.data ? (
            <span className="font-normal tabular-nums text-muted">
              {players.data.online} de {players.data.max}
            </span>
          ) : null}
        </h2>
        {players.isPending ? (
          <p className="p-4 text-sm text-muted">Carregando…</p>
        ) : players.isError ? (
          <p className="p-4 text-sm text-muted">{players.error instanceof ApiRequestError ? players.error.message : "Não foi possível consultar os jogadores."}</p>
        ) : players.data.players.length === 0 ? (
          <p className="p-4 text-sm text-muted">Ninguém online agora.</p>
        ) : (
          <ul className="divide-y divide-border">
            {players.data.players.map((name) => (
              <li key={name} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                <span className="font-mono text-sm text-foreground">{name}</span>
                <span className="flex flex-wrap gap-1">
                  <IconAction label={`Tornar ${name} operador`} icon={Crown} onClick={() => act.mutate({ action: "op", player: name })} />
                  <IconAction label={`Expulsar ${name}`} icon={DoorOpen} onClick={() => act.mutate({ action: "kick", player: name })} />
                  <IconAction label={`Banir ${name}`} icon={Ban} danger onClick={() => act.mutate({ action: "ban", player: name })} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="space-y-4">
        <ManageByName pending={act.isPending} onRun={(req) => act.mutate(req)} />
        {!server.settings.onlineMode ? (
          <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-foreground">
            Este servidor aceita contas não originais: nomes não são verificados. Cuidado ao dar operador ou liberar na whitelist por nome.
          </p>
        ) : null}
        {feedback ? (
          <p role="status" className={`rounded-sm border px-3 py-2 font-mono text-xs ${feedback.failed ? "border-warning/40 bg-warning/10" : "border-border bg-surface"} text-foreground`}>
            {feedback.text}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function IconAction({ label, icon: Icon, onClick, danger = false }: { label: string; icon: typeof Ban; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label} className={`grid size-11 place-items-center rounded-sm hover:bg-surface-raised ${danger ? "text-danger" : "text-muted hover:text-foreground"}`}>
      <Icon className="size-4" aria-hidden />
    </button>
  );
}

function ManageByName({ pending, onRun }: { pending: boolean; onRun: (req: { action: PlayerAction; player: string }) => void }) {
  const [player, setPlayer] = useState("");
  const [action, setAction] = useState<PlayerAction>("whitelist_add");
  const valid = playerNameSchema.safeParse(player.trim()).success;
  const showError = player.length > 0 && !valid;

  return (
    <section aria-labelledby="manage-title" className="space-y-3 rounded-md border border-border bg-surface p-4">
      <h2 id="manage-title" className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <UserPlus className="size-4" aria-hidden /> Gerenciar por nome
      </h2>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onRun({ action, player: player.trim() });
        }}
      >
        <label className="block space-y-1.5 text-sm">
          <span className="font-medium text-foreground">Nome do jogador</span>
          <input
            value={player}
            onChange={(e) => setPlayer(e.target.value)}
            maxLength={16}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={showError}
            aria-describedby="player-hint"
            className="h-11 w-full rounded-sm border border-border bg-background px-3 font-mono text-foreground outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          <span id="player-hint" className={`block text-xs ${showError ? "text-danger" : "text-muted"}`}>
            De 1 a 16 caracteres: letras, números e _.
          </span>
        </label>
        <label className="block space-y-1.5 text-sm">
          <span className="font-medium text-foreground">Ação</span>
          <select value={action} onChange={(e) => setAction(e.target.value as PlayerAction)} className="h-11 w-full rounded-sm border border-border bg-background px-3 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-accent">
            {(Object.keys(ACTION_LABEL) as PlayerAction[]).map((a) => (
              <option key={a} value={a}>
                {ACTION_LABEL[a]}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" variant="secondary" disabled={!valid} loading={pending} className="w-full">
          Aplicar
        </Button>
      </form>
    </section>
  );
}
