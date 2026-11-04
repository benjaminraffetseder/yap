import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Slider as SliderPrimitive } from "@base-ui/react/slider";

function Slider({
  className,
  "aria-label": label,
  getAriaValueText,
  ...props
}: SliderPrimitive.Root.Props<number> & Pick<SliderPrimitive.Thumb.Props, "getAriaValueText">) {
  const { t } = useTranslation();
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn("flex min-w-0 items-center select-none data-disabled:opacity-50", className)}
      {...props}
    >
      <SliderPrimitive.Control
        data-slot="slider-control"
        className="relative flex h-8 w-full touch-none items-center data-disabled:cursor-default"
      >
        <SliderPrimitive.Track
          data-slot="slider-track"
          className="relative h-1.5 w-full rounded-full bg-muted"
        >
          <SliderPrimitive.Indicator
            data-slot="slider-range"
            className="absolute h-full rounded-full bg-primary"
          />
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            getAriaLabel={() => label ?? t("slider.value")}
            getAriaValueText={getAriaValueText}
            className="size-3.5 rounded-full border border-primary bg-background shadow-xs has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50"
          />
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}

export { Slider };
