import { Button } from "@/components/ui/button";
import { Toast } from "@base-ui/react/toast";
import { CircleAlert, CircleCheck, X } from "lucide-react";

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
  return toasts.map((toast) => (
    <Toast.Root
      key={toast.id}
      toast={toast}
      data-slot="toast"
      swipeDirection={[]}
      className="pointer-events-auto rounded-xl border bg-card p-4 text-card-foreground shadow-lg data-limited:hidden"
    >
      <Toast.Content className="flex items-start gap-3">
        {toast.type === "error" ? (
          <CircleAlert className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden="true" />
        ) : (
          <CircleCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
        )}
        <div className="min-w-0 flex-1">
          <Toast.Title className="break-words text-sm font-medium leading-6" />
          {toast.description && (
            <Toast.Description className="mt-1 break-words text-xs leading-5 text-muted-foreground" />
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
