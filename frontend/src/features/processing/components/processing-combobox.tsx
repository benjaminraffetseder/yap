import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from "@/components/ui/combobox";
import { InputGroupAddon } from "@/components/ui/input-group";
import { ProcessingOptionLabel } from "@/features/processing/components/processing-option-label";
import type { ProcessingOption } from "@/lib/backend";
import { cn } from "@/lib/utils";
import { Search } from "lucide-react";
import type { Ref } from "react";
import { useTranslation } from "react-i18next";

type ProcessingGroup = { label: string; items: ProcessingOption[] };

export function ProcessingCombobox({
  id,
  options,
  value,
  onValueChange,
  disabled,
  className,
  ref,
}: {
  id: string;
  options: ProcessingOption[];
  value: string | null;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  ref?: Ref<HTMLButtonElement>;
}) {
  const { t } = useTranslation();
  const selected = options.find((option) => option.value === value) ?? null;
  const groups: ProcessingGroup[] = [
    { label: t("promptsPage.prompts"), items: options.filter((option) => !option.isChain) },
    { label: t("promptsPage.chains"), items: options.filter((option) => option.isChain) },
  ].filter((group) => group.items.length > 0);

  return (
    <Combobox
      items={groups}
      value={selected}
      isItemEqualToValue={(item, current) => item.value === current.value}
      onValueChange={(option) => {
        if (option) onValueChange(option.value);
      }}
      disabled={disabled}
      autoHighlight
    >
      <ComboboxTrigger
        ref={ref}
        id={id}
        render={<Button variant="outline" />}
        className={cn("w-full min-w-0 justify-between font-normal", className)}
        aria-description={selected?.isChain ? t("dictationProfiles.promptChain") : undefined}
      >
        <ComboboxValue>
          {(option: ProcessingOption | null) =>
            option ? <ProcessingOptionLabel option={option} /> : t("generatedOutputs.chooseAPrompt")
          }
        </ComboboxValue>
      </ComboboxTrigger>
      <ComboboxContent aria-label={t("bulkText.promptOrChain")}>
        <ComboboxInput
          type="search"
          aria-label={t("processingPicker.search")}
          placeholder={t("processingPicker.search")}
          showTrigger={false}
        >
          <InputGroupAddon>
            <Search aria-hidden="true" />
          </InputGroupAddon>
        </ComboboxInput>
        <ComboboxEmpty>{t("processingPicker.noResults")}</ComboboxEmpty>
        <ComboboxList>
          {(group: ProcessingGroup) => (
            <ComboboxGroup key={group.label} items={group.items}>
              <ComboboxLabel>{group.label}</ComboboxLabel>
              <ComboboxCollection>
                {(option: ProcessingOption) => (
                  <ComboboxItem
                    key={option.value}
                    value={option}
                    aria-description={
                      option.isChain ? t("dictationProfiles.promptChain") : undefined
                    }
                  >
                    <ProcessingOptionLabel option={option} />
                  </ComboboxItem>
                )}
              </ComboboxCollection>
            </ComboboxGroup>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
