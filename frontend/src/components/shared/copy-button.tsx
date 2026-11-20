import { Button } from "@/components/ui/button";
import { toastManager } from "@/components/ui/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { nativeText } from "@/i18n/native-text";
import { backend, message } from "@/lib/backend";
import { hasOpenKeyboardOverlay } from "@/lib/keyboard-shortcuts";
import { Check, Copy, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export function CopyButton({
  text,
  label,
  disabled,
  compact = false,
  iconOnly = false,
  variant = "default",
  shortcut = false,
}: {
  text: string;
  label: string;
  disabled?: boolean;
  compact?: boolean;
  iconOnly?: boolean;
  variant?: "default" | "ghost";
  shortcut?: boolean;
}) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(true);
  const textVersion = useRef(0);
  const copying = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
    };
  }, []);
  useEffect(() => {
    textVersion.current++;
    setCopied(false);
    clearTimeout(timer.current);
  }, [text]);
  const copy = useCallback(
    async (notify = false) => {
      if (copying.current || disabled) return;
      copying.current = true;
      const version = textVersion.current;
      setPending(true);
      try {
        await backend.copy(text);
        if (!mounted.current || version !== textVersion.current) return;
        setCopied(true);
        if (notify) toastManager.add({ type: "success", title: t("uiPolish.copied") });
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1800);
      } catch (cause) {
        toastManager.add({ type: "error", title: nativeText(message(cause)) });
      } finally {
        copying.current = false;
        if (mounted.current) setPending(false);
      }
    },
    [disabled, text, t],
  );
  useEffect(() => {
    if (!shortcut) return;
    function keydown(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        event.altKey ||
        !event.shiftKey ||
        !(event.ctrlKey || event.metaKey) ||
        event.key.toLowerCase() !== "c" ||
        disabled ||
        hasOpenKeyboardOverlay() ||
        (event.target instanceof Element &&
          event.target.closest('input, textarea, [contenteditable="true"]'))
      )
        return;
      event.preventDefault();
      void copy(true);
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [shortcut, disabled, copy]);
  const button = (
    <Button
      variant={variant}
      size={iconOnly ? "icon-sm" : "sm"}
      className={compact && !iconOnly ? "min-w-22" : undefined}
      pressFeedback={iconOnly}
      aria-label={label}
      title={compact && !iconOnly ? label : undefined}
      disabled={disabled || pending}
      aria-keyshortcuts={shortcut ? "Control+Shift+C Meta+Shift+C" : undefined}
      onClick={() => void copy()}
    >
      {pending ? (
        <Loader2 aria-hidden="true" className="size-3.5 animate-spin motion-reduce:animate-none" />
      ) : copied ? (
        <Check aria-hidden="true" className="size-3.5" />
      ) : (
        <Copy aria-hidden="true" className="size-3.5" />
      )}
      <span aria-live="polite" className={iconOnly ? "sr-only" : undefined}>
        {copied ? t("uiPolish.copied") : compact ? t("common.copy") : label}
      </span>
    </Button>
  );
  return iconOnly ? (
    <Tooltip>
      <TooltipTrigger render={button} disabled={disabled || pending} />
      <TooltipContent>{copied ? t("uiPolish.copied") : label}</TooltipContent>
    </Tooltip>
  ) : (
    button
  );
}
