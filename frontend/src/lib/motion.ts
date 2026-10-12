import type { Transition } from "motion/react";

export const easeOut = [0.23, 1, 0.32, 1] as const;

export const springs = {
  press: { type: "spring", duration: 0.12, bounce: 0 },
  toast: { type: "spring", duration: 0.18, bounce: 0 },
  output: { type: "spring", duration: 0.22, bounce: 0 },
  model: { type: "spring", duration: 0.24, bounce: 0.08 },
  drop: { type: "spring", duration: 0.24, bounce: 0.12 },
  setup: { type: "spring", duration: 0.28, bounce: 0.12 },
  success: { type: "spring", duration: 0.28, bounce: 0.22 },
} as const satisfies Record<string, Transition>;

export type SpringPreset = keyof typeof springs;

export function fade(reduced: boolean | null, duration = 0.12): Transition {
  return { type: "tween", duration: reduced ? 0.08 : duration, ease: easeOut };
}

export function motionTransition(preset: SpringPreset, reduced: boolean | null): Transition {
  return {
    transform: reduced ? { duration: 0 } : springs[preset],
    opacity: fade(reduced),
    layout: reduced ? { duration: 0 } : springs[preset],
  };
}

export function motionExit(reduced: boolean | null, transform = "none") {
  return {
    opacity: 0,
    transform: reduced ? "none" : transform,
    transition: fade(reduced, 0.1),
  };
}
