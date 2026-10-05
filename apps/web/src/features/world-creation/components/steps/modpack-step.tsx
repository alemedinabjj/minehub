"use client";

import { MODPACK_CATEGORIES, type ModpackCategory, type ModpackSummary } from "@hubmine/shared";
import { Check, Download, Package, Plus } from "lucide-react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { staggerChildren, fadeUp, transitions } from "@/lib/motion";
import { track } from "../../analytics/track";
import { SOFTWARE_COPY } from "../../copy";
import { useModpacks } from "../../hooks/use-catalog";
import { useWorldCreationStore } from "../../state/store";
import { LoadError, SkeletonCards } from "../query-state";
import type { StepProps } from "./types";

const CATEGORY_LABEL: Record<ModpackCategory, string> = {
  popular: "Popular",
  new: "Novos",
  technology: "Tecnologia",
  adventure: "Aventura",
  rpg: "RPG",
  exploration: "Exploração",
  optimization: "Performance",
};

const formatDownloads = (n: number) => new Intl.NumberFormat("pt-BR", { notation: "compact" }).format(n);

export function ModpackStep({ onFeedback }: StepProps) {
  const version = useWorldCreationStore((s) => s.draft.minecraftVersion);
  const selected = useWorldCreationStore((s) => s.draft.modpack);
  const setModpack = useWorldCreationStore((s) => s.setModpack);
  const [category, setCategory] = useState<ModpackCategory>("popular");
  const { data, isPending, isError, refetch } = useModpacks(version, category);

  const toggle = (pack: ModpackSummary) => {
    const isSelected = selected?.ref.projectId === pack.ref.projectId;
    setModpack(isSelected ? null : pack);
    if (!isSelected) {
      onFeedback(`${pack.name} entrou no seu mundo.`);
      track("modpack_selected", { projectId: pack.ref.projectId, loader: pack.loader });
    }
  };

  return (
    <div className="space-y-4">
      {selected && selected.gameVersion !== version ? (
        <p role="alert" className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-foreground">
          <strong>{selected.name}</strong> foi feito para a versão {selected.gameVersion}, e seu mundo agora usa {version}. Escolha
          outro modpack ou volte e troque a versão.
        </p>
      ) : null}

      <div role="group" aria-label="Filtrar modpacks" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {MODPACK_CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={category === c}
            onClick={() => setCategory(c)}
            className={`h-9 shrink-0 rounded-sm border px-3 text-sm transition-colors ${
              category === c ? "border-accent bg-accent/15 text-foreground" : "border-border bg-surface text-muted hover:text-foreground"
            }`}
          >
            {CATEGORY_LABEL[c]}
          </button>
        ))}
      </div>

      <p className="text-sm text-muted" aria-live="polite">
        {selected ? (
          <>
            <Package className="mr-1 inline size-4 text-primary" aria-hidden /> 1 modpack no seu mundo: <strong className="text-foreground">{selected.name}</strong>
          </>
        ) : (
          "Nenhum modpack adicionado ainda."
        )}
      </p>

      {isPending ? (
        <SkeletonCards count={4} />
      ) : isError ? (
        <LoadError message="Não conseguimos carregar os modpacks." onRetry={() => void refetch()} />
      ) : data.data.length === 0 ? (
        <p className="rounded-md border border-border bg-surface p-4 text-sm text-muted">
          Nenhum modpack de {CATEGORY_LABEL[category].toLowerCase()} para a versão {version}. Tente outra categoria.
        </p>
      ) : (
        <m.ul variants={staggerChildren()} initial="hidden" animate="visible" className="grid gap-3 sm:grid-cols-2" key={category}>
          {data.data.map((pack) => {
            const isSelected = selected?.ref.projectId === pack.ref.projectId;
            return (
              <m.li key={pack.ref.projectId} variants={fadeUp} layout="position">
                <article
                  className={`flex h-full flex-col overflow-hidden rounded-md border bg-surface transition-colors ${
                    isSelected ? "border-primary shadow-[inset_0_0_0_1px_var(--primary)]" : "border-border"
                  }`}
                >
                  <ModpackArt pack={pack} />
                  <div className="flex flex-1 flex-col gap-2 p-3">
                    <h3 className="font-semibold text-foreground">{pack.name}</h3>
                    <p className="text-sm text-muted">{pack.description}</p>
                    <dl className="mt-auto flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                      <div><dt className="sr-only">Versão</dt><dd className="font-mono">{pack.gameVersion}</dd></div>
                      <div><dt className="sr-only">Loader</dt><dd>{SOFTWARE_COPY[pack.loader].title}</dd></div>
                      {pack.modCount !== null ? <div><dt className="sr-only">Mods</dt><dd>{pack.modCount} mods</dd></div> : null}
                      <div className="flex items-center gap-1"><dt className="sr-only">Downloads</dt><Download className="size-3" aria-hidden /><dd>{formatDownloads(pack.downloads)}</dd></div>
                    </dl>
                    <Button
                      variant={isSelected ? "secondary" : "primary"}
                      onClick={() => toggle(pack)}
                      aria-pressed={isSelected}
                      className="mt-1 w-full"
                    >
                      <AnimatePresence mode="wait" initial={false}>
                        <m.span
                          key={String(isSelected)}
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1, transition: transitions.soft }}
                          exit={{ opacity: 0, scale: 0.8 }}
                          className="inline-flex items-center gap-2"
                        >
                          {isSelected ? <Check className="size-4" aria-hidden /> : <Plus className="size-4" aria-hidden />}
                          {isSelected ? "No seu mundo" : "Adicionar ao mundo"}
                        </m.span>
                      </AnimatePresence>
                    </Button>
                  </div>
                </article>
              </m.li>
            );
          })}
        </m.ul>
      )}
    </div>
  );
}

/** Icon from the catalog when available; otherwise a deterministic pixel banner (no external image). */
function ModpackArt({ pack }: { pack: ModpackSummary }) {
  if (pack.iconUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- small catalog icon with explicit size; remote host allowlist pending
    return <img src={pack.iconUrl} alt="" width={64} height={64} loading="lazy" className="pixelated m-3 mb-0 size-16 rounded-sm" />;
  }
  const seed = [...pack.ref.projectId].reduce((a, c) => a + c.charCodeAt(0), 0);
  const hues = [140, 200, 30, 280, 0, 50];
  const hue = hues[seed % hues.length];
  return (
    <div aria-hidden className="grid h-16 grid-cols-12 overflow-hidden">
      {Array.from({ length: 24 }, (_, i) => (
        <span key={i} style={{ background: `hsl(${hue} ${35 + ((seed + i * 7) % 30)}% ${22 + ((seed * i) % 18)}%)` }} />
      ))}
    </div>
  );
}
