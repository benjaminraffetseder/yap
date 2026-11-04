import { useTranslation } from "react-i18next";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "react-router";

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <div className="space-y-4 py-16">
      <p className="text-sm text-muted-foreground">404</p>
      <h1 className="text-3xl font-semibold tracking-tight">{t("notFoundPage.pageNotFound")}</h1>
      <p className="text-sm text-muted-foreground">{t("notFoundPage.thereIsnTAScreenAtThis")}</p>
      <Link to="/" className={buttonVariants()}>
        {t("notFoundPage.backToDictation")}
      </Link>
    </div>
  );
}
