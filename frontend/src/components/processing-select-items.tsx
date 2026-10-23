import { ProcessingOptionLabel } from "@/components/processing-option-label";
import { SelectGroup, SelectItem, SelectLabel, SelectSeparator } from "@/components/ui/select";
import type { ProcessingOption } from "@/lib/backend";
import { Fragment } from "react";

export function ProcessingSelectItems({ options }: { options: ProcessingOption[] }) {
  const groups = [
    { label: "Prompts", options: options.filter((option) => !option.isChain) },
    { label: "Chains", options: options.filter((option) => option.isChain) },
  ].filter((group) => group.options.length > 0);

  return groups.map((group, index) => (
    <Fragment key={group.label}>
      {index > 0 && <SelectSeparator />}
      <SelectGroup>
        <SelectLabel>{group.label}</SelectLabel>
        {group.options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            aria-description={option.isChain ? "Prompt chain" : undefined}
          >
            <ProcessingOptionLabel option={option} />
          </SelectItem>
        ))}
      </SelectGroup>
    </Fragment>
  ));
}
