"use client";

import { EXPERIENCE_SOFTWARE, EXPERIENCES, type Experience, type Software } from "@hubmine/shared";
import { Package, Puzzle, Sprout, Zap } from "lucide-react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { fadeUp } from "@/lib/motion";
import { track } from "../../analytics/track";
import { EXPERIENCE_COPY, SOFTWARE_COPY } from "../../copy";
import { useSoftware } from "../../hooks/use-catalog";
import { useWorldCreationStore } from "../../state/store";
import { ChoiceCard, ChoiceGroup } from "../choice-group";
import { LoadError, SkeletonCards } from "../query-state";
import type { StepProps } from "./types";

const ICONS: Record<Experience, React.ReactNode> = {
  VANILLA: <Sprout className="size-5" />,
  PERFORMANCE: <Zap className="size-5" />,
  MODS: <Puzzle className="size-5" />,
  MODPACK: <Package className="size-5" />,
};

export function ExperienceStep({ onFeedback }: StepProps) {
  const draft = useWorldCreationStore((s) => s.draft);
  const setExperience = useWorldCreationStore((s) => s.setExperience);
  const setSoftware = useWorldCreationStore((s) => s.setSoftware);
  const setLoaderVersion = useWorldCreationStore((s) => s.setLoaderVersion);
  const setAdvancedMode = useWorldCreationStore((s) => s.setAdvancedMode);
  const { data: availability, isPending, isError, refetch } = useSoftware(draft.minecraftVersion);

  const options = draft.experience ? EXPERIENCE_SOFTWARE[draft.experience] : [];
  const availabilityOf = (software: Software) => availability?.find((a) => a.software === software);
  const selectedAvailability = draft.software ? availabilityOf(draft.software) : undefined;
  const showSoftwareChoice = draft.experience !== null && options.length > 0 && (options.length > 1 || draft.advancedMode);

  return (
    <div className="space-y-6">
      <ChoiceGroup
        label="Como o mundo funciona"
        value={draft.experience}
        onChange={(value: Experience) => {
          setExperience(value);
          onFeedback(value === "MODPACK" ? "Um portal começou a se abrir." : value === "PERFORMANCE" ? "Energia extra no seu mundo." : "Anotado.");
          track("software_selected", { experience: value });
        }}
        className="grid gap-3 sm:grid-cols-2"
      >
        {EXPERIENCES.map((exp) => (
          <ChoiceCard key={exp} value={exp} title={EXPERIENCE_COPY[exp].title} description={EXPERIENCE_COPY[exp].description} icon={ICONS[exp]} />
        ))}
      </ChoiceGroup>

      <AnimatePresence initial={false}>
        {showSoftwareChoice ? (
          <m.section key={draft.experience} variants={fadeUp} initial="hidden" animate="visible" exit="hidden" aria-labelledby="software-title">
            <h3 id="software-title" className="mb-3 text-sm font-semibold text-foreground">
              Qual servidor?
              <span className="ml-2 font-normal text-muted">Já deixamos o mais indicado selecionado.</span>
            </h3>
            {isPending ? (
              <SkeletonCards count={options.length} className="grid gap-2 sm:grid-cols-3" />
            ) : isError ? (
              <LoadError message="Não conseguimos verificar a compatibilidade." onRetry={() => void refetch()} />
            ) : (
              <ChoiceGroup
                label="Servidor"
                value={draft.software}
                onChange={(value: Software) => {
                  setSoftware(value);
                  track("software_selected", { software: value });
                }}
                className="grid gap-2 sm:grid-cols-3"
              >
                {options.map((software) => {
                  const a = availabilityOf(software);
                  return (
                    <ChoiceCard
                      key={software}
                      value={software}
                      title={SOFTWARE_COPY[software].title}
                      description={SOFTWARE_COPY[software].hint}
                      badge={a?.recommended ? "Indicado" : undefined}
                      disabled={a ? !a.available : false}
                      disabledReason={a && !a.available ? `Indisponível para ${draft.minecraftVersion}` : undefined}
                      compact
                    />
                  );
                })}
              </ChoiceGroup>
            )}
          </m.section>
        ) : null}
      </AnimatePresence>

      {draft.software && selectedAvailability && !selectedAvailability.available ? (
        <p role="alert" className="text-sm text-warning">
          {SOFTWARE_COPY[draft.software].title} não está disponível para a versão {draft.minecraftVersion}. Escolha outra opção.
        </p>
      ) : null}

      {draft.experience && draft.experience !== "MODPACK" ? (
        <div className="rounded-md border border-border bg-surface/60 p-3">
          <label className="flex cursor-pointer items-center justify-between gap-3 text-sm">
            <span>
              <span className="font-medium text-foreground">Modo avançado</span>
              <span className="block text-muted">Escolher servidor e versão do loader manualmente.</span>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={draft.advancedMode}
              onChange={(e) => setAdvancedMode(e.target.checked)}
              className="size-5 accent-[var(--primary)]"
            />
          </label>
          {draft.advancedMode && selectedAvailability?.loaderVersions?.length ? (
            <label className="mt-3 block text-sm">
              <span className="mb-1 block font-medium text-foreground">Versão do loader</span>
              <select
                value={draft.loaderVersion ?? ""}
                onChange={(e) => setLoaderVersion(e.target.value || null)}
                className="h-10 w-full rounded-sm border border-border bg-surface-raised px-3 font-mono text-sm"
              >
                <option value="">Mais recente estável (recomendado)</option>
                {selectedAvailability.loaderVersions.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
