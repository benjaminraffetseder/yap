import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { fade, motionTransition } from "@/lib/motion";
import { useMotionPreference } from "@/lib/use-motion-preference";
import { Toast } from "@base-ui/react/toast";
import { CircleAlert, CircleCheck, X } from "lucide-react";
import { motion } from "motion/react";
import { type ReactNode } from "react";

export const toastManager = Toast.createToastManager();

export function Toaster({
  saveNoticeHost,
  settingsOpen,
}: {
  saveNoticeHost: HTMLDivElement | null;
  settingsOpen: boolean;
}) {
  return (
    <Toast.Provider toastManager={toastManager}>
      <NotificationViewport host={saveNoticeHost} settingsOpen={settingsOpen} />
    </Toast.Provider>
  );
}

function NotificationViewport({
  host,
  settingsOpen,
}: {
  host: HTMLDivElement | null;
  settingsOpen: boolean;
}) {
  const { t } = useTranslation();
  const { toasts } = Toast.useToastManager();
  // The provider owns one viewport for announcements, focus and timers. Dock the
  // whole stack while a settings-save notice needs reserved layout space.
  const docked = !!host && toasts.some((toast) => toast.id === "settings-save");
  return (
    <Toast.Portal container={docked ? host : undefined}>
      <Toast.Viewport
        aria-label={t("toast.notifications")}
        className={
          docked
            ? "flex flex-col gap-2 outline-none"
            : "pointer-events-none fixed right-5 bottom-[calc(var(--setup-footer-height,0px)+1.25rem)] z-[100] flex w-96 max-w-[calc(100vw-2.5rem)] flex-col gap-3 outline-none [body:has([data-slot=history-selection-bar])_&]:bottom-[calc(var(--history-selection-height,0px)+2.5rem+env(safe-area-inset-bottom))]"
        }
      >
        <ToastList docked={docked} inSettings={settingsOpen} />
      </Toast.Viewport>
    </Toast.Portal>
  );
}

function ToastList({ docked, inSettings }: { docked: boolean; inSettings: boolean }) {
  const { t } = useTranslation();
  const { toasts } = Toast.useToastManager();
  const reduced = useMotionPreference();
  return toasts.map((toast) => {
    const settingsSave = toast.id === "settings-save";
    const inlineRecovery = docked && inSettings && settingsSave;
    const stationary = reduced || docked;
    return (
      <Toast.Root
        key={toast.id}
        toast={toast}
        data-slot="toast"
        aria-hidden={settingsSave ? false : undefined}
        swipeDirection={[]}
        render={
          <motion.div
            // Override Base UI's undefined swipe transform so rerenders don't cancel Motion's entrance.
            style={{ transform: stationary ? "none" : "translateY(0px)" }}
            initial={{
              opacity: 0,
              transform: stationary ? "none" : "translateY(6px)",
            }}
            animate={
              toast.transitionStatus === "ending"
                ? { opacity: 0, transform: stationary ? "none" : "translateY(6px)" }
                : { opacity: 1, transform: stationary ? "none" : "translateY(0px)" }
            }
            transition={
              toast.transitionStatus === "ending"
                ? fade(reduced, 0.1)
                : motionTransition("toast", reduced)
            }
          />
        }
        className={
          docked
            ? inlineRecovery
              ? "pointer-events-auto min-w-0 text-card-foreground data-limited:hidden"
              : "pointer-events-auto border-b bg-card px-4 py-[6px] text-card-foreground data-limited:hidden"
            : "pointer-events-auto rounded-xl border bg-card px-3 py-2.5 text-card-foreground shadow-lg data-limited:hidden"
        }
      >
        <Toast.Content
          className={`flex ${inlineRecovery ? "gap-[8px]" : "gap-2.5"} ${settingsSave && !inlineRecovery ? "items-start" : "items-center"}`}
        >
          {inlineRecovery ? null : toast.type === "error" || toast.type === "warning" ? (
            <CircleAlert
              className={`size-4 shrink-0 ${toast.type === "warning" ? "text-amber-600 dark:text-amber-400" : "text-destructive"}`}
              aria-hidden="true"
            />
          ) : (
            <CircleCheck className="size-4 shrink-0 text-primary" aria-hidden="true" />
          )}
          <div className="min-w-0 flex-1">
            <Toast.Title
              className={
                settingsSave && inSettings ? "sr-only" : "break-words text-sm font-medium leading-5"
              }
            />
            {toast.description &&
              (toast.id === "settings-save" ? (
                <SaveErrorDetails details={toast.description} inline={inlineRecovery} />
              ) : (
                <Toast.Description className="mt-0.5 break-words text-xs leading-4 text-muted-foreground" />
              ))}
          </div>
          {toast.actionProps && <Toast.Action render={<Button size="xs" variant="outline" />} />}
          <Toast.Close
            aria-label={t("toast.dismissNotification")}
            aria-hidden={false}
            render={
              <Button
                variant="ghost"
                size={inlineRecovery ? "xs" : "icon-xs"}
                className={
                  inlineRecovery ? "h-auto min-h-[32px] max-w-full whitespace-normal" : "-mr-1"
                }
              />
            }
          >
            {inlineRecovery ? (
              t("uiPolish.dismissNotice")
            ) : (
              <X aria-hidden="true" className="size-4" />
            )}
          </Toast.Close>
        </Toast.Content>
      </Toast.Root>
    );
  });
}

function SaveErrorDetails({ details, inline }: { details: ReactNode; inline: boolean }) {
  const { t } = useTranslation();
  return (
    <Dialog>
      <Toast.Description className="sr-only" />
      <DialogTrigger
        render={
          <Button
            variant="outline"
            size="xs"
            className={`h-auto max-w-full whitespace-normal ${inline ? "min-h-[32px] @max-[42rem]/settings-dialog:min-h-[44px] @max-[42rem]/settings-dialog:px-[8px] @max-[42rem]/settings-dialog:py-[4px]" : "mt-1 min-h-8"}`}
          />
        }
      >
        {t("uiPolish.errorDetails")}
      </DialogTrigger>
      <DialogContent
        className="flex h-[min(38rem,calc(100dvh-2rem))] flex-col gap-3 p-4 sm:max-w-3xl sm:p-6"
        backdropClassName="bg-black/80"
      >
        <DialogHeader className="shrink-0 pr-8 text-left">
          <DialogTitle>{t("uiPolish.errorDetails")}</DialogTitle>
          <DialogDescription>{t("uiPolish.errorReaderHelp")}</DialogDescription>
        </DialogHeader>
        <div
          data-slot="error-cause"
          role="region"
          aria-label={t("uiPolish.fullErrorDetails")}
          tabIndex={0}
          className="min-h-0 flex-1 overflow-y-auto rounded-lg border bg-muted/30 p-4 text-sm leading-6 whitespace-pre-wrap outline-none [overflow-wrap:anywhere] focus-visible:ring-2 focus-visible:ring-ring"
        >
          {details}
        </div>
        <DialogFooter className="shrink-0">
          <DialogClose
            render={<Button variant="outline" className="h-auto min-h-9 whitespace-normal" />}
          >
            {t("common.back")}
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
