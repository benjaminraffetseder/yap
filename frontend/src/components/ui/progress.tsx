import { Progress as ProgressPrimitive } from "@base-ui/react/progress";
import { useRender } from "@base-ui/react/use-render";
import { cn } from "cn";

function Progress({ className, children, value, ...props }: ProgressPrimitive.Root.Props) {
  return (
    <ProgressPrimitive.Root
      value={value}
      data-slot="progress"
      className={cn("flex flex-wrap gap-3", className)}
      {...props}
    >
      {children}
      <ProgressTrack>
        <ProgressIndicator />
      </ProgressTrack>
    </ProgressPrimitive.Root>
  );
}

function ProgressTrack({ className, ...props }: ProgressPrimitive.Track.Props) {
  return (
    <ProgressPrimitive.Track
      className={cn(
        "relative flex h-1 w-full items-center overflow-x-hidden rounded-full bg-muted",
        className,
      )}
      data-slot="progress-track"
      {...props}
    />
  );
}

function ProgressIndicator({ className, render, ...props }: ProgressPrimitive.Indicator.Props) {
  return (
    <ProgressPrimitive.Indicator
      data-slot="progress-indicator"
      className={(state) =>
        cn(
          "h-full origin-left bg-primary transition-[transform] duration-150 ease-(--motion-ease-out) motion-reduce:transition-none rtl:origin-right",
          typeof className === "function" ? className(state) : className,
        )
      }
      {...props}
      render={(elementProps, state) => (
        <ProgressIndicatorFill elementProps={elementProps} state={state} render={render} />
      )}
    />
  );
}

function ProgressIndicatorFill({
  elementProps,
  state,
  render,
}: {
  elementProps: useRender.ElementProps<"div">;
  state: ProgressPrimitive.Indicator.State;
  render: ProgressPrimitive.Indicator.Props["render"];
}) {
  const { style, ...props } = elementProps;
  // Base UI supplies the normalized width, including min/max and clamping.
  const scale = state.status === "indeterminate" ? 0 : parseFloat(String(style?.width ?? 0)) / 100;
  return useRender({
    render,
    state: { ...state },
    props: {
      ...props,
      style: { ...style, width: "100%", transform: `scaleX(${scale})` },
    },
  });
}

function ProgressLabel({ className, ...props }: ProgressPrimitive.Label.Props) {
  return (
    <ProgressPrimitive.Label
      className={cn("text-sm font-medium", className)}
      data-slot="progress-label"
      {...props}
    />
  );
}

function ProgressValue({ className, ...props }: ProgressPrimitive.Value.Props) {
  return (
    <ProgressPrimitive.Value
      className={cn("ml-auto text-sm text-muted-foreground tabular-nums", className)}
      data-slot="progress-value"
      {...props}
    />
  );
}

function CircularProgress({ className, value, ...props }: ProgressPrimitive.Root.Props) {
  return (
    <ProgressPrimitive.Root
      data-slot="circular-progress"
      className={cn("pointer-events-none size-30", className)}
      value={value}
      {...props}
    >
      <svg viewBox="0 0 120 120" className="size-full -rotate-90" aria-hidden="true">
        <circle cx="60" cy="60" r="54" fill="none" strokeWidth="4" className="stroke-muted" />
        <circle
          cx="60"
          cy="60"
          r="54"
          fill="none"
          strokeWidth="4"
          strokeLinecap="round"
          pathLength="100"
          strokeDasharray="100"
          strokeDashoffset={100 - (value ?? 0)}
          className="stroke-primary transition-[stroke-dashoffset] duration-300 motion-reduce:transition-none"
        />
      </svg>
    </ProgressPrimitive.Root>
  );
}

export {
  Progress,
  ProgressTrack,
  ProgressIndicator,
  ProgressLabel,
  ProgressValue,
  CircularProgress,
};
