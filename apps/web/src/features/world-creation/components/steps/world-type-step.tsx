"use client";

import { WORLD_TYPES, type WorldType } from "@hubmine/shared";
import { Puzzle, Skull, Swords, Blocks, Trees, UsersRound } from "lucide-react";
import { WORLD_TYPE_COPY } from "../../copy";
import { track } from "../../analytics/track";
import { useWorldCreationStore } from "../../state/store";
import { ChoiceCard, ChoiceGroup } from "../choice-group";
import type { StepProps } from "./types";

const ICONS: Record<WorldType, React.ReactNode> = {
  SURVIVAL: <Trees className="size-5" />,
  PVP: <Swords className="size-5" />,
  CREATIVE: <Blocks className="size-5" />,
  MODDED: <Puzzle className="size-5" />,
  SMP: <UsersRound className="size-5" />,
  HARDCORE: <Skull className="size-5" />,
};

export function WorldTypeStep({ onFeedback }: StepProps) {
  const worldType = useWorldCreationStore((s) => s.draft.worldType);
  const setWorldType = useWorldCreationStore((s) => s.setWorldType);

  return (
    <ChoiceGroup
      label="Tipo de mundo"
      value={worldType}
      onChange={(value: WorldType) => {
        setWorldType(value);
        onFeedback(WORLD_TYPE_COPY[value].feedback);
        track("world_type_selected", { worldType: value });
      }}
      className="grid gap-3 sm:grid-cols-2"
    >
      {WORLD_TYPES.map((type) => (
        <ChoiceCard
          key={type}
          value={type}
          title={WORLD_TYPE_COPY[type].title}
          description={WORLD_TYPE_COPY[type].tagline.join(" ")}
          icon={ICONS[type]}
        />
      ))}
    </ChoiceGroup>
  );
}
