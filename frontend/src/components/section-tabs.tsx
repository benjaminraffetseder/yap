import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export function SectionTabs({
  label,
  sections,
  className,
}: {
  label: string;
  sections: readonly { value: string; label: string }[];
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 border-b bg-background", className)}>
      <div className="@container/section-tabs max-w-full overflow-x-auto p-1">
        <TabsList
          aria-label={label}
          variant="line"
          className="w-max min-w-max items-stretch justify-start gap-1 p-0 group-data-[orientation=horizontal]/tabs:h-auto"
        >
          {sections.map((item) => (
            <TabsTrigger
              key={item.value}
              value={item.value}
              onFocus={(event) =>
                event.currentTarget.scrollIntoView({
                  block: "nearest",
                  inline: "nearest",
                  behavior: "instant",
                })
              }
              className="h-auto max-w-[100cqw] flex-none rounded-none px-3 py-3 whitespace-normal data-active:text-primary dark:data-active:text-primary after:bg-primary group-data-[orientation=horizontal]/tabs:after:bottom-0"
            >
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
    </div>
  );
}
