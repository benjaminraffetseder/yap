import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toastManager } from "@/components/ui/toast";
import { nativeText } from "@/i18n/native-text";
import { backend, isDesktop, message } from "@/lib/backend";
import {
  readTranscriptSelection,
  type TextSelection,
  type TranscriptSelection,
} from "@/lib/text-selection";
import { BookPlus, Copy, MessageSquare, SpellCheck } from "lucide-react";
import { useRef, useState, type ReactElement, type RefObject } from "react";
import { useTranslation } from "react-i18next";

export function TranscriptContextMenu({
  text,
  children,
  disabled = false,
  returnFocus,
  onApply,
  onAddToVocabulary,
  onAskSelection,
  onDialogOpenChange,
}: {
  text: string;
  children: ReactElement;
  disabled?: boolean;
  returnFocus?: RefObject<HTMLElement | null>;
  onApply?: (text: string) => boolean | Promise<boolean>;
  onAddToVocabulary?: (text: string) => void;
  onAskSelection?: (text: string) => void;
  onDialogOpenChange?: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const [target, setTarget] = useState<TextSelection | null>(null);
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState<TranscriptSelection | null>(null);
  const [pending, setPending] = useState(false);
  const trigger = useRef<HTMLDivElement>(null);
  const openingDialog = useRef(false);
  const current = useRef({ text, disabled, onApply });
  current.current = { text, disabled, onApply };
  const valid = selection?.source === text;
  function closeDialog() {
    setTarget(null);
    onDialogOpenChange?.(false);
  }
  return (
    <>
      <ContextMenu
        open={open}
        disabled={!isDesktop}
        onOpenChange={(next, details) => {
          if (next) {
            const selected = trigger.current && readTranscriptSelection(trigger.current, text);
            if (!selected?.text.trim()) {
              details.cancel();
              return;
            }
            setSelection(selected);
            openingDialog.current = false;
          }
          setOpen(next);
        }}
      >
        <ContextMenuTrigger
          ref={trigger}
          render={children}
          className="select-text"
          onContextMenu={(event) => {
            if (!readTranscriptSelection(event.currentTarget, text)?.text.trim()) {
              // Keep the native editing menu when no text is highlighted.
              event.preventBaseUIHandler();
              event.stopPropagation();
            }
          }}
          onKeyDownCapture={(event) => {
            if ((target || open) && event.key === "Escape" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.stopPropagation();
              if (!pending) {
                closeDialog();
                setOpen(false);
              }
            } else if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
              if (!readTranscriptSelection(event.currentTarget, text)?.text.trim()) return;
              event.preventDefault();
              event.stopPropagation();
              const rect = event.currentTarget.getBoundingClientRect();
              event.currentTarget.dispatchEvent(
                new MouseEvent("contextmenu", {
                  bubbles: true,
                  cancelable: true,
                  clientX: Math.max(8, Math.min(innerWidth - 8, rect.left + 24)),
                  clientY: Math.max(8, Math.min(innerHeight - 8, rect.top + 24)),
                }),
              );
            }
          }}
        />
        <ContextMenuContent
          className="min-w-56"
          onKeyDown={(event) => event.stopPropagation()}
          finalFocus={() =>
            openingDialog.current ? false : (returnFocus?.current ?? trigger.current)
          }
        >
          <ContextMenuItem
            onClick={() => {
              if (!selection) return;
              void backend
                .copy(selection.text)
                .then(() => {
                  toastManager.add({ type: "success", title: t("uiPolish.copied") });
                })
                .catch((cause) =>
                  toastManager.add({ type: "error", title: nativeText(message(cause)) }),
                );
            }}
          >
            <Copy aria-hidden="true" />
            {t("transcriptMenu.copySelection")}
          </ContextMenuItem>
          {((onApply && selection?.correction) ||
            (onAddToVocabulary && selection?.correction) ||
            onAskSelection) && <ContextMenuSeparator />}
          {onApply && selection?.correction && (
            <ContextMenuItem
              disabled={disabled || !valid}
              onClick={() => {
                openingDialog.current = true;
                onDialogOpenChange?.(true);
                setTarget(selection.correction);
              }}
            >
              <SpellCheck aria-hidden="true" />
              {t("correction.correctAndRemember")}
            </ContextMenuItem>
          )}
          {onAddToVocabulary && selection?.correction && (
            <ContextMenuItem
              disabled={disabled || !valid}
              onClick={() => {
                openingDialog.current = true;
                onAddToVocabulary(selection.correction!.text);
              }}
            >
              <BookPlus aria-hidden="true" />
              {t("transcriptEditor.addToVocabulary")}
            </ContextMenuItem>
          )}
          {onAskSelection && (
            <ContextMenuItem
              disabled={!valid}
              onClick={() => onAskSelection(selection!.sourceText)}
            >
              <MessageSquare aria-hidden="true" />
              {t("chat.askSelection")}
            </ContextMenuItem>
          )}
        </ContextMenuContent>
      </ContextMenu>
      <Dialog
        open={!!target}
        disablePointerDismissal
        onOpenChange={(open) => {
          if (!open && !pending) closeDialog();
        }}
      >
        <DialogContent
          showCloseButton={false}
          finalFocus={() => {
            (returnFocus?.current ?? trigger.current)?.focus({ preventScroll: true });
            return false;
          }}
          onKeyDown={(event) => event.stopPropagation()}
        >
          {target && (
            <CorrectionForm
              target={target}
              stale={target.source !== text}
              disabled={disabled}
              onPending={setPending}
              onCancel={closeDialog}
              onApply={async (value) => {
                const latest = current.current;
                if (latest.disabled || latest.text !== target.source || !latest.onApply)
                  return false;
                return latest.onApply(
                  target.source.slice(0, target.start) + value + target.source.slice(target.end),
                );
              }}
              onDone={closeDialog}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function CorrectionForm({
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
  const { t } = useTranslation();
  const [value, setValue] = useState(target.text);
  const [remember, setRemember] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const remembered = useRef(false);
  const composing = useRef(false);
  const canonical = value.trim();
  const valid =
    !!canonical &&
    Array.from(canonical).length <= 80 &&
    // eslint-disable-next-line no-control-regex -- mirror vocabulary phrase validation
    !/[\u0000-\u001f\u007f-\u009f\uD800-\uDFFF]/u.test(canonical) &&
    Array.from(target.source.slice(0, target.start) + canonical + target.source.slice(target.end))
      .length <= 100000;
  async function submit() {
    if (inFlight.current || composing.current || !valid || stale || disabled) return;
    inFlight.current = true;
    setPending(true);
    onPending(true);
    setError("");
    try {
      if (remember) {
        await backend.addVocabularyTerm(canonical, [target.text]);
        remembered.current = true;
      }
      if (!(await onApply(canonical))) throw new Error(t("correction.couldNotApply"));
      onDone();
    } catch (cause) {
      const details = nativeText(message(cause));
      setError(
        remembered.current ? `${t("correction.rememberedButNotApplied")} ${details}` : details,
      );
    } finally {
      inFlight.current = false;
      setPending(false);
      onPending(false);
    }
  }
  return (
    <form
      className="grid gap-4"
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
      <div className="space-y-2">
        <Label htmlFor="corrected-spelling">{t("correction.correctSpelling")}</Label>
        <Input
          id="corrected-spelling"
          value={value}
          maxLength={160}
          disabled={pending}
          onChange={(event) => setValue(event.target.value)}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
        />
      </div>
      <div className="flex items-start gap-3">
        <Checkbox
          id="remember-spelling"
          checked={remember}
          disabled={pending}
          onCheckedChange={(checked) => setRemember(checked === true)}
        />
        <Label htmlFor="remember-spelling">{t("correction.remember")}</Label>
      </div>
      {stale && (
        <p role="alert" className="text-sm text-destructive">
          {t("correction.stale")}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={pending || disabled || stale || !valid}>
          {pending ? t("autoSaveStatus.saving") : t("correction.apply")}
        </Button>
      </DialogFooter>
    </form>
  );
}
