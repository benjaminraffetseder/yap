import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TextModelSettings } from "@/features/models/components/text-model-settings";
import {
  captureProfileTextModel,
  type ProfileTextModel,
  type TextModel,
  type TextProcessing,
} from "@/lib/backend";
import { useTranslation } from "react-i18next";

export function ProfileTextModelEditor({
  value,
  current,
  models,
  onChange,
}: {
  value: ProfileTextModel | null | undefined;
  current: TextProcessing;
  models: TextModel[];
  onChange: (value: ProfileTextModel) => void;
}) {
  const { t } = useTranslation();
  const selected = !value
    ? "inherit"
    : !value.enabled
      ? "off"
      : value.provider === "builtin"
        ? `builtin:${value.model}`
        : "external";
  const options = [
    ...(!value ? [{ value: "inherit", label: t("profileTextModel.legacy") }] : []),
    { value: "off", label: t("profileTextModel.off") },
    ...models
      .filter(
        (model) => model.installed || (value?.provider === "builtin" && value.model === model.id),
      )
      .map((model) => ({ value: `builtin:${model.id}`, label: model.name })),
    { value: "external", label: t("textModels.external") },
  ];
  if (!options.some((option) => option.value === selected))
    options.push({ value: selected, label: value?.model ?? selected });
  const config = { ...current, ...(value ?? {}), autoPromptId: "" };
  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="profile-text-model">{t("promptsPage.textModel")}</FieldLabel>
        <Select
          items={options}
          value={selected}
          onValueChange={(next) => {
            if (!next || next === "inherit") return;
            const previous = value ?? captureProfileTextModel(current);
            if (next === "off") onChange({ ...previous, enabled: false });
            else if (next.startsWith("builtin:"))
              onChange({
                ...previous,
                enabled: true,
                provider: "builtin",
                model: next.slice(8),
                contextLength: 0,
              });
            else
              onChange({
                ...previous,
                enabled: true,
                provider: "external",
                model: previous.provider === "builtin" ? "" : previous.model,
              });
          }}
        >
          <SelectTrigger id="profile-text-model" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <FieldDescription>{t("profileTextModel.description")}</FieldDescription>
      </Field>
      {value?.enabled && value.provider === "builtin" && (
        <TextModelSettings
          value={config}
          disabled={false}
          showModelPicker={false}
          onChange={(next) => onChange(captureProfileTextModel({ ...config, ...next }))}
        />
      )}
      {value?.enabled && value.provider !== "builtin" && (
        <>
          <Field>
            <FieldLabel htmlFor="profile-text-endpoint">
              {t("promptsPage.localServerURL")}
            </FieldLabel>
            <Input
              id="profile-text-endpoint"
              value={value.endpoint}
              onChange={(event) => onChange({ ...value, endpoint: event.target.value })}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="profile-text-model-id">{t("common.model")}</FieldLabel>
            <Input
              id="profile-text-model-id"
              value={value.model}
              onChange={(event) => onChange({ ...value, model: event.target.value })}
            />
          </Field>
        </>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => onChange(captureProfileTextModel(current))}
      >
        {t("profileTextModel.capture")}
      </Button>
    </FieldGroup>
  );
}
