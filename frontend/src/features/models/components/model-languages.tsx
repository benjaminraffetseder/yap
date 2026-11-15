import { Languages, Search } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { languageAutonym, languageName } from "@/lib/languages";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const normalize = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase(i18n.resolvedLanguage);

export function ModelLanguages({
  id,
  name,
  languages,
}: {
  id: string;
  name: string;
  languages: string[];
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);
  const title = t("modelCard.supportedLanguagesFor", { name });
  const caption =
    languages.length === 1
      ? t("modelCard.englishOnly")
      : t("modelCard.languageCount", { count: languages.length });
  const shown = languages
    .map((value) => ({ value, label: languageName(value), native: languageAutonym(value) }))
    .filter((entry) =>
      normalize(`${entry.value} ${entry.label} ${entry.native?.label ?? ""}`).includes(
        normalize(query.trim()),
      ),
    )
    .sort((a, b) => a.label.localeCompare(b.label, i18n.resolvedLanguage));
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) setQuery("");
      }}
    >
      <DialogTrigger
        data-model-language={id}
        aria-label={`${title} · ${caption}`}
        className="inline-flex min-h-8 max-w-full items-center gap-1 rounded px-1 text-xs text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Languages aria-hidden="true" className="size-3.5" />
        <span className="underline decoration-current/50 underline-offset-3">{caption}</span>
        <Search aria-hidden="true" className="size-3" />
      </DialogTrigger>
      <DialogContent
        initialFocus={(type) => (type === "touch" ? true : search.current)}
        className="flex h-[min(38rem,calc(100dvh-2rem))] flex-col overflow-hidden p-4 sm:max-w-2xl sm:p-6"
      >
        <DialogHeader className="shrink-0 pr-8 text-left">
          <DialogTitle aria-label={title} className="leading-6">
            {t("uiPolish.languages")}
          </DialogTitle>
          <p className="break-words text-sm">{name}</p>
          <DialogDescription role="status">
            {t("uiPolish.languageCoverageCount", {
              shown: shown.length,
              count: languages.length,
            })}
          </DialogDescription>
        </DialogHeader>
        <Input
          ref={search}
          className="shrink-0"
          value={query}
          aria-label={t("uiPolish.searchSupportedLanguages")}
          placeholder={t("uiPolish.findLanguage")}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="min-h-0 flex-1 overflow-y-auto">
          {shown.length ? (
            <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,9rem),1fr))] gap-x-5 gap-y-4 text-sm leading-5">
              {shown.map((entry) => (
                <li key={entry.value} className="break-words">
                  {entry.label}
                  {entry.native && normalize(entry.native.label) !== normalize(entry.label) && (
                    <span className="mt-1 block text-xs text-muted-foreground">
                      <bdi lang={entry.native.code} className="inline-block [word-break:keep-all]">
                        {entry.native.label}
                      </bdi>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("uiPolish.noSupportedLanguageMatch")}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
