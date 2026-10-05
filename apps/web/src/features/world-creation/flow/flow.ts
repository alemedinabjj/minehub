import { STEP_DEFINITIONS } from "./steps";
import type { StepError, StepId, WorldDraft } from "./types";

/**
 * Flow variants. A/B experiments swap the ordered list; components don't change.
 * "quick" is reserved for a future fast-create flow (summary with smart defaults).
 */
export const FLOW_VARIANTS = {
  journey: ["world-type", "version", "experience", "modpack", "name", "players", "summary"],
} as const satisfies Record<string, readonly StepId[]>;

export type FlowVariant = keyof typeof FLOW_VARIANTS;

export function activeSteps(draft: WorldDraft, variant: FlowVariant = "journey"): StepId[] {
  return FLOW_VARIANTS[variant].filter((id) => STEP_DEFINITIONS[id].isApplicable(draft));
}

export function stepError(id: StepId, draft: WorldDraft): StepError | null {
  return STEP_DEFINITIONS[id].validate(draft);
}

export function nextStep(current: StepId, draft: WorldDraft, variant?: FlowVariant): StepId | null {
  const steps = activeSteps(draft, variant);
  const i = steps.indexOf(current);
  return i >= 0 && i < steps.length - 1 ? (steps[i + 1] ?? null) : null;
}

export function previousStep(current: StepId, draft: WorldDraft, variant?: FlowVariant): StepId | null {
  const steps = activeSteps(draft, variant);
  const i = steps.indexOf(current);
  return i > 0 ? (steps[i - 1] ?? null) : null;
}

/**
 * The furthest step the user may open: every step before it must be valid.
 * Used to guard deep links / back-forward navigation and to unlock journey nodes.
 */
export function furthestReachableStep(draft: WorldDraft, variant?: FlowVariant): StepId {
  const steps = activeSteps(draft, variant);
  for (const id of steps) {
    if (id === "summary") return id;
    if (stepError(id, draft)) return id;
  }
  return steps[steps.length - 1] ?? "world-type";
}

export function canOpenStep(target: StepId, draft: WorldDraft, variant?: FlowVariant): boolean {
  const steps = activeSteps(draft, variant);
  const targetIndex = steps.indexOf(target);
  if (targetIndex < 0) return false;
  return targetIndex <= steps.indexOf(furthestReachableStep(draft, variant));
}

export function isStepComplete(id: StepId, draft: WorldDraft): boolean {
  return id !== "summary" && stepError(id, draft) === null;
}

/** Steps whose earlier answer became invalid after the user edited something upstream. */
export function stepsNeedingReview(draft: WorldDraft, variant?: FlowVariant): StepId[] {
  return activeSteps(draft, variant).filter((id) => {
    const error = stepError(id, draft);
    return error === "MODPACK_INCOMPATIBLE";
  });
}
