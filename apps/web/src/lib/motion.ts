import type { Transition, Variants } from "motion/react";

/** Durations in seconds. `cinematic` is reserved for the entrance and the "world is born" moment. */
export const durations = {
  fast: 0.15,
  normal: 0.3,
  slow: 0.5,
  cinematic: 0.8,
} as const;

export const easings = {
  out: [0.22, 1, 0.36, 1],
  in: [0.4, 0, 1, 1],
  inOut: [0.65, 0, 0.35, 1],
} as const satisfies Record<string, [number, number, number, number]>;

export const transitions = {
  enter: { duration: durations.normal, ease: easings.out },
  exit: { duration: durations.fast, ease: easings.in },
  soft: { type: "spring", stiffness: 380, damping: 32, mass: 0.8 },
  cinematic: { duration: durations.cinematic, ease: easings.out },
} as const satisfies Record<string, Transition>;

/** Step-to-step: small travel, direction-aware, exit faster than enter. */
export const stepVariants: Variants = {
  enter: (direction: 1 | -1) => ({ opacity: 0, x: 16 * direction, filter: "blur(2px)" }),
  center: { opacity: 1, x: 0, filter: "blur(0px)", transition: transitions.enter },
  exit: (direction: 1 | -1) => ({ opacity: 0, x: -12 * direction, filter: "blur(2px)", transition: transitions.exit }),
};

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: transitions.enter },
};

export const staggerChildren = (stagger = 0.04): Variants => ({
  hidden: {},
  visible: { transition: { staggerChildren: stagger } },
});
