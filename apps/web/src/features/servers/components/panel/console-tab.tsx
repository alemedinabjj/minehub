"use client";

import type { ServerDetails } from "@hubmine/shared";
import { CONSOLE_COMMAND_MAX } from "@hubmine/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowDown, SendHorizontal } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ApiRequestError } from "@/lib/api/http";
import { serversApi } from "../../servers-api";

const LIVE = new Set(["ONLINE", "STARTING", "STOPPING"]);

/**
 * Live server log + RCON command line. Logs are polled (bounded tail) while the server runs;
 * auto-scroll pauses when the user scrolls up. Everything renders as text, never HTML.
 */
export function ConsoleTab({ server }: { server: ServerDetails }) {
  const live = LIVE.has(server.status);
  const logs = useQuery({
    queryKey: ["server", server.id, "logs"],
    queryFn: ({ signal }) => serversApi.logs(server.id, 300, signal),
    enabled: server.status !== "CREATING" && server.status !== "DELETED",
    refetchInterval: live ? 2_000 : false,
    retry: false,
  });

  const scroller = useRef<HTMLDivElement>(null);
  const [stick, setStick] = useState(true);
  const lines = logs.data?.lines ?? [];
  const lastLine = lines.at(-1);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick) el.scrollTop = el.scrollHeight;
  }, [lines.length, lastLine, stick]);

  return (
    <div className="flex h-full min-h-[420px] flex-col gap-3 p-4 sm:p-6">
      <div className="relative min-h-0 flex-1">
        <div
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget;
            setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
          }}
          role="log"
          aria-label="Log do servidor"
          aria-live="off"
          tabIndex={0}
          className="h-full overflow-auto rounded-md border border-border bg-[#0a0c10] p-3 font-mono text-xs leading-relaxed text-[#cfd6e2] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          {logs.isPending && logs.fetchStatus !== "idle" ? (
            <p className="text-muted">Carregando log…</p>
          ) : logs.isError ? (
            <p className="text-muted">{logs.error instanceof ApiRequestError ? logs.error.message : "Não foi possível ler o log agora."}</p>
          ) : lines.length === 0 ? (
            <p className="text-muted">{server.status === "CREATING" ? "O log aparece quando o servidor começar a ligar." : "Nada no log ainda."}</p>
          ) : (
            lines.map((line, i) => (
              <div key={`${i}-${line.length}`} className={`whitespace-pre-wrap break-all ${/WARN/.test(line) ? "text-warning" : /ERROR|Exception/.test(line) ? "text-danger" : ""}`}>
                {line}
              </div>
            ))
          )}
        </div>
        {!stick ? (
          <button
            type="button"
            onClick={() => setStick(true)}
            className="absolute bottom-3 right-5 inline-flex items-center gap-1.5 rounded-sm border border-border bg-surface-raised px-3 py-1.5 text-xs text-foreground shadow-raised"
          >
            <ArrowDown className="size-3.5" aria-hidden /> Ir para o fim
          </button>
        ) : null}
      </div>
      <CommandLine serverId={server.id} online={server.status === "ONLINE"} />
    </div>
  );
}

function CommandLine({ serverId, online }: { serverId: string; online: boolean }) {
  const [value, setValue] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [cursor, setCursor] = useState(-1);
  const [last, setLast] = useState<{ command: string; output: string; failed: boolean } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const run = useMutation({
    mutationFn: (command: string) => serversApi.console(serverId, command),
    onSuccess: (res, command) => setLast({ command, output: res.output || "(sem resposta)", failed: false }),
    onError: (err, command) => setLast({ command, output: err instanceof ApiRequestError ? err.message : "Não foi possível enviar o comando.", failed: true }),
  });

  useEffect(() => {
    if (!run.isPending) input.current?.focus();
  }, [run.isPending]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const command = value.trim().replace(/^\//, "");
    if (!command || run.isPending) return;
    setHistory((h) => [command, ...h.filter((c) => c !== command)].slice(0, 50));
    setCursor(-1);
    setValue("");
    run.mutate(command);
  };

  return (
    <div className="shrink-0 space-y-2">
      {last ? (
        <div role="status" className={`rounded-sm border px-3 py-2 font-mono text-xs ${last.failed ? "border-warning/40 bg-warning/10" : "border-border bg-surface"}`}>
          <span className="text-muted">&gt; {last.command}</span>
          <pre className="mt-1 whitespace-pre-wrap break-all text-foreground">{last.output}</pre>
        </div>
      ) : null}
      <form onSubmit={submit} className="flex gap-2">
        <label htmlFor="console-input" className="sr-only">
          Comando do servidor
        </label>
        <div className="flex min-w-0 flex-1 items-center rounded-sm border border-border bg-background focus-within:ring-2 focus-within:ring-accent">
          <span className="pl-3 font-mono text-sm text-muted" aria-hidden>
            /
          </span>
          <input
            id="console-input"
            ref={input}
            value={value}
            maxLength={CONSOLE_COMMAND_MAX}
            disabled={!online}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowUp" && history.length) {
                e.preventDefault();
                const next = Math.min(history.length - 1, cursor + 1);
                setCursor(next);
                setValue(history[next] ?? "");
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                const next = cursor - 1;
                setCursor(Math.max(-1, next));
                setValue(next >= 0 ? (history[next] ?? "") : "");
              }
            }}
            placeholder={online ? "say Olá a todos · time set day · weather clear" : "Ligue o servidor para enviar comandos"}
            autoComplete="off"
            spellCheck={false}
            className="h-11 min-w-0 flex-1 bg-transparent px-2 font-mono text-sm text-foreground outline-none placeholder:text-muted disabled:cursor-not-allowed"
          />
        </div>
        <Button type="submit" disabled={!online || !value.trim()} loading={run.isPending} aria-label="Enviar comando">
          <SendHorizontal className="size-4" aria-hidden />
          <span className="hidden sm:inline">Enviar</span>
        </Button>
      </form>
    </div>
  );
}
