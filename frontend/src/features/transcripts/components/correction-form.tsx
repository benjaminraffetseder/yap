import { useEffect, useMemo, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { useSavedActions } from "@/lib/queries/saved-queries";
import { nativeText } from "@/i18n/native-text";
import { message } from "@/lib/backend";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  correctionSchema,
  type CorrectionValues,
} from "@/features/transcripts/lib/correction-schema";
import type { TextSelection } from "@/features/transcripts/lib/text-selection";

export function CorrectionForm({
  target,
  stale,
  disabled,
  onPending,
  onCancel,
  onApply,
  onDone,
}: {
  target: TextSelection;
  stale: boolean;
  disabled: boolean;
  onPending: (pending: boolean) => void;
  onCancel: () => void;
  onApply: (value: string) => Promise<boolean>;
  onDone: () => void;
}) {
  const { t, i18n } = useTranslation();
  const savedActions = useSavedActions();
  const schema = useMemo(
    () => correctionSchema({ source: target.source, start: target.start, end: target.end }),
    [target.source, target.start, target.end],
  );
  const {
    register,
    control,
    handleSubmit,
    trigger,
    formState: { errors, isValid, isSubmitting: pending },
  } = useForm<CorrectionValues>({
    resolver: zodResolver(schema, undefined, { mode: "sync" }),
    defaultValues: { spelling: target.text, remember: true },
    mode: "onChange",
  });
  // A failed native write does not invalidate the field values or block Retry.
  const [submitError, setSubmitError] = useState("");
  const inFlight = useRef(false);
  const remembered = useRef(false);
  const composing = useRef(false);
  useEffect(() => {
    void trigger("spelling");
  }, [trigger, i18n.resolvedLanguage]);

  async function submit() {
    if (inFlight.current || composing.current || stale || disabled) return;
    inFlight.current = true;
    try {
      await handleSubmit(async ({ spelling, remember }) => {
        const canonical = spelling.trim();
        onPending(true);
        setSubmitError("");
        try {
          if (remember) {
            await savedActions.addVocabularyTerm(canonical, [target.text]);
            remembered.current = true;
          }
          if (!(await onApply(canonical))) throw new Error(t("correction.couldNotApply"));
          onDone();
        } catch (cause) {
          const details = nativeText(message(cause));
          setSubmitError(
            remembered.current ? `${t("correction.rememberedButNotApplied")} ${details}` : details,
          );
        } finally {
          onPending(false);
        }
      })();
    } finally {
      inFlight.current = false;
    }
  }
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
          event.preventDefault();
          void submit();
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>{t("correction.correctAndRemember")}</DialogTitle>
        <DialogDescription>{t("correction.description")}</DialogDescription>
      </DialogHeader>
      <p className="break-words text-sm text-muted-foreground">
        {t("correction.selectedText", { text: target.text })}
      </p>
      <FieldGroup className="gap-4">
        <Field data-invalid={!!errors.spelling} data-disabled={pending}>
          <FieldLabel htmlFor="corrected-spelling">{t("correction.correctSpelling")}</FieldLabel>
          <Input
            id="corrected-spelling"
            {...register("spelling")}
            maxLength={160}
            disabled={pending}
            aria-invalid={!!errors.spelling}
            aria-describedby={errors.spelling ? "corrected-spelling-error" : undefined}
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={() => {
              composing.current = false;
            }}
          />
          {errors.spelling && (
            <FieldError id="corrected-spelling-error" errors={[errors.spelling]} />
          )}
        </Field>
        <Field orientation="horizontal" className="items-start gap-3" data-disabled={pending}>
          <Controller
            name="remember"
            control={control}
            render={({ field }) => (
              <Checkbox
                id="remember-spelling"
                ref={field.ref}
                name={field.name}
                checked={field.value}
                onBlur={field.onBlur}
                disabled={pending}
                onCheckedChange={(checked) => field.onChange(checked === true)}
              />
            )}
          />
          <FieldLabel htmlFor="remember-spelling">{t("correction.remember")}</FieldLabel>
        </Field>
      </FieldGroup>
      {stale && (
        <p role="alert" className="text-sm text-destructive">
          {t("correction.stale")}
        </p>
      )}
      {submitError && <FieldError>{submitError}</FieldError>}
      <DialogFooter>
        <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={pending || disabled || stale || !isValid}>
          {pending ? t("autoSaveStatus.saving") : t("correction.apply")}
        </Button>
      </DialogFooter>
    </form>
  );
}
