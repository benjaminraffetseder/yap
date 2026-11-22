import i18n from "@/i18n";
import { memo } from "react";
import { useTranslation } from "react-i18next";

export const HistoryDate = memo(function HistoryDate({ value }: { value?: string }) {
  const { t } = useTranslation();
  if (!value || Number.isNaN(Date.parse(value))) return t("historyPage.unknownDate");
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const day =
    date.toDateString() === today.toDateString()
      ? t("historyPage.today")
      : date.toDateString() === yesterday.toDateString()
        ? t("historyPage.yesterday")
        : null;
  const language = i18n.resolvedLanguage;
  const full = date.toLocaleString(language, {
    dateStyle: "full",
    timeStyle: "short",
  });
  return (
    <time dateTime={value} title={full} aria-label={full}>
      {day
        ? t("ux.history.recentDateTime", {
            day,
            time: date.toLocaleTimeString(language, { hour: "numeric", minute: "2-digit" }),
          })
        : date.toLocaleDateString(language, { dateStyle: "medium" })}
    </time>
  );
});
