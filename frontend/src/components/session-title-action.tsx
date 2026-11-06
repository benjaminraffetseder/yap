import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Pencil, Sparkles, Square } from "lucide-react";
import { nativeText } from "@/i18n/native-text";
import { backend, isBusy, message, type Session } from "@/lib/backend";
import { useTextRequest } from "@/lib/use-text-request";
import { useDictation } from "@/components/dictation-provider";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function SessionTitleAction({
  entry,
  disabled,
  onSaved,
  context,
  contextual = false,
}: {
  entry: Session;
  disabled: boolean;
  onSaved: (title: string) => void;
  context?: string;
  contextual?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
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
      {contextual ? (
        <Tooltip>
          {renameTrigger}
          <TooltipContent role="tooltip">{t("uiPolish.renameDictation")}</TooltipContent>
        </Tooltip>
      ) : (
        renameTrigger
      )}
      <DialogContent showCloseButton={!pending} backdropClassName="bg-black/80 backdrop-blur-[2px]">
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

// Mount only for an open dialog: closing it cancels an unfinished suggestion
// and prevents a late reply from replacing a draft in the next dialog.
function SessionTitleForm({
  entry,
  disabled,
  onPendingChange,
  onSaved,
  onCancel,
}: {
  entry: Session;
  disabled: boolean;
  onPendingChange: (pending: boolean) => void;
  onSaved: (title: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const { snapshot } = useDictation();
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
    return () => {
      alive.current = false;
    };
  }, []);

  async function suggest() {
    setSaveError("");
    const title = await generation.request((requestID) =>
      backend.generateSessionTitle(requestID, entry.id),
    );
    if (title !== undefined) {
      setDraft(title);
      requestAnimationFrame(() => input.current?.focus());
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
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="space-y-2">
        <Label htmlFor={id}>{t("uiPolish.dictationTitle")}</Label>
        <InputGroup className="h-10 has-disabled:opacity-100">
          <InputGroupInput
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
            <InputGroupAddon align="inline-end">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <InputGroupButton
                      size="icon-sm"
                      variant={generation.pending ? "outline" : "ghost"}
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
            {generation.pending ? t("uiPolish.generatingTitle") : t("uiPolish.generatedTitleHelp")}
          </p>
        )}
        {error && (
          <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
            {nativeText(error)}
          </p>
        )}
      </div>
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
    </form>
  );
}
