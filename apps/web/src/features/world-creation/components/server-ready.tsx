"use client";

import { formatServerAddress } from "@hubmine/shared";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, Settings2, Share2, SquareTerminal } from "lucide-react";
import * as m from "motion/react-m";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { fadeUp, staggerChildren } from "@/lib/motion";
import { getWorldCreationApi } from "../api";

/**
 * Minimal server page until the dashboard exists. Recognizes a just-created world
 * (`?created=1`) and greets it; console/management link to future routes.
 */
export function ServerReady({ serverId, justCreated }: { serverId: string; justCreated: boolean }) {
  const { data: server, isPending, isError } = useQuery({
    queryKey: ["server", serverId],
    queryFn: ({ signal }) => getWorldCreationApi().getServer(serverId, signal),
    refetchInterval: 10_000,
  });
  const [copied, setCopied] = useState(false);

  if (isPending) return <main className="min-h-dvh" aria-busy="true" />;
  if (isError || !server) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-4 px-6">
        <h1 className="text-2xl font-semibold">Não encontramos esse mundo.</h1>
        <p className="text-muted">
          Ele pode ter sido removido ou você não tem acesso a ele.
          {getWorldCreationApi().mode === "mock" ? " (No modo demonstração, os mundos somem ao recarregar a página.)" : ""}
        </p>
        <Link href="/servers/new" className="text-accent underline">
          Criar um mundo
        </Link>
      </main>
    );
  }

  const address = server.address ? formatServerAddress(server.address) : null;
  const online = server.status === "RUNNING";
  const copy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard denied: the address stays visible for manual copy */
    }
  };

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <m.section variants={staggerChildren(0.06)} initial="hidden" animate="visible" className="space-y-6">
        {justCreated ? (
          <m.p variants={fadeUp} className="text-sm font-medium text-accent">
            Seu mundo está pronto.
          </m.p>
        ) : null}
        <m.div variants={fadeUp} className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-4xl text-foreground">{server.name.toUpperCase()}</h1>
          <span
            className={`inline-flex items-center gap-2 rounded-sm px-2.5 py-1 text-sm font-medium ${
              online ? "bg-success/15 text-success" : "bg-warning/15 text-warning"
            }`}
          >
            <span className={`size-2 rounded-full ${online ? "bg-success" : "bg-warning"}`} aria-hidden />
            {online ? "Online" : server.status}
          </span>
        </m.div>
        {address ? (
          <m.div variants={fadeUp} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface p-4">
            <div>
              <p className="text-sm text-muted">Endereço</p>
              <p className="break-all font-mono text-lg text-foreground">{address}</p>
            </div>
            <Button onClick={copy}>
              {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
              {copied ? "Copiado" : "Copiar IP"}
            </Button>
          </m.div>
        ) : null}
        <m.div variants={fadeUp} className="grid gap-3 sm:grid-cols-3">
          {[
            { icon: SquareTerminal, label: "Abrir console" },
            { icon: Settings2, label: "Gerenciar mundo" },
            { icon: Share2, label: "Compartilhar" },
          ].map(({ icon: Icon, label }) => (
            <button
              key={label}
              type="button"
              disabled
              title="Disponível em breve"
              className="flex items-center gap-3 rounded-md border border-border bg-surface p-4 text-left text-muted disabled:cursor-not-allowed"
            >
              <Icon className="size-5" aria-hidden />
              <span>
                <span className="block font-medium text-foreground">{label}</span>
                <span className="text-xs">Em breve</span>
              </span>
            </button>
          ))}
        </m.div>
      </m.section>
    </main>
  );
}
