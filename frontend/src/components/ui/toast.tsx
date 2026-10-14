import { useMotionPreference } from "@/lib/use-motion-preference";
import { Button } from "@/components/ui/button";
import { Toast } from "@base-ui/react/toast";
import { CircleAlert, CircleCheck, X } from "lucide-react";
import { motion } from "motion/react";
import { fade, motionTransition } from "@/lib/motion";

export const toastManager = Toast.createToastManager();

export function Toaster() {
  return (
    <Toast.Provider toastManager={toastManager}>
      <Toast.Portal>
        <Toast.Viewport
          aria-label="Notifications"
          className="pointer-events-none fixed right-5 bottom-[calc(var(--setup-footer-height,0px)+1.25rem)] z-[100] flex w-96 max-w-[calc(100vw-2.5rem)] flex-col gap-3 outline-none"
        >
          <ToastList />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  );
}

function ToastList() {
  const { toasts } = Toast.useToastManager();
  const reduced = useMotionPreference();
  return toasts.map((toast) => (
    <Toast.Root
      key={toast.id}
      toast={toast}
      data-slot="toast"
      swipeDirection={[]}
      render={
        <motion.div
          // Override Base UI's undefined swipe transform so rerenders don't cancel Motion's entrance.
          style={{ transform: reduced ? "none" : "translateY(0px)" }}
          initial={{ opacity: 0, transform: reduced ? "none" : "translateY(6px)" }}
          animate={
            toast.transitionStatus === "ending"
              ? { opacity: 0, transform: reduced ? "none" : "translateY(6px)" }
              : { opacity: 1, transform: reduced ? "none" : "translateY(0px)" }
          }
          transition={
            toast.transitionStatus === "ending"
              ? fade(reduced, 0.1)
              : motionTransition("toast", reduced)
          }
        />
      }
      className="pointer-events-auto rounded-xl border bg-card p-4 text-card-foreground shadow-lg data-limited:hidden"
    >
      <Toast.Content className="flex items-start gap-3">
        {toast.type === "error" || toast.type === "warning" ? (
          <CircleAlert
            className={`mt-0.5 size-5 shrink-0 ${toast.type === "warning" ? "text-amber-600 dark:text-amber-400" : "text-destructive"}`}
            aria-hidden="true"
          />
        ) : (
          <CircleCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
        )}
        <div className="min-w-0 flex-1">
          <Toast.Title className="break-words text-sm font-medium leading-6" />
          {toast.description && (
            <Toast.Description className="mt-1 break-words text-xs leading-5 text-muted-foreground" />
          )}
          {toast.actionProps && (
            <Toast.Action render={<Button size="sm" variant="outline" className="mt-3" />} />
          )}
        </div>
        <Toast.Close
          aria-label="Dismiss notification"
          aria-hidden={false}
          render={<Button variant="ghost" size="icon-sm" className="-mt-1 -mr-1" />}
        >
          <X aria-hidden="true" className="size-4" />
        </Toast.Close>
      </Toast.Content>
    </Toast.Root>
  ));
}
