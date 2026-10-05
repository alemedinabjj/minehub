"use client";

import { Check, Globe, Mountain, Package, Settings2, Signpost, Trees, Users } from "lucide-react";
import * as m from "motion/react-m";
import { transitions } from "@/lib/motion";
import { STEP_COPY } from "../copy";
import type { StepId } from "../flow/types";

const ICONS: Record<StepId, typeof Trees> = {
  "world-type": Trees,
  version: Mountain,
  experience: Settings2,
  modpack: Package,
  name: Signpost,
  players: Users,
  summary: Globe,
};

/**
 * Adventure-map progress: where you are, what you chose, how much is left.
 * Completed nodes are links back to edit that choice.
 */
export function WorldJourney({
  steps,
  current,
  isComplete,
  canOpen,
  onOpen,
}: {
  steps: StepId[];
  current: StepId;
  isComplete: (id: StepId) => boolean;
  canOpen: (id: StepId) => boolean;
  onOpen: (id: StepId) => void;
}) {
  const currentIndex = steps.indexOf(current);
  return (
    <nav aria-label="Etapas da criação do mundo">
      <p className="sr-only" aria-live="polite">
        Etapa {currentIndex + 1} de {steps.length}: {STEP_COPY[current].journeyLabel}
      </p>
      <ol className="flex items-center">
        {steps.map((id, i) => {
          const Icon = ICONS[id];
          const done = isComplete(id) && i !== currentIndex;
          const active = i === currentIndex;
          const reachable = canOpen(id);
          return (
            <li key={id} className="flex flex-1 items-center last:flex-none">
              <button
                type="button"
                onClick={() => onOpen(id)}
                disabled={!reachable || active}
                aria-current={active ? "step" : undefined}
                aria-label={`${STEP_COPY[id].journeyLabel}${done ? " (concluída)" : active ? " (atual)" : ""}`}
                title={STEP_COPY[id].journeyLabel}
                className="group relative grid size-9 shrink-0 place-items-center rounded-sm disabled:cursor-default"
              >
                <m.span
                  layout
                  transition={transitions.soft}
                  className={[
                    "grid size-9 place-items-center rounded-sm border-2 transition-colors",
                    active
                      ? "border-primary bg-primary text-primary-foreground shadow-[0_0_0_4px_color-mix(in_srgb,var(--primary)_25%,transparent)]"
                      : done
                        ? "border-primary/60 bg-surface-raised text-primary group-hover:border-primary"
                        : "border-border bg-surface text-muted",
                  ].join(" ")}
                >
                  {done ? <Check className="size-4" strokeWidth={3} aria-hidden /> : <Icon className="size-4" aria-hidden />}
                </m.span>
                <span
                  className={`absolute top-full mt-1.5 hidden whitespace-nowrap text-[11px] font-medium md:block ${
                    active ? "text-foreground" : "text-muted"
                  }`}
                >
                  {STEP_COPY[id].journeyLabel}
                </span>
              </button>
              {i < steps.length - 1 ? (
                <span aria-hidden className="relative mx-1 h-1 flex-1 overflow-hidden rounded-full bg-border">
                  <m.span
                    className="absolute inset-y-0 left-0 bg-primary"
                    initial={false}
                    animate={{ width: i < currentIndex ? "100%" : "0%" }}
                    transition={transitions.enter}
                  />
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
