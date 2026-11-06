import { Check, Copy, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { nativeText } from "@/i18n/native-text";
import { backend, message } from "@/lib/backend";
import { Button } from "@/components/ui/button";
import { toastManager } from "@/components/ui/toast";

export function CopyButton({
  text,
  label,
  disabled,
  compact = false,
}: {
  text: string;
  label: string;
  disabled?: boolean;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
    };
  }, []);
  useEffect(() => {
    setCopied(false);
    clearTimeout(timer.current);
  }, [text]);
  async function copy() {
    if (pending || disabled) return;
    setPending(true);
    try {
      await backend.copy(text);
      if (!mounted.current) return;
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1800);
    } catch (cause) {
      toastManager.add({ type: "error", title: nativeText(message(cause)) });
    } finally {
      if (mounted.current) setPending(false);
    }
  }
  return (
    <Button
      size="sm"
      aria-label={label}
      title={compact ? label : undefined}
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
      <span aria-live="polite">
        {copied ? t("uiPolish.copied") : compact ? t("common.copy") : label}
      </span>
    </Button>
  );
}
