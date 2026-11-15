import { CorrectionForm } from "@/features/transcripts/components/correction-form";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { toastManager } from "@/components/ui/toast";
import { nativeText } from "@/i18n/native-text";
import { backend, isDesktop, message } from "@/lib/backend";
import {
  readTranscriptSelection,
  type TextSelection,
  type TranscriptSelection,
} from "@/features/transcripts/lib/text-selection";
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
