import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  useDictationPhase,
  useSavedConfiguration,
} from "@/features/dictation/hooks/use-dictation-state";
import { useTextRequest } from "@/features/processing/hooks/use-text-request";
import { nativeText } from "@/i18n/native-text";
import { backend, isBusy, message, type Session } from "@/lib/backend";
import { cn } from "@/lib/utils";
import { Check, Loader2, Pencil, Sparkles, Square, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";

export function SessionTitleAction({
  entry,
  disabled,
  onSaved,
  context,
  contextual = false,
  inlineTitle,
  headingRef,
  open: controlledOpen,
  onOpenChange,
  hideTrigger = false,
  returnFocus,
}: {
  entry: Session;
  disabled: boolean;
  onSaved: (title: string) => void;
  context?: string;
  contextual?: boolean;
  inlineTitle?: string;
  headingRef?: RefObject<HTMLHeadingElement | null>;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
  returnFocus?: RefObject<HTMLButtonElement | null>;
}) {
  const { t } = useTranslation();
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  function setOpen(value: boolean) {
    if (controlledOpen === undefined) setLocalOpen(value);
    onOpenChange?.(value);
  }
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  function finishInline() {
    setOpen(false);
    requestAnimationFrame(() => headingRef?.current?.focus({ preventScroll: true }));
  }
  if (inlineTitle !== undefined) {
    return open ? (
      <>
        <h1 ref={headingRef} tabIndex={-1} className="sr-only">
          {inlineTitle}
        </h1>
        <SessionTitleForm
          key={entry.id}
          inline
          entry={entry}
          disabled={disabled}
          onPendingChange={(value) => {
            pendingRef.current = value;
            setPending(value);
          }}
          onSaved={(title) => {
            onSaved(title);
            finishInline();
          }}
          onCancel={finishInline}
        />
      </>
    ) : (
      <>
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="inline font-semibold tracking-tight outline-none"
          onDoubleClick={() => {
            if (!disabled) setOpen(true);
          }}
        >
          {inlineTitle}
        </h1>{" "}
        <Tooltip>
          <TooltipTrigger
            render={<Button variant="ghost" size="icon-sm" disabled={disabled} />}
            disabled={disabled}
            aria-label={t("uiPolish.renameDictation")}
            data-dictation-title-action={entry.id}
            onClick={() => setOpen(true)}
          >
            <Pencil aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent>{t("uiPolish.renameDictation")}</TooltipContent>
        </Tooltip>
      </>
    );
  }
  const renameButton = (
    <Button
      variant="ghost"
      size={contextual ? "icon-sm" : "sm"}
      className={
        contextual
          ? "text-muted-foreground group-hover:text-foreground group-focus-within:text-foreground group-data-[selected=true]:text-foreground [@media(hover:none)]:text-foreground"
          : undefined
      }
    />
  );
  const renameTrigger = (
    <DialogTrigger
      render={contextual ? <TooltipTrigger render={renameButton} /> : renameButton}
      disabled={disabled}
      aria-label={`${t("uiPolish.renameDictation")}${context ? `: ${context}` : ""}`}
      data-dictation-title-action={entry.id}
    >
      <Pencil aria-hidden="true" className="size-3.5" />
      {!contextual && t("uiPolish.rename")}
    </DialogTrigger>
  );

  return (
    <Dialog
      open={open}
      disablePointerDismissal
      onOpenChange={(value) => {
        if (pendingRef.current) return;
        setOpen(value);
      }}
    >
      {hideTrigger ? null : contextual ? (
        <Tooltip>
          {renameTrigger}
          <TooltipContent role="tooltip">{t("uiPolish.renameDictation")}</TooltipContent>
        </Tooltip>
      ) : (
        renameTrigger
      )}
      <DialogContent
        showCloseButton={!pending}
        finalFocus={returnFocus}
        backdropClassName="bg-black/80 backdrop-blur-[2px]"
      >
        <DialogHeader>
          <DialogTitle>{t("uiPolish.renameDictation")}</DialogTitle>
          <DialogDescription>{t("uiPolish.titleHelp")}</DialogDescription>
        </DialogHeader>
        {open && (
          <SessionTitleForm
            key={entry.id}
            entry={entry}
            disabled={disabled}
            onPendingChange={(value) => {
              pendingRef.current = value;
              setPending(value);
            }}
            onSaved={(title) => {
              onSaved(title);
              setOpen(false);
            }}
            onCancel={() => setOpen(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// Mount only while editing: closing cancels an unfinished suggestion and
// prevents a late reply from replacing a draft in the next editor.
function SessionTitleForm({
  entry,
  disabled,
  onPendingChange,
  onSaved,
  onCancel,
  inline = false,
}: {
  entry: Session;
  disabled: boolean;
  onPendingChange: (pending: boolean) => void;
  onSaved: (title: string) => void;
  onCancel: () => void;
  inline?: boolean;
}) {
  const { t } = useTranslation();
  const snapshot = { ...useSavedConfiguration(), status: { phase: useDictationPhase() } };
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(entry.title ?? "");
  const [saveError, setSaveError] = useState("");
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const composing = useRef(false);
  const alive = useRef(true);
  const generation = useTextRequest();
  const configured = snapshot.textProcessing.enabled && !!snapshot.textProcessing.model.trim();
  const busy = disabled || isBusy(snapshot.status.phase);
  const error = saveError || generation.error;
  useEffect(() => {
    alive.current = true;
    if (inline) {
      input.current?.focus({ preventScroll: true });
      input.current?.select();
    }
    return () => {
      alive.current = false;
    };
  }, [inline]);

  // Restore focus after React has committed the enabled input.
  useEffect(() => {
    if (!generation.pending && generation.result) input.current?.focus();
  }, [generation.pending, generation.result]);

  async function suggest() {
    setSaveError("");
    const title = await generation.request((requestID) =>
      backend.generateSessionTitle(requestID, entry.id),
    );
    if (title !== undefined) {
      setDraft(title);
    }
  }

  async function save() {
    if (pendingRef.current || busy || generation.pending || composing.current) return;
    const title = draft.trim();
    pendingRef.current = true;
    setPending(true);
    onPendingChange(true);
    setSaveError("");
    generation.clear();
    try {
      await backend.renameSession(entry.id, title);
      if (alive.current) onSaved(title);
    } catch (cause) {
      if (alive.current) setSaveError(message(cause));
    } finally {
      pendingRef.current = false;
      onPendingChange(false);
      if (alive.current) setPending(false);
    }
  }

  return (
    <form
      data-slot="session-title-form"
      className={cn("flex gap-2", inline ? "flex-wrap items-start" : "flex-col gap-4")}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.nativeEvent.isComposing || composing.current) return;
        event.preventDefault();
        event.stopPropagation();
        if (!pendingRef.current) onCancel();
      }}
    >
      <FieldGroup className={cn("min-w-0 flex-1", inline && "max-w-full basis-48")}>
        <Field>
          <FieldLabel htmlFor={id} className={inline ? "sr-only" : undefined}>
            {t("uiPolish.dictationTitle")}
          </FieldLabel>
          <InputGroup className="h-10 has-disabled:opacity-100">
            <InputGroupInput
              className="h-full"
              id={id}
              ref={input}
              value={draft}
              maxLength={80}
              disabled={pending || generation.pending}
              autoComplete="off"
              placeholder={t("uiPolish.titlePlaceholder")}
              aria-describedby={error ? `${id}-error` : undefined}
              onCompositionStart={() => {
                composing.current = true;
              }}
              onCompositionEnd={() => {
                composing.current = false;
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.nativeEvent.isComposing || composing.current))
                  event.preventDefault();
              }}
              onChange={(event) => {
                setDraft(event.target.value);
                setSaveError("");
                generation.clear();
              }}
            />
            {configured && (
              <InputGroupAddon align="inline-end" className="shrink-0 has-[>button]:mr-0">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <InputGroupButton
                        size="icon-sm"
                        variant={generation.pending ? "outline" : "ghost"}
                        disabled={pending || (!generation.pending && busy)}
                        className={generation.pending ? "text-foreground" : undefined}
                      />
                    }
                    disabled={pending || (!generation.pending && busy)}
                    aria-label={
                      generation.pending
                        ? t("generatedOutputs.cancelGeneration")
                        : t("uiPolish.generateTitle")
                    }
                    onClick={() => void (generation.pending ? generation.cancel() : suggest())}
                  >
                    {generation.pending ? (
                      <Square aria-hidden="true" className="size-3.5" />
                    ) : (
                      <Sparkles aria-hidden="true" className="size-4" />
                    )}
                  </TooltipTrigger>
                  <TooltipContent role="tooltip" className="block leading-5">
                    {generation.pending ? (
                      t("generatedOutputs.cancelGeneration")
                    ) : (
                      <>
                        {t("uiPolish.generateTitle")}. {t("uiPolish.generatedTitleHelp")}
                      </>
                    )}
                  </TooltipContent>
                </Tooltip>
              </InputGroupAddon>
            )}
          </InputGroup>
          {configured && (
            <p
              className={
                generation.pending
                  ? "flex items-center gap-2 text-xs text-muted-foreground"
                  : "sr-only"
              }
              role="status"
            >
              {generation.pending && (
                <Loader2
                  aria-hidden="true"
                  className="size-3.5 animate-spin motion-reduce:animate-none"
                />
              )}
              {generation.pending
                ? t("uiPolish.generatingTitle")
                : t("uiPolish.generatedTitleHelp")}
            </p>
          )}
          {error && <FieldError id={`${id}-error`}>{nativeText(error)}</FieldError>}
        </Field>
      </FieldGroup>
      {inline ? (
        <div className="flex h-10 shrink-0 items-center gap-1">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="submit"
                  variant="ghost"
                  size="icon-sm"
                  disabled={pending || busy || generation.pending}
                />
              }
              data-dictation-title-action={entry.id}
              aria-label={pending ? t("uiPolish.savingTitle") : t("uiPolish.saveTitle")}
              disabled={pending || busy || generation.pending}
            >
              {pending ? (
                <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
              ) : (
                <Check aria-hidden="true" />
              )}
            </TooltipTrigger>
            <TooltipContent>{t("uiPolish.saveTitle")}</TooltipContent>
          </Tooltip>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("common.cancel")}
            disabled={pending}
            onClick={onCancel}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      ) : (
        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            disabled={pending || busy || generation.pending || draft.trim() === (entry.title ?? "")}
          >
            {pending ? t("uiPolish.savingTitle") : t("uiPolish.saveTitle")}
          </Button>
        </DialogFooter>
      )}
    </form>
  );
}
