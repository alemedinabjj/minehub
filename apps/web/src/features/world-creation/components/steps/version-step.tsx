"use client";

import type { VersionEntry } from "@hubmine/shared";
import { ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";
import { track } from "../../analytics/track";
import { useVersions } from "../../hooks/use-catalog";
import { useWorldCreationStore } from "../../state/store";
import { ChoiceCard, ChoiceGroup } from "../choice-group";
import { LoadError, SkeletonCards } from "../query-state";
import type { StepProps } from "./types";

/** Featured = recommended + latest + newest of each family (max 4). Everything else behind "all versions". */
function featured(versions: VersionEntry[]): VersionEntry[] {
  const picks = new Map<string, VersionEntry>();
  for (const v of versions) if (v.recommended || v.latest) picks.set(v.id, v);
  const seenFamilies = new Set([...picks.values()].map((v) => v.family));
  for (const v of versions) {
    if (picks.size >= 4) break;
    if (!seenFamilies.has(v.family)) {
      picks.set(v.id, v);
      seenFamilies.add(v.family);
    }
  }
  return [...picks.values()];
}

export function VersionStep({ onFeedback }: StepProps) {
  const { data, isPending, isError, refetch } = useVersions();
  const version = useWorldCreationStore((s) => s.draft.minecraftVersion);
  const setVersion = useWorldCreationStore((s) => s.setVersion);
  const [showAll, setShowAll] = useState(false);

  const top = useMemo(() => (data ? featured(data) : []), [data]);
  const families = useMemo(() => {
    const groups = new Map<string, VersionEntry[]>();
    for (const v of data ?? []) groups.set(v.family, [...(groups.get(v.family) ?? []), v]);
    return [...groups.entries()];
  }, [data]);

  if (isPending) return <SkeletonCards count={4} />;
  if (isError) return <LoadError message="Não conseguimos carregar as versões." onRetry={() => void refetch()} />;

  const choose = (id: string) => {
    setVersion(id);
    const entry = data.find((v) => v.id === id);
    onFeedback(entry?.recommended ? "Boa escolha. Essa é a mais compatível." : `Minecraft ${id} selecionado.`);
    track("minecraft_version_selected", { version: id, recommended: Boolean(entry?.recommended) });
  };
  const selectedIsHidden = Boolean(version) && !top.some((v) => v.id === version);

  return (
    <div className="space-y-4">
      <ChoiceGroup label="Versão do Minecraft" value={version} onChange={choose} className="grid gap-3 sm:grid-cols-2">
        {top.map((v) => (
          <ChoiceCard
            key={v.id}
            value={v.id}
            title={`Minecraft ${v.id}`}
            badge={v.recommended ? "Recomendado" : v.latest ? "Mais recente" : undefined}
            description={v.recommended ? "Mais compatível com mods e plugins" : `Família ${v.family}`}
            compact
          />
        ))}
      </ChoiceGroup>

      <div>
        <button
          type="button"
          onClick={() => setShowAll((s) => !s)}
          aria-expanded={showAll || selectedIsHidden}
          aria-controls="all-versions"
          className="inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-muted hover:text-foreground"
        >
          <ChevronDown className={`size-4 transition-transform ${showAll || selectedIsHidden ? "rotate-180" : ""}`} aria-hidden />
          Ver todas as versões
        </button>
        {showAll || selectedIsHidden ? (
          <div id="all-versions" className="mt-3 space-y-3">
            {families.map(([family, versions]) => (
              <ChoiceGroup key={family} label={`Versões ${family}`} value={version} onChange={choose} className="space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted" aria-hidden>
                  {family}
                </p>
                <div className="flex flex-wrap gap-2">
                  {versions.map((v) => (
                    <VersionChip key={v.id} id={v.id} selected={v.id === version} onSelect={choose} />
                  ))}
                </div>
              </ChoiceGroup>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function VersionChip({ id, selected, onSelect }: { id: string; selected: boolean; onSelect: (id: string) => void }) {
  return (
    <label
      className={`cursor-pointer rounded-sm border px-3 py-1.5 font-mono text-sm transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${
        selected ? "border-primary bg-primary/15 text-foreground" : "border-border bg-surface text-muted hover:text-foreground"
      }`}
    >
      <input type="radio" name="all-versions" value={id} checked={selected} onChange={() => onSelect(id)} className="sr-only" />
      {id}
      {selected ? <span className="sr-only"> (selecionada)</span> : null}
    </label>
  );
}
