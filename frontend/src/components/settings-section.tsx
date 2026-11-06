import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useId, type ReactNode } from "react";

export function SettingsSection({
  title,
  action,
  icon,
  children,
}: {
  title: string;
  action?: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
}) {
  const sectionId = useId();
  return (
    <section id={sectionId} data-slot="settings-section" className="rounded-xl border bg-card">
      {action ? (
        <header
          data-slot="settings-section-heading"
          className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4"
        >
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            {icon}
            {title}
          </h2>
          {action}
        </header>
      ) : (
        <h2
          data-slot="settings-section-heading"
          className="flex items-center gap-2 border-b px-5 py-4 text-sm font-semibold"
        >
          {icon}
          {title}
        </h2>
      )}
      <div data-slot="settings-section-content" className="divide-y px-5">
        {children}
      </div>
    </section>
  );
}

export function SettingRow({
  title,
  htmlFor,
  description,
  indicator,
  children,
}: {
  title: string;
  htmlFor?: string;
  description?: string;
  indicator?: ReactNode;
  children: ReactNode;
}) {
  const rowId = useId();
  return (
    <div
      id={htmlFor ? `${htmlFor}-row` : rowId}
      data-slot="setting-row"
      className="grid items-start gap-3 py-4 @xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] @xl:gap-6"
    >
      <div className="min-w-0 pt-1.5">
        <div className="flex items-center gap-1.5">
          {htmlFor ? (
            <Label htmlFor={htmlFor}>{title}</Label>
          ) : (
            <p className="text-sm font-medium">{title}</p>
          )}
          {indicator}
        </div>
        {description && (
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function ToggleSetting({
  title,
  description,
  indicator,
  checked,
  disabled,
  onCheckedChange,
}: {
  title: string;
  description?: string;
  indicator?: ReactNode;
  checked: boolean;
  disabled: boolean;
  onCheckedChange: (value: boolean) => void;
}) {
  const id = useId();
  return (
    <div
      id={`${id}-row`}
      data-slot="toggle-setting"
      className={`flex items-start justify-between gap-6 py-4 ${disabled ? "opacity-60" : "cursor-pointer"}`}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <label htmlFor={id} className="text-sm font-medium">
            {title}
          </label>
          {indicator}
        </div>
        {description && (
          <label htmlFor={id} className="mt-1 block text-xs leading-5 text-muted-foreground">
            {description}
          </label>
        )}
      </div>
      <Switch
        id={id}
        className="mt-0.5 shrink-0"
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}
