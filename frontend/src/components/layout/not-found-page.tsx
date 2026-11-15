import { useTranslation } from "react-i18next";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "react-router";
import { Compass } from "lucide-react";

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-xl space-y-5 py-16">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <Compass aria-hidden="true" className="size-7" />
      </div>
      <p className="font-mono text-sm text-muted-foreground">404</p>
      <h1 className="text-3xl font-semibold tracking-tight">{t("notFoundPage.pageNotFound")}</h1>
      <p className="text-sm text-muted-foreground">{t("notFoundPage.thereIsnTAScreenAtThis")}</p>
      <div className="flex flex-wrap gap-3">
        <Link to="/" className={buttonVariants()}>
          {t("notFoundPage.backToDictation")}
        </Link>
        <Link to="/history" className={buttonVariants({ variant: "outline" })}>
          {t("common.history")}
        </Link>
      </div>
    </div>
  );
}
