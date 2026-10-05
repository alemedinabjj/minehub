"use client";

import { PLAYER_BUCKETS, type PlayerBucket } from "@hubmine/shared";
import { Cpu, MemoryStick, User, Users, UsersRound, House, Earth } from "lucide-react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { transitions } from "@/lib/motion";
import { track } from "../../analytics/track";
import { PLAYER_COPY } from "../../copy";
import { recommendationFor } from "../../flow/request";
import { useWorldCreationStore } from "../../state/store";
import { ChoiceCard, ChoiceGroup } from "../choice-group";
import type { StepProps } from "./types";

const ICONS: Record<PlayerBucket, React.ReactNode> = {
  SOLO: <User className="size-5" />,
  SMALL: <Users className="size-5" />,
  MEDIUM: <UsersRound className="size-5" />,
  LARGE: <House className="size-5" />,
  HUGE: <Earth className="size-5" />,
};

export const formatGb = (mb: number) => `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(mb / 1024)} GB`;
export const formatCpu = (millis: number) => `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(millis / 1000)} vCPU`;

export function PlayersStep({ onFeedback }: StepProps) {
  const draft = useWorldCreationStore((s) => s.draft);
  const setPlayers = useWorldCreationStore((s) => s.setPlayers);
  const recommendation = recommendationFor(draft);

  return (
    <div className="space-y-5">
      <ChoiceGroup
        label="Quantidade de jogadores"
        value={draft.players}
        onChange={(value: PlayerBucket) => {
          setPlayers(value);
          onFeedback(value === "SOLO" ? "Um mundo só seu." : `${PLAYER_COPY[value].title} chegando.`);
          track("player_count_selected", { players: value });
        }}
        className="grid gap-2 sm:grid-cols-2"
      >
        {PLAYER_BUCKETS.map((bucket) => (
          <ChoiceCard key={bucket} value={bucket} title={PLAYER_COPY[bucket].title} description={PLAYER_COPY[bucket].detail} icon={ICONS[bucket]} compact />
        ))}
      </ChoiceGroup>

      <div aria-live="polite" className="min-h-[104px]">
        <AnimatePresence mode="wait">
          {recommendation && draft.players ? (
            <m.div
              key={`${recommendation.heapMb}-${recommendation.cpuMillis}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0, transition: transitions.enter }}
              exit={{ opacity: 0, transition: { duration: 0.1 } }}
              className="rounded-md border border-accent/30 bg-accent/5 p-4"
            >
              <p className="text-sm text-muted">Seu mundo está pronto para {PLAYER_COPY[draft.players].title.toLowerCase()}. Recomendamos:</p>
              <div className="mt-2 flex flex-wrap gap-4">
                <span className="inline-flex items-center gap-2 text-xl font-semibold text-foreground tabular-nums">
                  <MemoryStick className="size-5 text-accent" aria-hidden /> {formatGb(recommendation.heapMb)} de RAM
                </span>
                <span className="inline-flex items-center gap-2 text-xl font-semibold text-foreground tabular-nums">
                  <Cpu className="size-5 text-accent" aria-hidden /> {formatCpu(recommendation.cpuMillis)}
                </span>
              </div>
              <p className="mt-2 text-xs text-muted">
                Calculado pelo tipo de servidor{draft.modpack ? ", tamanho do modpack" : ""} e jogadores. Você pode ajustar depois.
              </p>
            </m.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}
