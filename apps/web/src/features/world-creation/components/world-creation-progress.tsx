"use client";

import { formatServerAddress, type ServerSummary } from "@hubmine/shared";
import { Check, CircleAlert, Copy, LayoutDashboard, RotateCcw, Sparkles } from "lucide-react";
import * as m from "motion/react-m";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { fadeUp, staggerChildren, transitions } from "@/lib/motion";
import { STAGE_COPY } from "../copy";
import type { ProvisioningView } from "../provisioning/derive-stages";

/** Live creation checklist. Every step reflects backend evidence; no percentages, no timers. */
export function WorldCreationProgress({ view, hasModpack }: { view: ProvisioningView; hasModpack: boolean }) {
  const elapsed = useElapsed();
  return (
    <div className="space-y-5">
      <ol className="space-y-1" aria-label="Progresso da criação">
        {view.stages.map(({ id, state }) => (
          <li key={id} className="flex items-center gap-3 rounded-sm px-2 py-2" aria-current={state === "current" ? "step" : undefined}>
            <StageIcon state={state} />
            <span className={state === "pending" ? "text-muted" : "text-foreground"}>
              {STAGE_COPY[id].label}
              <span className="sr-only">
                {state === "done" ? " — concluído" : state === "current" ? " — em andamento" : state === "failed" ? " — falhou" : " — aguardando"}
              </span>
            </span>
          </li>
        ))}
      </ol>
      <p className="text-sm text-muted" aria-live="polite">
        {STAGE_COPY[view.current].doing} <span className="tabular-nums">({elapsed})</span>
      </p>
      {hasModpack && (view.current === "STARTING" || view.current === "BUILDING") ? (
        <p className="rounded-md border border-border bg-surface/70 p-3 text-sm text-muted">
          Na primeira vez, modpacks baixam todos os mods. Isso pode levar alguns minutos. Pode sair desta tela: a criação continua.
        </p>
      ) : null}
    </div>
  );
}

function StageIcon({ state }: { state: "done" | "current" | "pending" | "failed" }) {
  if (state === "done") {
    return (
      <m.span initial={{ scale: 0.4 }} animate={{ scale: 1, transition: transitions.soft }} className="grid size-6 place-items-center rounded-sm bg-primary text-primary-foreground" aria-hidden>
        <Check className="size-4" strokeWidth={3} />
      </m.span>
    );
  }
  if (state === "failed") {
    return (
      <span className="grid size-6 place-items-center rounded-sm bg-danger text-white" aria-hidden>
        <CircleAlert className="size-4" />
      </span>
    );
  }
  if (state === "current") {
    return (
      <span className="grid size-6 place-items-center" aria-hidden>
        <span className="size-3.5 animate-spin rounded-[2px] border-2 border-accent border-r-transparent motion-reduce:animate-none" />
      </span>
    );
  }
  return <span className="grid size-6 place-items-center" aria-hidden><span className="size-2 rounded-[1px] bg-border" /></span>;
}

function useElapsed() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const t = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function WorldCreationSuccess({ server, onCreateAnother }: { server: ServerSummary; onCreateAnother: () => void }) {
  const address = server.address ? formatServerAddress(server.address) : null;
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <m.div variants={staggerChildren(0.08)} initial="hidden" animate="visible" className="space-y-5">
      <m.p variants={fadeUp} className="inline-flex items-center gap-2 text-sm font-medium text-accent">
        <Sparkles className="size-4" aria-hidden /> Seu mundo nasceu.
      </m.p>
      <m.h2 variants={fadeUp} className="font-display text-4xl leading-none text-foreground">
        {server.name.toUpperCase()}
      </m.h2>
      <m.p variants={fadeUp} className="inline-flex items-center gap-2 rounded-sm bg-success/15 px-2.5 py-1 text-sm font-medium text-success">
        <span className="size-2 rounded-full bg-success" aria-hidden /> Online
      </m.p>
      {address ? (
        <m.div variants={fadeUp} className="rounded-md border border-border bg-surface p-4">
          <p className="text-sm text-muted">Endereço para entrar no Minecraft</p>
          <p className="mt-1 break-all font-mono text-xl text-foreground">{address}</p>
        </m.div>
      ) : null}
      <m.div variants={fadeUp} className="flex flex-wrap gap-3">
        {address ? (
          <Button size="lg" onClick={copy}>
            {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
            {copied ? "Endereço copiado" : "Copiar endereço"}
          </Button>
        ) : null}
        <Link
          href={`/servers/${server.id}?created=1`}
          className="inline-flex h-12 items-center gap-2 rounded-sm border border-border bg-surface-raised px-6 font-medium text-foreground hover:border-muted"
        >
          <LayoutDashboard className="size-4" aria-hidden /> Entrar no painel
        </Link>
      </m.div>
      <m.div variants={fadeUp}>
        <Button variant="ghost" onClick={onCreateAnother}>
          Criar outro mundo
        </Button>
      </m.div>
      <p className="sr-only" role="status">
        Seu mundo {server.name} está online{address ? ` no endereço ${address}` : ""}.
      </p>
    </m.div>
  );
}

export function WorldCreationError({
  error,
  onRetry,
  retrying,
  onEditChoices,
}: {
  error: { code: string; message: string } | null;
  onRetry: () => void;
  retrying: boolean;
  onEditChoices: () => void;
}) {
  return (
    <div role="alert" className="space-y-4 rounded-md border border-danger/40 bg-danger/10 p-4">
      <div>
        <p className="font-semibold text-foreground">Não conseguimos terminar de criar seu mundo.</p>
        <p className="mt-1 text-sm text-muted">O HubMine encontrou um problema enquanto preparava o servidor. Suas escolhas estão salvas.</p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button onClick={onRetry} loading={retrying}>
          <RotateCcw className="size-4" aria-hidden /> Tentar novamente
        </Button>
        <Button variant="ghost" onClick={onEditChoices}>
          Revisar escolhas
        </Button>
      </div>
      {error ? (
        <details className="text-sm text-muted">
          <summary className="cursor-pointer select-none">Ver detalhes</summary>
          <dl className="mt-2 space-y-1 font-mono text-xs">
            <div>
              <dt className="inline">código: </dt>
              <dd className="inline">{error.code}</dd>
            </div>
            {error.message ? (
              <div>
                <dt className="inline">mensagem: </dt>
                <dd className="inline">{error.message}</dd>
              </div>
            ) : null}
          </dl>
        </details>
      ) : null}
    </div>
  );
}
