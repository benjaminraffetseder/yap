import { Menu } from "@base-ui/react/menu";
import { Ellipsis } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ActionMenu({
  children,
  label,
  disabled,
  text,
}: {
  children: ReactNode;
  label?: string;
  disabled?: boolean;
  text?: string;
}) {
  const { t } = useTranslation();
  return (
    <Menu.Root>
      <Menu.Trigger
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
          <Menu.Popup className="min-w-44 origin-(--transform-origin) rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg outline-none motion-popup">
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
