import { useMotionPreference } from "@/lib/use-motion-preference";
import { motionExit, motionTransition, type SpringPreset } from "@/lib/motion";
import { motion, useIsPresent, type HTMLMotionProps } from "motion/react";

// Exiting surfaces remain visible briefly, but must stop accepting focus and input immediately.
export function MotionReveal({
  preset,
  from = "translateY(6px)",
  rest = "none",
  enter = true,
  instant = false,
  ...props
}: HTMLMotionProps<"div"> & {
  preset: SpringPreset;
  from?: string;
  // Scale transforms need an explicit identity: Motion converts "none" to scale(0).
  rest?: string;
  enter?: boolean;
  instant?: boolean;
}) {
  const reduced = useMotionPreference();
  const present = useIsPresent();
  return (
    <motion.div
      {...props}
      inert={!present || undefined}
      aria-hidden={!present || undefined}
      initial={enter && !instant ? { opacity: 0, transform: reduced ? "none" : from } : false}
      animate={{ opacity: 1, transform: reduced ? "none" : rest }}
      variants={{
        exit: (animate = !instant) =>
          animate ? motionExit(reduced, rest) : { opacity: 0, transition: { duration: 0 } },
      }}
      exit="exit"
      transition={instant ? { duration: 0 } : motionTransition(preset, reduced)}
    />
  );
}
