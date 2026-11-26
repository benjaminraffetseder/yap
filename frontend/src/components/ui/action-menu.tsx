import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Menu } from "@base-ui/react/menu";
import { ChevronRight, Ellipsis } from "lucide-react";
import type { ReactNode, Ref } from "react";
import { useTranslation } from "react-i18next";

export function ActionMenu({
  children,
  label,
  disabled,
  text,
  triggerRef,
  instant = false,
}: {
  children: ReactNode;
  label?: string;
  disabled?: boolean;
  text?: string;
  triggerRef?: Ref<HTMLButtonElement>;
  instant?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Menu.Root>
      <Menu.Trigger
        ref={triggerRef}
        disabled={disabled}
        aria-label={label ?? t("uiPolish.moreActions")}
        title={text ? undefined : (label ?? t("uiPolish.moreActions"))}
        render={<Button variant="ghost" size={text ? "sm" : "icon-sm"} />}
      >
        <Ellipsis aria-hidden="true" className="size-4" />
        {text}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align="end" sideOffset={6} className="z-[80]">
          <Menu.Popup
            data-instant={instant ? "" : undefined}
            className="min-w-44 origin-(--transform-origin) rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg outline-none motion-popup"
          >
            {children}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

export function ActionMenuItem({
  children,
  onClick,
  disabled,
  destructive,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <Menu.Item
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex cursor-default items-center gap-2 rounded-md px-3 py-2 text-sm outline-none data-highlighted:bg-accent data-disabled:opacity-50 [&_svg]:size-4",
        destructive && "text-destructive data-highlighted:bg-destructive/10",
      )}
    >
      {children}
    </Menu.Item>
  );
}

export function ActionMenuSub({
  children,
  label,
  disabled,
}: {
  children: ReactNode;
  label: ReactNode;
  disabled?: boolean;
}) {
  return (
    <Menu.SubmenuRoot>
      <Menu.SubmenuTrigger
        disabled={disabled}
        closeDelay={200}
        className="flex cursor-default items-center gap-2 rounded-md px-3 py-2 text-sm outline-none data-highlighted:bg-accent data-popup-open:bg-accent data-disabled:opacity-50 [&_svg]:size-4"
      >
        {label}
        <ChevronRight aria-hidden="true" className="ml-auto" />
      </Menu.SubmenuTrigger>
      <Menu.Portal>
        <Menu.Positioner side="right" align="start" sideOffset={4} className="z-[80]">
          <Menu.Popup
            data-instant=""
            className="min-w-44 origin-(--transform-origin) rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg outline-none motion-popup"
          >
            <Menu.Group>{children}</Menu.Group>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.SubmenuRoot>
  );
}
