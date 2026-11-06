import { Check, Copy, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { nativeText } from "@/i18n/native-text";
import { backend, message } from "@/lib/backend";
import { Button } from "@/components/ui/button";
import { toastManager } from "@/components/ui/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function CopyButton({
  text,
  label,
  disabled,
  compact = false,
  iconOnly = false,
}: {
  text: string;
  label: string;
  disabled?: boolean;
  compact?: boolean;
  iconOnly?: boolean;
}) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(true);
  const textVersion = useRef(0);
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
  async function copy() {
    if (pending || disabled) return;
    const version = textVersion.current;
    setPending(true);
    try {
      await backend.copy(text);
      if (!mounted.current || version !== textVersion.current) return;
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1800);
    } catch (cause) {
      toastManager.add({ type: "error", title: nativeText(message(cause)) });
    } finally {
      if (mounted.current) setPending(false);
    }
  }
  const button = (
    <Button
      size={iconOnly ? "icon-sm" : "sm"}
      pressFeedback={iconOnly}
      aria-label={label}
      title={compact && !iconOnly ? label : undefined}
      disabled={disabled || pending}
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
