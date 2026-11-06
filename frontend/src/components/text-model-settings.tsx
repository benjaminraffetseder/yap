import { useDictation } from "@/components/dictation-provider";
import { SettingRow } from "@/components/settings-section";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type TextProcessing } from "@/lib/backend";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

export function TextModelSettings({
  value,
  disabled,
  onChange,
  showModelPicker = true,
}: {
  value: TextProcessing;
  disabled: boolean;
  onChange: (value: Partial<TextProcessing>) => void;
  showModelPicker?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { snapshot } = useDictation();
  const models = snapshot.textModels ?? [];
  const model = models.find((model) => model.id === value.model);
  const format = (n: number) => n.toLocaleString(i18n.resolvedLanguage);
  const max = model?.maxContext ?? 131072;
  const contexts = [
    {
      value: "0",
      label: t("textModels.automaticContext", {
        tokens: format(snapshot.recommendedTextContext ?? 8192),
      }),
    },
    ...[2048, 4096, 8192, 16384, 32768, 65536, 131072, 262144]
      .filter((n) => n <= max)
      .map((n) => ({ value: String(n), label: t("textModels.tokens", { tokens: format(n) }) })),
  ];
  // Keep a previously saved non-preset value visible, including invalid values
  // that the user needs to repair rather than silently replacing their choice.
  if (!contexts.some((item) => item.value === String(value.contextLength ?? 0)))
    contexts.push({
      value: String(value.contextLength),
      label: t("textModels.tokens", { tokens: format(value.contextLength!) }),
    });
  const options = models.map((model) => ({ value: model.id, label: model.name }));
  return (
    <fieldset disabled={disabled} className="divide-y disabled:opacity-60">
      {!snapshot.textRuntimeAvailable && (
        <p role="status" className="py-3 text-sm text-muted-foreground">
          {t("textModels.windowsOnly")}
        </p>
      )}
      {showModelPicker && (
        <SettingRow title={t("common.model")} htmlFor="builtin-text-model">
          <Select
            items={options}
            value={value.model}
            onValueChange={(id) => {
              if (!id) return;
              const next = models.find((model) => model.id === id);
              onChange({
                model: id,
                contextLength:
                  (value.contextLength ?? 0) > (next?.maxContext ?? max) ? 0 : value.contextLength,
              });
            }}
          >
            <SelectTrigger id="builtin-text-model" className="w-full min-w-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-2 text-xs text-muted-foreground">
            {t(model?.installed ? "textModels.ready" : "textModels.downloadFirst")}{" "}
            <Link className="text-primary underline underline-offset-4" to="/models?type=text">
              {t("textModels.manage")}
            </Link>
          </p>
        </SettingRow>
      )}
      <SettingRow title={t("textModels.contextLength")} htmlFor="text-context-length">
        <Select
          items={contexts}
          value={String(value.contextLength ?? 0)}
          onValueChange={(length) => {
            if (length !== null) onChange({ contextLength: Number(length) });
          }}
        >
          <SelectTrigger
            id="text-context-length"
            className="w-full min-w-0"
            aria-describedby="text-context-help"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {contexts.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p id="text-context-help" className="mt-2 text-xs leading-5 text-muted-foreground">
          {t("textModels.contextHelp")}
        </p>
      </SettingRow>
    </fieldset>
  );
}
